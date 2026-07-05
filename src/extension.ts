import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { EmulatorManager, workspaceRuntimeDir } from './emulator/manager';
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
import { ControlsViewProvider } from './sidebar/controls-editor-panel';
import { WiringViewProvider } from './sidebar/wiring-editor-panel';
import { createEffectProject } from './commands/create-effect-project';
import * as os from 'os';
import { getString, getBoolean } from './ipc/narrow';
import { findEffectSource as _findEffectSource, EffectSourceOutsideWorkspaceError } from './commands/find-effect-source';
import { resolveActiveFolder, promptSelectActiveFolder } from './workspace/active-folder';

const FIDELITY_CAVEAT =
  'Emulator approximates the Seed — not bit-exact, does not validate hardware CPU/RAM budget.';

async function findEffectSource(folder: string): Promise<string | undefined> {
  const configured = vscode.workspace.getConfiguration('ds-ide').get<string>('effectSource');
  try {
    return await _findEffectSource(folder, configured);
  } catch (err) {
    if (err instanceof EffectSourceOutsideWorkspaceError) {
      void vscode.window.showErrorMessage(
        `ds-ide: ds-ide.effectSource points outside the workspace folder — refusing to use '${err.resolvedPath}'. Fix the setting to point inside '${err.workspaceRoot}'.`,
      );
      return undefined;
    }
    throw err;
  }
}

// Result of a marker-pair lookup: a unique, well-formed range; 'absent' when
// neither begin nor end appears at all (a legacy file that has never been
// wired); or 'ambiguous' for anything else (duplicated markers, or an
// end-before-begin) — a shape too broken to safely locate (FR-IPC-5).
type MarkerRange = { s: number; e: number } | 'absent' | 'ambiguous';

function findMarkerRange(lines: string[], begin: string, end: string): MarkerRange {
  const clean = lines.map(l => l.replace(/\r$/, ''));
  const beginIndices = clean.reduce<number[]>((acc, l, i) => { if (l === begin) acc.push(i); return acc; }, []);
  const endIndices = clean.reduce<number[]>((acc, l, i) => { if (l === end) acc.push(i); return acc; }, []);
  if (beginIndices.length === 0 && endIndices.length === 0) return 'absent';
  if (beginIndices.length !== 1 || endIndices.length !== 1) return 'ambiguous';
  const [s] = beginIndices;
  const [e] = endIndices;
  return e! > s! ? { s: s!, e: e! } : 'ambiguous';
}

export interface BlockEditResult {
  edit: vscode.WorkspaceEdit;
  // True when at least one marker pair doesn't exist in oldText yet — the
  // caller must get a one-time user confirmation before applying this edit,
  // since it appends brand-new marker blocks to a file that had none (FR-UX-3).
  needsAppendConfirmation: boolean;
}

// Build a WorkspaceEdit that replaces only the marker blocks that changed.
// Marker pairs already present are edited in place, independent of each
// other, so an established block's range is never touched just because a
// *different* block is missing or malformed (FR-UX-3). A marker pair with no
// prior occurrence at all is appended (flagged via needsAppendConfirmation);
// a duplicated/malformed marker pair still falls back to a full-file
// replacement, since its range can't be safely located (FR-IPC-5).
export function makeBlockEdit(
  doc: vscode.TextDocument,
  uri: vscode.Uri,
  oldText: string,
  newText: string,
): BlockEditResult {
  const MARKERS: Array<[string, string]> = [
    ['// ds-ide:controls:begin',      '// ds-ide:controls:end'],
    ['// ds-ide:controls:init:begin', '// ds-ide:controls:init:end'],
  ];
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  const pairResults = MARKERS.map(([begin, end]) => ({
    oldR: findMarkerRange(oldLines, begin, end),
    newR: findMarkerRange(newLines, begin, end),
  }));

  const edit = new vscode.WorkspaceEdit();

  const anyAmbiguous = pairResults.some(r => r.oldR === 'ambiguous' || r.newR === 'ambiguous');
  if (anyAmbiguous) {
    edit.replace(uri, new vscode.Range(new vscode.Position(0, 0), doc.lineAt(doc.lineCount - 1).range.end), newText);
    return { edit, needsAppendConfirmation: false };
  }

  let needsAppendConfirmation = false;
  const appendBlocks: string[] = [];

  for (const { oldR, newR } of pairResults) {
    if (typeof oldR === 'object' && typeof newR === 'object') {
      const newBlock = newLines.slice(newR.s, newR.e + 1).join('\n');
      edit.replace(uri, new vscode.Range(
        new vscode.Position(oldR.s, 0),
        doc.lineAt(oldR.e).range.end,
      ), newBlock);
    } else if (oldR === 'absent' && typeof newR === 'object') {
      needsAppendConfirmation = true;
      appendBlocks.push(newLines.slice(newR.s, newR.e + 1).join('\n'));
    }
    // oldR present but newR 'absent' does not occur in practice — the
    // generator (controls-writer.ts) never removes an existing block.
  }

  if (appendBlocks.length > 0) {
    edit.insert(uri, doc.lineAt(doc.lineCount - 1).range.end, `\n${appendBlocks.join('\n')}\n`);
  }

  return { edit, needsAppendConfirmation };
}

// One-time modal shown the first time a legacy effect source (no ds-ide
// marker blocks yet) needs them appended — replaces the previous silent
// full-file replacement fallback (FR-UX-3).
async function confirmAppendMarkerBlocks(): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage(
    'ds-ide: this effect source has no ds-ide marker blocks yet — append them now to enable wiring edits?',
    { modal: true },
    'Append',
  );
  return choice === 'Append';
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

// Owns the sine/audio-source/recording state that persists across redeploys
// within a session, plus its workspaceState persistence (FR-IPC-7).
class SessionState {
  sineState: SineParams;
  audioSourceState: AudioSource;
  activeRecordPath: string | undefined;

  constructor(private readonly workspaceState: vscode.Memento) {
    this.sineState = workspaceState.get<SineParams>('ds-ide.sine') ?? { ...SINE_DEFAULTS };
    this.audioSourceState = {
      ...AUDIO_SOURCE_DEFAULTS,
      ...workspaceState.get<Partial<AudioSource>>('ds-ide.audioSource'),
    };
  }

  setSine(freq: number, amplitude: number): void {
    this.sineState = { freq, amplitude };
    void this.workspaceState.update('ds-ide.sine', this.sineState);
  }

  setAudioSource(source: Partial<AudioSource>): void {
    this.audioSourceState = { ...this.audioSourceState, ...source };
    void this.workspaceState.update('ds-ide.audioSource', this.audioSourceState);
  }
}

// Single implementation of build/deploy/debug sequencing and the post-deploy
// state replay (sendPotSnapshot/sendButtonSnapshot/sendSine/sendAudioMode/
// sendAudioDevice/WAV), called identically by ds-ide.buildAndDeploy,
// ds-ide.deploy, and ds-ide.debug so the sequence can no longer diverge
// between commands (FR-IPC-7).
class DeployCoordinator {
  constructor(
    private readonly manager: EmulatorManager,
    private readonly statusBar: vscode.StatusBarItem,
    private readonly potStore: PotStore,
    private readonly buttonStore: ButtonStore,
    private readonly session: SessionState,
    private readonly scopePanel: ScopePanel,
    private readonly controlsProvider: ControlsViewProvider,
    private readonly diagnostics: vscode.DiagnosticCollection,
    private readonly buildChannel: vscode.OutputChannel,
    private readonly emulatorChannel: vscode.OutputChannel,
    private readonly extensionPath: string,
    private readonly loadControllerConfig: () => Promise<ControllerConfig>,
    private readonly workspaceState: vscode.Memento,
  ) {}

  private setDeploying(): void {
    this.statusBar.text = '$(loading~spin) Daisy: deploying…';
    this.statusBar.tooltip = FIDELITY_CAVEAT;
  }

  private setStopped(): void {
    this.statusBar.text = '$(debug-stop) Daisy: stopped';
    this.statusBar.tooltip = FIDELITY_CAVEAT;
  }

  sendPostDeployState(): void {
    this.manager.sendPotSnapshot(this.potStore.getSnapshot());
    this.manager.sendButtonSnapshot(this.buttonStore.getSnapshot());
    this.manager.sendSine(this.session.sineState.freq, this.session.sineState.amplitude);
    const mode = this.session.audioSourceState.input === 'live' ? 'realtime' : 'simulated';
    this.manager.sendAudioMode(mode);
    this.manager.sendAudioDevice(this.session.audioSourceState.sampleRate, this.session.audioSourceState.bufferSize);
    if (this.session.audioSourceState.input === 'wav' && this.session.audioSourceState.wavPath) {
      this.manager.sendWavFile(this.session.audioSourceState.wavPath, this.session.audioSourceState.wavLoop);
    }
  }

  async performDeploy(opts: { build: boolean; debug: boolean }): Promise<boolean> {
    if (opts.build) {
      const ok = await buildForEmulator(
        this.manager, this.extensionPath, this.diagnostics, this.buildChannel, this.workspaceState,
      );
      if (!ok) return false;
    }
    this.setDeploying();
    const cfg = await this.loadControllerConfig();
    this.potStore.setDefaults(cfg.pots);
    this.buttonStore.setDefaults(cfg.buttons);

    if (opts.debug) {
      await debugDeploy(
        this.manager,
        () => cfg.pots,
        () => this.scopePanel.show(this.session.sineState, this.session.audioSourceState),
        () => this.potStore.getSnapshot(),
        () => this.sendPostDeployState(),
        this.emulatorChannel,
      );
      return true;
    }

    const folder = resolveActiveFolder(this.workspaceState)?.uri.fsPath ?? '';
    this.scopePanel.show(this.session.sineState, this.session.audioSourceState);
    this.controlsProvider.loadEditor(cfg);
    this.controlsProvider.postControlsConfig(await buildControlsConfig(folder, cfg));
    void vscode.commands.executeCommand('workbench.view.extension.ds-ide-controls');
    const deployed = await deployToEmulator(this.manager, this.emulatorChannel);
    if (!deployed) {
      this.setStopped();
      return false;
    }
    this.sendPostDeployState();
    return true;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const potStore    = new PotStore(context.workspaceState);
  const buttonStore = new ButtonStore(context.workspaceState);
  const session = new SessionState(context.workspaceState);
  // Set when the last controllers.yaml read failed for a reason other than
  // "file does not exist" (e.g. EACCES, EMFILE, encoding). While true, saves
  // are refused so a transient read error can't silently overwrite the
  // user's real file with an empty config (FR-IPC-4).
  let controllerConfigUnreadable = false;
  // Tracks the last-warned validation error set so repeated saves with the
  // same unresolved errors don't re-toast on every keystroke-triggered save —
  // only a genuinely new or changed error set produces a new warning (FR-UX-2).
  let lastControllerConfigErrorsKey: string | undefined;

  async function loadControllerConfig(): Promise<ControllerConfig> {
    const folder = resolveActiveFolder(context.workspaceState);
    if (!folder) {
      controllerConfigUnreadable = false;
      return { pots: [], buttons: [], leds: [], errors: [] };
    }
    const yamlPath = path.join(folder.uri.fsPath, 'controllers.yaml');
    try {
      const text = await fs.promises.readFile(yamlPath, 'utf8');
      controllerConfigUnreadable = false;
      const cfg = parseControllerConfig(text);
      if (cfg.errors.length > 0) {
        const key = cfg.errors.join('\n');
        if (key !== lastControllerConfigErrorsKey) {
          lastControllerConfigErrorsKey = key;
          const summary = cfg.errors.length === 1
            ? cfg.errors[0]
            : `${cfg.errors.length} issues found — ${cfg.errors[0]}`;
          void vscode.window.showWarningMessage(`ds-ide: controllers.yaml: ${summary}`);
        }
      } else {
        lastControllerConfigErrorsKey = undefined;
      }
      return cfg;
    } catch (err) {
      // ENOENT is a legitimately empty project — anything else (EACCES,
      // EMFILE, encoding errors, ...) must not be silently treated the same
      // way, since a subsequent save would overwrite the user's real file
      // with an empty config (FR-IPC-4).
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
        controllerConfigUnreadable = false;
        return { pots: [], buttons: [], leds: [], errors: [] };
      }
      controllerConfigUnreadable = true;
      void vscode.window.showWarningMessage(
        `ds-ide: could not read controllers.yaml (${(err as NodeJS.ErrnoException)?.code ?? String(err)}) — treating as unreadable, not empty; edits will not be saved until this is resolved.`,
      );
      return { pots: [], buttons: [], leds: [], errors: [] };
    }
  }

  const manager = new EmulatorManager();

  // Remove stale UNIX socket files left by a previous crashed session of
  // *this* workspace only — scoped to its own runtime directory, never a
  // global /tmp sweep that could sever another concurrently running VS Code
  // window's live emulator socket (FR-EXT-2).
  {
    const activeFolder = resolveActiveFolder(context.workspaceState)?.uri.fsPath;
    if (activeFolder) {
      const buildDir = path.join(activeFolder, '.ds-ide', 'build');
      const runtimeDir = workspaceRuntimeDir(buildDir);
      void fs.promises.readdir(runtimeDir).then((entries) => {
        for (const entry of entries) {
          if (entry.endsWith('.sock')) {
            void fs.promises.unlink(path.join(runtimeDir, entry)).catch(() => { /* ignore already-gone */ });
          }
        }
      }).catch(() => { /* ignore readdir failure — directory may not exist yet */ });
    }
  }

  // One-time info when multiple workspace folders are present — the active
  // folder defaults to the persisted choice (or folder 0 until one is made),
  // and can be changed via the ds-ide.selectActiveFolder command (FR-UX-4).
  const _folders = vscode.workspace.workspaceFolders;
  if (_folders && _folders.length > 1) {
    const active = resolveActiveFolder(context.workspaceState);
    void (async () => {
      const choice = await vscode.window.showInformationMessage(
        `ds-ide: multiple workspace folders detected — operating on '${active?.name ?? _folders[0]!.name}'.`,
        'Select Folder…',
      );
      if (choice !== 'Select Folder…') return;
      const chosen = await promptSelectActiveFolder(context.workspaceState);
      if (chosen) void initViewsFromProject();
    })();
  }

  const diagnostics = vscode.languages.createDiagnosticCollection('ds-ide');
  const buildChannel    = vscode.window.createOutputChannel('Daisy IDE Build');
  const emulatorChannel = vscode.window.createOutputChannel('Daisy IDE Emulator');
  const hardwareChannel = vscode.window.createOutputChannel('Daisy IDE Hardware Build');
  const flashChannel    = vscode.window.createOutputChannel('Daisy IDE Flash');

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.text = '$(circuit-board) Daisy';
  statusBar.tooltip = FIDELITY_CAVEAT;
  statusBar.show();

  const controlsProvider = new ControlsViewProvider(
    context.extensionUri,
    (cfg) => {
      if (controllerConfigUnreadable) {
        void vscode.window.showWarningMessage(
          'ds-ide: controllers.yaml could not be read earlier — refusing to overwrite it until the underlying issue is fixed and the file is reloaded.',
        );
        return;
      }
      const folder = resolveActiveFolder(context.workspaceState);
      if (!folder) return;
      const yamlPath = path.join(folder.uri.fsPath, 'controllers.yaml');
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

  const wiringProvider = new WiringViewProvider(
    context.extensionUri,
    async (wp: WiredPin) => {
      const folder = resolveActiveFolder(context.workspaceState)?.uri.fsPath ?? '';
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
      const { edit, needsAppendConfirmation } = makeBlockEdit(doc, vscode.Uri.file(effectPath), oldText, newText);
      if (needsAppendConfirmation && !(await confirmAppendMarkerBlocks())) {
        return;
      }
      const applied = await vscode.workspace.applyEdit(edit);
      if (!applied) {
        void vscode.window.showErrorMessage('ds-ide: wiring edit could not be applied — source file was not changed.');
        return;
      }
      // Saved immediately so buildControlsConfig's disk read below sees the
      // same content as newText — otherwise the Controls view would disagree
      // with the Wiring view until the user manually saves (FR-IPC-5).
      await doc.save();
      const { controls } = parseControlsConvention(newText);
      const pins: WiredPin[] = controls.map(c => ({ pinNumber: c.pin, deviceType: c.kind as DeviceType, id: c.id }));
      wiringProvider?.postWiredPins(pins);
      const cfg = await loadControllerConfig();
      controlsProvider?.postControlsConfig(await buildControlsConfig(folder, cfg));
    },
    async (pinNumber: number, id: string) => {
      const folder = resolveActiveFolder(context.workspaceState)?.uri.fsPath ?? '';
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
      const { edit, needsAppendConfirmation } = makeBlockEdit(doc, vscode.Uri.file(effectPath), oldText, newText);
      if (needsAppendConfirmation && !(await confirmAppendMarkerBlocks())) {
        return;
      }
      const applied = await vscode.workspace.applyEdit(edit);
      if (!applied) {
        void vscode.window.showErrorMessage('ds-ide: wiring edit could not be applied — source file was not changed.');
        return;
      }
      // See the wire handler above (FR-IPC-5): save so the disk read inside
      // buildControlsConfig matches newText instead of the pre-edit content.
      await doc.save();
      const { controls } = parseControlsConvention(newText);
      const pins: WiredPin[] = controls.map(c => ({ pinNumber: c.pin, deviceType: c.kind as DeviceType, id: c.id }));
      wiringProvider?.postWiredPins(pins);
      const cfg = await loadControllerConfig();
      controlsProvider?.postControlsConfig(await buildControlsConfig(folder, cfg));
    },
  );

  const scopePanel = new ScopePanel(
    context.extensionUri,
    manager,
    (freq, amplitude) => {
      session.setSine(freq, amplitude);
    },
    (source) => {
      session.setAudioSource(source);
      const mode = source.input === 'live' ? 'realtime' : 'simulated';
      manager?.sendAudioMode(mode);
      manager?.sendAudioDevice(source.sampleRate, source.bufferSize);
      if (source.input === 'wav' && session.audioSourceState.wavPath) {
        manager?.sendWavFile(session.audioSourceState.wavPath, session.audioSourceState.wavLoop);
      } else {
        manager?.sendWavFile('', session.audioSourceState.wavLoop);
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
      session.setAudioSource({ input: 'wav', wavPath });
      manager?.sendAudioMode('simulated');
      manager?.sendAudioDevice(session.audioSourceState.sampleRate, session.audioSourceState.bufferSize);
      manager?.sendWavFile(wavPath, session.audioSourceState.wavLoop);
      scopePanel?.notifyWavSelected(path.basename(wavPath), wavPath);
    },
    async () => {
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(path.join(os.homedir(), 'session.dsrec')),
        filters: { 'Daisy Session': ['dsrec'] },
        saveLabel: 'Start Recording',
      });
      if (!uri) return;
      session.activeRecordPath = uri.fsPath;
      manager?.sendRecordStart(session.activeRecordPath);
      scopePanel?.notifyRecordingState(true, false, path.basename(session.activeRecordPath));
    },
    () => {
      manager?.sendRecordStop();
      scopePanel?.notifyRecordingState(false, false, session.activeRecordPath ? path.basename(session.activeRecordPath) : undefined);
      session.activeRecordPath = undefined;
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
      controlsProvider?.postStatus({ type: 'status', running: false });
    },
  );

  manager.on('message', (msg: IpcMessage) => {
    if (msg['type'] === 'event') {
      const kind = getString(msg, 'kind');
      if (kind === 'nan' || kind === 'inf') {
        void vscode.window.showWarningMessage(
          `ds-ide: audio ${kind.toUpperCase()} detected — effect may misbehave`,
        );
      }
    }
    if (msg['type'] === 'status') {
      const running = getBoolean(msg, 'running') ?? false;
      statusBar.text = running ? '$(play) Daisy: running' : '$(debug-stop) Daisy: stopped';
      statusBar.tooltip = FIDELITY_CAVEAT;
      controlsProvider?.postStatus(msg);
    }
    if (msg['type'] === 'led') {
      controlsProvider?.postLed(msg);
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

  const startSessionDisposable = vscode.debug.onDidStartDebugSession((debugSession) => {
    if (debugSession.type === DAISY_DEBUG_TYPE) {
      statusBar.text = '$(bug) Daisy: debugging';
      statusBar.tooltip = FIDELITY_CAVEAT;
    }
  });
  const terminateSessionDisposable = vscode.debug.onDidTerminateDebugSession((debugSession) => {
    if (debugSession.type === DAISY_DEBUG_TYPE) {
      statusBar.text = '$(debug-stop) Daisy: stopped';
      statusBar.tooltip = FIDELITY_CAVEAT;
    }
  });

  const deployCoordinator = new DeployCoordinator(
    manager, statusBar, potStore, buttonStore, session, scopePanel, controlsProvider,
    diagnostics, buildChannel, emulatorChannel, context.extensionPath, loadControllerConfig,
    context.workspaceState,
  );

  const runConfigProvider = new DaisyRunConfigurationProvider(
    () => deployCoordinator.performDeploy({ build: true, debug: false }),
    () => manager?.childPid,
  );

  async function initViewsFromProject(): Promise<void> {
    const activeFolder = resolveActiveFolder(context.workspaceState);
    if (!activeFolder) return;
    const folder = activeFolder.uri.fsPath;
    const cfg = await loadControllerConfig();
    controlsProvider.loadEditor(cfg);
    controlsProvider.postControlsConfig(await buildControlsConfig(folder, cfg));
    const effectPath = await findEffectSource(folder);
    let wiredPins: WiredPin[] = [];
    if (effectPath) {
      try {
        const text = await fs.promises.readFile(effectPath, 'utf8');
        const { controls } = parseControlsConvention(text);
        wiredPins = controls.map(c => ({ pinNumber: c.pin, deviceType: c.kind as DeviceType, id: c.id }));
      } catch { /* file unreadable — leave wiredPins empty */ }
    }
    wiringProvider.postWiredPins(wiredPins);
  }

  void initViewsFromProject();

  context.subscriptions.push(
    diagnostics,
    buildChannel,
    emulatorChannel,
    hardwareChannel,
    flashChannel,
    statusBar,
    vscode.window.registerWebviewViewProvider('ds-ide.controlsEditor', controlsProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.registerWebviewViewProvider('ds-ide.wiringEditor', wiringProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.debug.registerDebugAdapterDescriptorFactory(DAISY_DEBUG_TYPE, debugAdapterFactory),
    vscode.debug.registerDebugAdapterTrackerFactory(DAISY_DEBUG_TYPE, debugTrackerFactory),
    vscode.debug.registerDebugAdapterDescriptorFactory(DS_IDE_DEBUG_TYPE, new DsIdeDebugAdapterDescriptorFactory()),
    vscode.debug.registerDebugConfigurationProvider(DS_IDE_DEBUG_TYPE, runConfigProvider),
    vscode.workspace.onDidSaveTextDocument(async (doc) => {
      const activeFolder = resolveActiveFolder(context.workspaceState);
      if (!activeFolder) return;
      // Uses real workspace-folder membership (vscode.workspace.getWorkspaceFolder)
      // rather than a raw path prefix check — a sibling directory that merely
      // shares a string prefix with the active folder must not false-positive
      // here (FR-UX-4).
      const savedFolder = vscode.workspace.getWorkspaceFolder(doc.uri);
      if (!savedFolder || savedFolder.uri.fsPath !== activeFolder.uri.fsPath) return;
      const folder = activeFolder.uri.fsPath;
      const saved = doc.uri.fsPath;
      const yamlPath = path.join(folder, 'controllers.yaml');

      // Early exit before any I/O: only proceed for the yaml or a .cpp — the
      // getWorkspaceFolder check above already confirmed it's in-folder.
      const isYaml = saved === yamlPath;
      const mightBeSource = saved.endsWith('.cpp');
      if (!isYaml && !mightBeSource) return;

      const cfg = await loadControllerConfig();
      controlsProvider.loadEditor(cfg);
      controlsProvider.postControlsConfig(await buildControlsConfig(folder, cfg));

      if (mightBeSource) {
        const effectPath = await findEffectSource(folder);
        if (effectPath && saved === effectPath) {
          let pins: WiredPin[] = [];
          try {
            const text = await fs.promises.readFile(effectPath, 'utf8');
            const { controls } = parseControlsConvention(text);
            pins = controls.map(c => ({ pinNumber: c.pin, deviceType: c.kind as DeviceType, id: c.id }));
          } catch { /* unreadable */ }
          wiringProvider.postWiredPins(pins);
        }
      }
    }),
    vscode.commands.registerCommand('ds-ide.build', () =>
      buildForEmulator(manager, context.extensionPath, diagnostics, buildChannel, context.workspaceState),
    ),
    vscode.commands.registerCommand('ds-ide.buildAndDeploy', () =>
      deployCoordinator.performDeploy({ build: true, debug: false }),
    ),
    vscode.commands.registerCommand('ds-ide.deploy', () =>
      deployCoordinator.performDeploy({ build: false, debug: false }),
    ),
    vscode.commands.registerCommand('ds-ide.start', () => startAudio(manager)),
    vscode.commands.registerCommand('ds-ide.stop', () => {
      stopAudio(manager);
      scopePanel?.notifyStopped();
      controlsProvider?.postStatus({ type: 'status', running: false });
    }),
    vscode.commands.registerCommand('ds-ide.buildHardware', () => {
      const folder = resolveActiveFolder(context.workspaceState);
      if (!folder) {
        void vscode.window.showErrorMessage('ds-ide: no workspace folder open');
        return;
      }
      return buildForHardware(folder.uri.fsPath, diagnostics, hardwareChannel);
    }),
    vscode.commands.registerCommand('ds-ide.flash', () => {
      const folder = resolveActiveFolder(context.workspaceState);
      if (!folder) {
        void vscode.window.showErrorMessage('ds-ide: no workspace folder open');
        return;
      }
      return flashToHardware(folder.uri.fsPath, flashChannel);
    }),
    vscode.commands.registerCommand('ds-ide.debug', () =>
      deployCoordinator.performDeploy({ build: false, debug: true }),
    ),
    vscode.commands.registerCommand('ds-ide.createNewEffectProject', createEffectProject),
    vscode.commands.registerCommand('ds-ide.selectActiveFolder', async () => {
      const chosen = await promptSelectActiveFolder(context.workspaceState);
      if (chosen) void initViewsFromProject();
    }),
    { dispose: () => { manager?.dispose(); scopePanel?.dispose(); } },
    startSessionDisposable,
    terminateSessionDisposable,
  );
}

export function deactivate(): void {
  // disposables are registered in context.subscriptions — VS Code disposes them automatically
}
