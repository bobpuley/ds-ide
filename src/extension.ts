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
import { DaisyRunConfigurationProvider, DsIdeDebugAdapterDescriptorFactory, DS_IDE_DEBUG_TYPE } from './debug/run-config-provider';
import { parseControllerConfig, serializeControllerConfig, ControllerConfig } from './controllers/controller-config';
import { parseControlsConvention } from './controllers/controls-convention-parser';
import { ControlsConfig, ControlsPlacement } from './webview/scope-panel';
import { WiredPin, DeviceType } from './wiring/wiring-panel';
import { insertIntoSource, removeFromSource, insertInitIntoSource, removeInitFromSource } from './wiring/controls-writer';
import { PotStore } from './controllers/pot-store';
import { ButtonStore } from './controllers/button-store';
import { DaisyDebugAdapterFactory, DaisyDebugAdapterTrackerFactory } from './debug/debug-adapter';
import { buildForHardware } from './commands/hardware-build';
import { flashToHardware } from './commands/dfu-flash';
import { SineParams, SINE_DEFAULTS, AudioSource, AUDIO_SOURCE_DEFAULTS } from './webview/scope-panel';
import { ControlsViewProvider, CONTROLS_VIEW_ID } from './sidebar/controls-view-provider';
import { WiringViewProvider, WIRING_VIEW_ID } from './sidebar/wiring-view-provider';
import { createEffectProject } from './commands/create-effect-project';
import * as os from 'os';

const FIDELITY_CAVEAT =
  'Emulator approximates the Seed — not bit-exact, does not validate hardware CPU/RAM budget.';

async function findEffectSource(folder: string): Promise<string | undefined> {
  const configured = vscode.workspace.getConfiguration('ds-ide').get<string>('effectSource');
  if (configured) {
    const p = path.isAbsolute(configured) ? configured : path.join(folder, configured);
    try { await fs.promises.access(p); return p; } catch { /* path not accessible */ }
  }
  const cmake = path.join(folder, 'CMakeLists.txt');
  try { await fs.promises.access(cmake); } catch { return undefined; }
  const entries = await fs.promises.readdir(folder);
  for (const entry of entries) {
    if (typeof entry === 'string' && entry.endsWith('.cpp')) return path.join(folder, entry);
  }
  return undefined;
}

async function buildControlsConfig(folder: string, yamlCfg: ControllerConfig): Promise<ControlsConfig> {
  const placements: ControlsPlacement[] = [
    ...yamlCfg.pots.filter(p => p.pos).map(p => ({ id: p.id, pos: p.pos! })),
    ...yamlCfg.buttons.filter(b => b.pos).map(b => ({ id: b.id, pos: b.pos! })),
    ...yamlCfg.leds.filter(l => l.pos).map(l => ({ id: l.id, pos: l.pos! })),
  ];
  const effectPath = await findEffectSource(folder);
  if (!effectPath) return { controls: [], placements, missingBlock: true };
  try {
    const text = await fs.promises.readFile(effectPath, 'utf8');
    const { controls, missingBlock } = parseControlsConvention(text);
    return { controls, placements, missingBlock };
  } catch {
    return { controls: [], placements, missingBlock: true };
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const potStore    = new PotStore(context.workspaceState);
  const buttonStore = new ButtonStore(context.workspaceState);
  let sineState: SineParams = context.workspaceState.get<SineParams>('ds-ide.sine') ?? { ...SINE_DEFAULTS };
  let audioSourceState: AudioSource = {
    ...AUDIO_SOURCE_DEFAULTS,
    ...context.workspaceState.get<Partial<AudioSource>>('ds-ide.audioSource'),
  };
  let activeRecordPath: string | undefined;
  const manager = new EmulatorManager();

  const diagnostics = vscode.languages.createDiagnosticCollection('ds-ide');
  const buildChannel    = vscode.window.createOutputChannel('Daisy IDE Build');
  const emulatorChannel = vscode.window.createOutputChannel('Daisy IDE Emulator');
  const hardwareChannel = vscode.window.createOutputChannel('Daisy IDE Hardware Build');

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.text = '$(circuit-board) Daisy';
  statusBar.tooltip = FIDELITY_CAVEAT;
  statusBar.show();

  const controlsViewProvider = new ControlsViewProvider(
    (cfg) => {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders?.[0]) return;
      const yamlPath = path.join(folders[0].uri.fsPath, 'controllers.yaml');
      void fs.promises.writeFile(yamlPath, serializeControllerConfig(cfg), 'utf8').catch((err: unknown) => {
        void vscode.window.showErrorMessage(`ds-ide: could not write controllers.yaml: ${String(err)}`);
      });
    },
    (channel, value) => {
      potStore?.set(channel, value);
      manager?.sendPot(channel, value);
    },
    (gpioPin, pressed) => {
      buttonStore?.set(gpioPin, pressed);
      manager?.sendButton(gpioPin, pressed);
    },
  );

  const wiringViewProvider = new WiringViewProvider(
    async (wp: WiredPin) => {
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
      const effectPath = await findEffectSource(folder);
      if (!effectPath) {
        void vscode.window.showErrorMessage('ds-ide: no effect source file found — set ds-ide.effectSource');
        return;
      }
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(effectPath));
      const oldText = doc.getText();
      const afterDecl = insertIntoSource(oldText, wp.id, wp.deviceType as 'pot' | 'button' | 'led', wp.pinNumber);
      const { controls: controlsAfterDecl } = parseControlsConvention(afterDecl);
      const allPots = controlsAfterDecl.filter(c => c.kind === 'pot');
      const newText = insertInitIntoSource(afterDecl, wp.id, wp.deviceType as 'pot' | 'button' | 'led', wp.pinNumber, allPots);
      const edit = new vscode.WorkspaceEdit();
      const end = doc.lineAt(doc.lineCount - 1).range.end;
      edit.replace(vscode.Uri.file(effectPath), new vscode.Range(new vscode.Position(0, 0), end), newText);
      await vscode.workspace.applyEdit(edit);
      const { controls } = parseControlsConvention(newText);
      const pins: WiredPin[] = controls.map(c => ({ pinNumber: c.pin, deviceType: c.kind as DeviceType, id: c.id }));
      wiringViewProvider?.postWiredPins(pins);
      const cfg = await loadControllerConfig();
      controlsViewProvider?.postControlsConfig(await buildControlsConfig(folder, cfg));
    },
    async (pinNumber: number, id: string) => {
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
      const effectPath = await findEffectSource(folder);
      if (!effectPath) {
        void vscode.window.showErrorMessage('ds-ide: no effect source file found — set ds-ide.effectSource');
        return;
      }
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(effectPath));
      const oldText = doc.getText();
      const afterDecl = removeFromSource(oldText, id);
      const { controls: controlsAfterDecl } = parseControlsConvention(afterDecl);
      const allPots = controlsAfterDecl.filter(c => c.kind === 'pot');
      const newText = removeInitFromSource(afterDecl, id, allPots);
      const edit = new vscode.WorkspaceEdit();
      const end = doc.lineAt(doc.lineCount - 1).range.end;
      edit.replace(vscode.Uri.file(effectPath), new vscode.Range(new vscode.Position(0, 0), end), newText);
      await vscode.workspace.applyEdit(edit);
      const { controls } = parseControlsConvention(newText);
      const pins: WiredPin[] = controls.map(c => ({ pinNumber: c.pin, deviceType: c.kind as DeviceType, id: c.id }));
      wiringViewProvider?.postWiredPins(pins);
      const cfg = await loadControllerConfig();
      controlsViewProvider?.postControlsConfig(await buildControlsConfig(folder, cfg));
    },
  );

  const scopePanel = new ScopePanel(
    manager,
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
      if (source.input === 'wav' && audioSourceState.wavPath) {
        manager?.sendWavFile(audioSourceState.wavPath, audioSourceState.wavLoop);
      } else {
        manager?.sendWavFile('', audioSourceState.wavLoop);
      }
    },
    async () => {
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
    async () => {
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(path.join(os.homedir(), 'session.dsrec')),
        filters: { 'Daisy Session': ['dsrec'] },
        saveLabel: 'Start Recording',
      });
      if (!uri) return;
      activeRecordPath = uri.fsPath;
      manager?.sendRecordStart(activeRecordPath);
      scopePanel?.notifyRecordingState(true, false, path.basename(activeRecordPath));
    },
    () => {
      manager?.sendRecordStop();
      scopePanel?.notifyRecordingState(false, false, activeRecordPath ? path.basename(activeRecordPath) : undefined);
      activeRecordPath = undefined;
    },
    async () => {
      const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: 'Replay',
        filters: { 'Daisy Session': ['dsrec'] },
      });
      const uri = picked?.[0];
      if (!uri) return;
      scopePanel?.notifyRecordingState(false, true, path.basename(uri.fsPath));
      manager?.sendReplayStart(uri.fsPath);
    },
    undefined,
    () => {
      controlsViewProvider?.postStatus({ type: 'status', running: false });
    },
  );

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
      controlsViewProvider?.postStatus(msg);
    }
    if (msg['type'] === 'led') {
      controlsViewProvider?.postLed(msg);
    }
  });

  manager.on('disconnect', () => {
    statusBar.text = '$(warning) Daisy: crashed';
    statusBar.tooltip = FIDELITY_CAVEAT;
    void vscode.window.showErrorMessage(
      'ds-ide: emulator disconnected unexpectedly — redeploy to restart.',
    );
  });

  const debugAdapterFactory = new DaisyDebugAdapterFactory();
  const debugTrackerFactory = new DaisyDebugAdapterTrackerFactory((mode) => manager?.sendAudioMode(mode));

  const startSessionDisposable = vscode.debug.onDidStartDebugSession((session) => {
    if (session.type === DAISY_DEBUG_TYPE) {
      statusBar.text = '$(bug) Daisy: debugging';
      statusBar.tooltip = FIDELITY_CAVEAT;
    }
  });
  const terminateSessionDisposable = vscode.debug.onDidTerminateDebugSession((session) => {
    if (session.type === DAISY_DEBUG_TYPE) {
      statusBar.text = '$(debug-stop) Daisy: stopped';
      statusBar.tooltip = FIDELITY_CAVEAT;
    }
  });

  async function performBuildAndDeploy(): Promise<boolean> {
    const ok = await buildForEmulator(manager, context.extensionPath, diagnostics, buildChannel);
    if (!ok) return false;
    statusBar.text = '$(loading~spin) Daisy: deploying…';
    statusBar.tooltip = FIDELITY_CAVEAT;
    const cfg = await loadControllerConfig();
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    potStore.setDefaults(cfg.pots);
    buttonStore.setDefaults(cfg.buttons);
    scopePanel.show(sineState, audioSourceState);
    controlsViewProvider.loadEditor(cfg);
    controlsViewProvider.postControlsConfig(await buildControlsConfig(folder, cfg));
    const deployed = await deployToEmulator(manager, emulatorChannel);
    if (!deployed) {
      statusBar.text = '$(debug-stop) Daisy: stopped';
      statusBar.tooltip = FIDELITY_CAVEAT;
      return false;
    }
    manager.sendPotSnapshot(potStore.getSnapshot());
    manager.sendButtonSnapshot(buttonStore.getSnapshot());
    manager.sendSine(sineState.freq, sineState.amplitude);
    const mode = audioSourceState.input === 'live' ? 'realtime' : 'simulated';
    manager.sendAudioMode(mode);
    manager.sendAudioDevice(audioSourceState.sampleRate, audioSourceState.bufferSize);
    if (audioSourceState.input === 'wav' && audioSourceState.wavPath) {
      manager.sendWavFile(audioSourceState.wavPath, audioSourceState.wavLoop);
    }
    return true;
  }

  const runConfigProvider = new DaisyRunConfigurationProvider(
    performBuildAndDeploy,
    () => manager?.childPid,
  );

  async function initViewsFromProject(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.[0]) return;
    const folder = folders[0].uri.fsPath;
    const cfg = await loadControllerConfig();
    controlsViewProvider.loadEditor(cfg);
    controlsViewProvider.postControlsConfig(await buildControlsConfig(folder, cfg));
    const effectPath = await findEffectSource(folder);
    let wiredPins: WiredPin[] = [];
    if (effectPath) {
      try {
        const text = await fs.promises.readFile(effectPath, 'utf8');
        const { controls } = parseControlsConvention(text);
        wiredPins = controls.map(c => ({ pinNumber: c.pin, deviceType: c.kind as DeviceType, id: c.id }));
      } catch { /* file unreadable — leave wiredPins empty */ }
    }
    wiringViewProvider.postWiredPins(wiredPins);
  }

  void initViewsFromProject();

  // Mutual exclusion: when one sidebar panel becomes visible, collapse the other.
  // VS Code has no public collapse API for WebviewViews. Workaround:
  //   1. Focus the sibling (makes it the active section in the sidebar).
  //   2. Call workbench.action.collapseSection (collapses the currently active section).
  //   3. Re-focus the panel that just became visible.
  // Only runs if the sibling is actually expanded (visible) to avoid a flash.
  let _exclusionGuard = false;

  async function collapseSibling(siblingId: string, selfId: string): Promise<void> {
    await vscode.commands.executeCommand(`${siblingId}.focus`);
    await vscode.commands.executeCommand('workbench.action.collapseSection');
    await vscode.commands.executeCommand(`${selfId}.focus`);
  }

  controlsViewProvider.setOnBecameVisible(() => {
    if (!_exclusionGuard && wiringViewProvider.isVisible) {
      _exclusionGuard = true;
      void collapseSibling(WIRING_VIEW_ID, CONTROLS_VIEW_ID)
        .catch(() => { /* best-effort: collapseSection may not exist in all VS Code builds */ })
        .finally(() => { _exclusionGuard = false; });
    }
  });
  wiringViewProvider.setOnBecameVisible(() => {
    if (!_exclusionGuard && controlsViewProvider.isVisible) {
      _exclusionGuard = true;
      void collapseSibling(CONTROLS_VIEW_ID, WIRING_VIEW_ID)
        .catch(() => { /* best-effort */ })
        .finally(() => { _exclusionGuard = false; });
    }
  });

  context.subscriptions.push(
    diagnostics,
    buildChannel,
    emulatorChannel,
    hardwareChannel,
    statusBar,
    vscode.debug.registerDebugAdapterDescriptorFactory(DAISY_DEBUG_TYPE, debugAdapterFactory),
    vscode.debug.registerDebugAdapterTrackerFactory(DAISY_DEBUG_TYPE, debugTrackerFactory),
    vscode.debug.registerDebugAdapterDescriptorFactory(DS_IDE_DEBUG_TYPE, new DsIdeDebugAdapterDescriptorFactory()),
    vscode.debug.registerDebugConfigurationProvider(DS_IDE_DEBUG_TYPE, runConfigProvider),
    vscode.window.registerWebviewViewProvider(CONTROLS_VIEW_ID, controlsViewProvider),
    vscode.window.registerWebviewViewProvider(WIRING_VIEW_ID, wiringViewProvider),
    vscode.workspace.onDidSaveTextDocument(async (doc) => {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders?.[0]) return;
      const folder = folders[0].uri.fsPath;
      const saved = doc.uri.fsPath;
      const yamlPath = path.join(folder, 'controllers.yaml');

      // Early exit before any I/O: only proceed for the yaml or a .cpp in the workspace
      const isYaml = saved === yamlPath;
      const mightBeSource = saved.endsWith('.cpp') && saved.startsWith(folder);
      if (!isYaml && !mightBeSource) return;

      const cfg = await loadControllerConfig();
      controlsViewProvider.loadEditor(cfg);
      controlsViewProvider.postControlsConfig(await buildControlsConfig(folder, cfg));

      if (mightBeSource) {
        const effectPath = await findEffectSource(folder);
        if (effectPath && saved === effectPath) {
          let pins: WiredPin[] = [];
          try {
            const text = await fs.promises.readFile(effectPath, 'utf8');
            const { controls } = parseControlsConvention(text);
            pins = controls.map(c => ({ pinNumber: c.pin, deviceType: c.kind as DeviceType, id: c.id }));
          } catch { /* unreadable */ }
          wiringViewProvider.postWiredPins(pins);
        }
      }
    }),
    vscode.commands.registerCommand('ds-ide.build', () =>
      buildForEmulator(manager, context.extensionPath, diagnostics, buildChannel),
    ),
    vscode.commands.registerCommand('ds-ide.buildAndDeploy', performBuildAndDeploy),
    vscode.commands.registerCommand('ds-ide.deploy', async () => {
      statusBar.text = '$(loading~spin) Daisy: deploying…';
      statusBar.tooltip = FIDELITY_CAVEAT;
      const cfg = await loadControllerConfig();
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
      potStore.setDefaults(cfg.pots);
      buttonStore.setDefaults(cfg.buttons);
      scopePanel.show(sineState, audioSourceState);
      controlsViewProvider.loadEditor(cfg);
      controlsViewProvider.postControlsConfig(await buildControlsConfig(folder, cfg));
      const deployed = await deployToEmulator(manager, emulatorChannel);
      if (!deployed) {
        statusBar.text = '$(debug-stop) Daisy: stopped';
        statusBar.tooltip = FIDELITY_CAVEAT;
        return;
      }
      manager.sendPotSnapshot(potStore.getSnapshot());
      manager.sendButtonSnapshot(buttonStore.getSnapshot());
      manager.sendSine(sineState.freq, sineState.amplitude);
      const mode = audioSourceState.input === 'live' ? 'realtime' : 'simulated';
      manager.sendAudioMode(mode);
      manager.sendAudioDevice(audioSourceState.sampleRate, audioSourceState.bufferSize);
      if (audioSourceState.input === 'wav' && audioSourceState.wavPath) {
        manager.sendWavFile(audioSourceState.wavPath, audioSourceState.wavLoop);
      }
    }),
    vscode.commands.registerCommand('ds-ide.start', () => startAudio(manager)),
    vscode.commands.registerCommand('ds-ide.stop', () => {
      stopAudio(manager);
      scopePanel?.notifyStopped();
      controlsViewProvider?.postStatus({ type: 'status', running: false });
    }),
    vscode.commands.registerCommand('ds-ide.openControllerEditor', async () => {
      const cfg = await loadControllerConfig();
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
      void vscode.commands.executeCommand(`${CONTROLS_VIEW_ID}.focus`);
      controlsViewProvider.loadEditor(cfg);
      controlsViewProvider.postControlsConfig(await buildControlsConfig(folder, cfg));
    }),
    vscode.commands.registerCommand('ds-ide.buildHardware', () => {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders?.[0]) {
        void vscode.window.showErrorMessage('ds-ide: no workspace folder open');
        return;
      }
      return buildForHardware(folders[0].uri.fsPath, diagnostics, {}, hardwareChannel);
    }),
    vscode.commands.registerCommand('ds-ide.flash', () => {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders?.[0]) {
        void vscode.window.showErrorMessage('ds-ide: no workspace folder open');
        return;
      }
      return flashToHardware(folders[0].uri.fsPath);
    }),
    vscode.commands.registerCommand('ds-ide.debug', async () => {
      statusBar.text = '$(loading~spin) Daisy: deploying…';
      statusBar.tooltip = FIDELITY_CAVEAT;
      const cfg = await loadControllerConfig();
      potStore.setDefaults(cfg.pots);
      buttonStore.setDefaults(cfg.buttons);
      return debugDeploy(
        manager,
        () => cfg.pots,
        (_defs, _snap) => scopePanel.show(sineState, audioSourceState),
        () => potStore.getSnapshot(),
        () => {
          manager.sendButtonSnapshot(buttonStore.getSnapshot());
          manager.sendSine(sineState.freq, sineState.amplitude);
          const mode = audioSourceState.input === 'live' ? 'realtime' : 'simulated';
          manager.sendAudioMode(mode);
          manager.sendAudioDevice(audioSourceState.sampleRate, audioSourceState.bufferSize);
          if (audioSourceState.input === 'wav' && audioSourceState.wavPath) {
            manager.sendWavFile(audioSourceState.wavPath, audioSourceState.wavLoop);
          }
        },
        emulatorChannel,
      );
    }),
    vscode.commands.registerCommand('ds-ide.createNewEffectProject', createEffectProject),
    vscode.commands.registerCommand('ds-ide.openWiringEditor', async () => {
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
      const effectPath = await findEffectSource(folder);
      let wiredPins: WiredPin[] = [];
      if (effectPath) {
        try {
          const text = await fs.promises.readFile(effectPath, 'utf8');
          const { controls } = parseControlsConvention(text);
          wiredPins = controls.map(c => ({ pinNumber: c.pin, deviceType: c.kind as DeviceType, id: c.id }));
        } catch { /* file unreadable — open editor with empty state */ }
      }
      wiringViewProvider.postWiredPins(wiredPins);
      await vscode.commands.executeCommand(`${WIRING_VIEW_ID}.focus`);
    }),
    { dispose: () => { manager?.dispose(); scopePanel?.dispose(); } },
    startSessionDisposable,
    terminateSessionDisposable,
  );
}

export function deactivate(): void {
  // disposables are registered in context.subscriptions — VS Code disposes them automatically
}

async function loadControllerConfig(): Promise<ControllerConfig> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.[0]) return { pots: [], buttons: [], leds: [], errors: [] };
  const yamlPath = path.join(folders[0].uri.fsPath, 'controllers.yaml');
  try {
    const text = await fs.promises.readFile(yamlPath, 'utf8');
    const cfg = parseControllerConfig(text);
    for (const e of cfg.errors) {
      void vscode.window.showWarningMessage(`controllers.yaml: ${e}`);
    }
    return cfg;
  } catch {
    return { pots: [], buttons: [], leds: [], errors: [] };
  }
}
