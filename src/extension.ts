import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { EmulatorManager } from './emulator/manager';
import { IpcMessage } from './emulator/ipc-client';
import { ScopePanel } from './webview/scope-panel';
import { buildForEmulator } from './commands/build';
import { deployToEmulator } from './commands/deploy';
import { startAudio, stopAudio } from './commands/transport';
import { debugDeploy, DAISY_DEBUG_TYPE } from './commands/debug-deploy';
import { parseControllerConfig, serializeControllerConfig, ControllerConfig, ControllerDef, ButtonDef, LedDef } from './controllers/controller-config';
import { PotStore } from './controllers/pot-store';
import { ButtonStore } from './controllers/button-store';
import { DaisyDebugAdapterFactory, DaisyDebugAdapterTrackerFactory } from './debug/debug-adapter';
import { SineParams, SINE_DEFAULTS, AudioSource, AUDIO_SOURCE_DEFAULTS, EditorSaveHandler } from './webview/scope-panel';

const FIDELITY_CAVEAT =
  'Emulator approximates the Seed — not bit-exact, does not validate hardware CPU/RAM budget.';

let manager: EmulatorManager | undefined;
let scopePanel: ScopePanel | undefined;
let potStore: PotStore | undefined;
let buttonStore: ButtonStore | undefined;
let sineState: SineParams = { ...SINE_DEFAULTS };
let audioSourceState: AudioSource = { ...AUDIO_SOURCE_DEFAULTS };

export function activate(context: vscode.ExtensionContext): void {
  potStore = new PotStore(context.workspaceState);
  buttonStore = new ButtonStore(context.workspaceState);
  sineState = context.workspaceState.get<SineParams>('ds-ide.sine') ?? { ...SINE_DEFAULTS };
  audioSourceState = {
    ...AUDIO_SOURCE_DEFAULTS,
    ...context.workspaceState.get<Partial<AudioSource>>('ds-ide.audioSource'),
  };
  manager = new EmulatorManager();

  // T4.1/T4.2 — diagnostics collection shown in VS Code Problems panel
  const diagnostics = vscode.languages.createDiagnosticCollection('ds-ide');

  // T4.4 / T4.5 — status bar item: shows emulator state + fidelity caveat in tooltip
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.text = '$(circuit-board) Daisy';
  statusBar.tooltip = FIDELITY_CAVEAT;
  statusBar.show();

  scopePanel = new ScopePanel(
    manager,
    (channel, value) => {
      potStore?.set(channel, value);
    },
    (freq, amplitude) => {
      sineState = { freq, amplitude };
      void context.workspaceState.update('ds-ide.sine', sineState);
    },
    (source) => {
      audioSourceState = { ...audioSourceState, ...source };
      void context.workspaceState.update('ds-ide.audioSource', audioSourceState);
      const mode = source.input === 'live' ? 'realtime' : 'simulated';
      manager?.sendAudioMode(mode);
      manager?.sendAudioDevice(source.sampleRate, source.bufferSize);
      // M9: activate WAV input when selected (with a chosen file); otherwise
      // deactivate it so the runtime reverts to the sine generator.
      if (source.input === 'wav' && audioSourceState.wavPath) {
        manager?.sendWavFile(audioSourceState.wavPath, audioSourceState.wavLoop);
      } else {
        manager?.sendWavFile('', audioSourceState.wavLoop);
      }
    },
    async () => {
      // onPickWav: open the native file dialog and route the chosen WAV to the runtime.
      const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: 'Use as input',
        filters: { 'WAV audio': ['wav'] },
      });
      const uri = picked?.[0];
      if (!uri) return;
      const wavPath = uri.fsPath;
      audioSourceState = { ...audioSourceState, input: 'wav', wavPath };
      void context.workspaceState.update('ds-ide.audioSource', audioSourceState);
      manager?.sendAudioMode('simulated');
      manager?.sendAudioDevice(audioSourceState.sampleRate, audioSourceState.bufferSize);
      manager?.sendWavFile(wavPath, audioSourceState.wavLoop);
      scopePanel?.notifyWavSelected(path.basename(wavPath), wavPath);
    },
    (gpioPin, pressed) => {
      // onButtonChange: persist button state (FR-CT-11). Toggle stays latched;
      // momentary settles to released as each release is recorded.
      buttonStore?.set(gpioPin, pressed);
    },
    (cfg) => {
      // onEditorSave: serialize the updated config and write controllers.yaml.
      const folders = vscode.workspace.workspaceFolders;
      if (!folders?.[0]) return;
      const yamlPath = path.join(folders[0].uri.fsPath, 'controllers.yaml');
      try {
        fs.writeFileSync(yamlPath, serializeControllerConfig(cfg), 'utf8');
      } catch (err) {
        void vscode.window.showErrorMessage(`ds-ide: could not write controllers.yaml: ${String(err)}`);
      }
    },
  );

  // T4.3 — forward NaN/Inf audio events as VS Code notifications
  // T4.4 — handle emulator crash/disconnect without crashing ds-ide
  manager.on('message', (msg: IpcMessage) => {
    if (msg['type'] === 'event') {
      const kind = msg['kind'] as string;
      if (kind === 'nan' || kind === 'inf') {
        void vscode.window.showWarningMessage(
          `ds-ide: audio ${kind.toUpperCase()} detected — effect may misbehave`,
        );
      }
    }
    if (msg['type'] === 'status') {
      const running = msg['running'] as boolean;
      statusBar.text = running ? '$(play) Daisy: running' : '$(debug-stop) Daisy: stopped';
      statusBar.tooltip = FIDELITY_CAVEAT;
    }
  });

  manager.on('disconnect', () => {
    statusBar.text = '$(warning) Daisy: crashed';
    statusBar.tooltip = FIDELITY_CAVEAT;
    void vscode.window.showErrorMessage(
      'ds-ide: emulator disconnected unexpectedly — redeploy to restart.',
    );
  });

  // C6: register the daisy-debug adapter (lldb-dap wrapper) and mute-on-breakpoint tracker
  const debugAdapterFactory = new DaisyDebugAdapterFactory();
  const debugTrackerFactory = new DaisyDebugAdapterTrackerFactory((mode) => manager?.sendAudioMode(mode));

  // Update status bar on debug session lifecycle
  vscode.debug.onDidStartDebugSession((session) => {
    if (session.type === DAISY_DEBUG_TYPE) {
      statusBar.text = '$(bug) Daisy: debugging';
      statusBar.tooltip = FIDELITY_CAVEAT;
    }
  });
  vscode.debug.onDidTerminateDebugSession((session) => {
    if (session.type === DAISY_DEBUG_TYPE) {
      statusBar.text = '$(debug-stop) Daisy: stopped';
      statusBar.tooltip = FIDELITY_CAVEAT;
    }
  });

  context.subscriptions.push(
    diagnostics,
    statusBar,
    vscode.debug.registerDebugAdapterDescriptorFactory(DAISY_DEBUG_TYPE, debugAdapterFactory),
    vscode.debug.registerDebugAdapterTrackerFactory(DAISY_DEBUG_TYPE, debugTrackerFactory),
    vscode.commands.registerCommand('ds-ide.build', () =>
      buildForEmulator(manager!, context.extensionPath, diagnostics),
    ),
    vscode.commands.registerCommand('ds-ide.deploy', async () => {
      statusBar.text = '$(loading~spin) Daisy: deploying…';
      statusBar.tooltip = FIDELITY_CAVEAT;
      const cfg = loadControllerConfig();
      potStore!.setDefaults(cfg.pots);
      buttonStore!.setDefaults(cfg.buttons);
      scopePanel!.show(
        cfg.pots, potStore!.getSnapshot(), sineState, audioSourceState,
        cfg.buttons, cfg.leds, buttonStore!.getSnapshot(),
      );
      await deployToEmulator(manager!);
      manager!.sendPotSnapshot(potStore!.getSnapshot());
      manager!.sendButtonSnapshot(buttonStore!.getSnapshot());
      manager!.sendSine(sineState.freq, sineState.amplitude);
      const mode = audioSourceState.input === 'live' ? 'realtime' : 'simulated';
      manager!.sendAudioMode(mode);
      manager!.sendAudioDevice(audioSourceState.sampleRate, audioSourceState.bufferSize);
      if (audioSourceState.input === 'wav' && audioSourceState.wavPath) {
        manager!.sendWavFile(audioSourceState.wavPath, audioSourceState.wavLoop);
      }
    }),
    vscode.commands.registerCommand('ds-ide.start', () => startAudio(manager!)),
    vscode.commands.registerCommand('ds-ide.stop', () => stopAudio(manager!)),
    vscode.commands.registerCommand('ds-ide.openControllerEditor', () => {
      const cfg = loadControllerConfig();
      scopePanel!.loadEditor(cfg);
    }),
    vscode.commands.registerCommand('ds-ide.debug', () => {
      statusBar.text = '$(loading~spin) Daisy: deploying…';
      statusBar.tooltip = FIDELITY_CAVEAT;
      const cfg = loadControllerConfig();
      potStore!.setDefaults(cfg.pots);
      buttonStore!.setDefaults(cfg.buttons);
      return debugDeploy(
        manager!,
        () => cfg.pots,
        (d, snap) => scopePanel!.show(
          d, snap, sineState, audioSourceState,
          cfg.buttons, cfg.leds, buttonStore!.getSnapshot(),
        ),
        () => potStore!.getSnapshot(),
        () => {
          manager!.sendButtonSnapshot(buttonStore!.getSnapshot());
          manager!.sendSine(sineState.freq, sineState.amplitude);
          const mode = audioSourceState.input === 'live' ? 'realtime' : 'simulated';
          manager!.sendAudioMode(mode);
          manager!.sendAudioDevice(audioSourceState.sampleRate, audioSourceState.bufferSize);
          if (audioSourceState.input === 'wav' && audioSourceState.wavPath) {
            manager!.sendWavFile(audioSourceState.wavPath, audioSourceState.wavLoop);
          }
        },
      );
    }),
    { dispose: () => { manager?.dispose(); scopePanel?.dispose(); } },
  );
}

export function deactivate(): void {
  manager?.dispose();
  scopePanel?.dispose();
}

function loadControllerConfig(): ControllerConfig {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.[0]) return { pots: [], buttons: [], leds: [], errors: [] };
  const yamlPath = path.join(folders[0].uri.fsPath, 'controllers.yaml');
  try {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const cfg = parseControllerConfig(text);
    for (const e of cfg.errors) {
      void vscode.window.showWarningMessage(`controllers.yaml: ${e}`);
    }
    return cfg;
  } catch {
    return { pots: [], buttons: [], leds: [], errors: [] };
  }
}
