import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { EmulatorManager, sweepStaleSockets, workspaceRuntimeDir, NOTHING_BUILT_MESSAGE } from './emulator/manager';
import { IpcMessage, IpcWarning } from './emulator/ipc-client';
import { ScopePanel } from './webview/scope-panel';
import { OledPanel } from './webview/oled-panel';
import { MidiPanel } from './webview/midi-panel';
import { HostMidiBridge } from './midi/host-bridge';
import { buildForEmulator } from './commands/build';
import { deployToEmulator } from './commands/deploy';
import { startAudio, stopAudio } from './commands/transport';
import { debugDeploy, DAISY_DEBUG_TYPE } from './commands/debug-deploy';
import {
  DaisyRunConfigurationProvider, DsIdeDebugAdapterDescriptorFactory, DS_IDE_DEBUG_TYPE, DS_IDE_LAUNCH_CONFIG,
} from './debug/run-config-provider';
import { parseControllerConfig, serializeControllerConfig, ControllerConfig } from './controllers/controller-config';
import { parseControlsConvention } from './controllers/controls-convention-parser';
import { ControlsConfig, ControlsPlacement } from './webview/scope-panel';
import { WiredPin, DeviceType, PIN_DEFS, expandToWiredPins } from './wiring/wiring-panel';
import { insertIntoSource, removeFromSource, insertInitIntoSource, removeInitFromSource } from './wiring/controls-writer';
import { computeDropTargets, occupancyFromSource } from './wiring/drop-targets';
import { REGISTRY } from './devices/registry';
import type { Attachment } from './devices/attachment';
import { peripheralEditText } from './wiring/peripheral-config';
import {
  computePeripheralDisplayStates, PeripheralDisplayState, currentBusOf, isPeripheralEnabled,
} from './wiring/peripheral-state';
import {
  checkConflict, buildOccupants, formatRejection, candidateBusesFor, removeOccupantsFromSource,
} from './wiring/conflict-remedy';
import { PotStore } from './controllers/pot-store';
import { ButtonStore } from './controllers/button-store';
import { ToggleStore } from './controllers/toggle-store';
import { DaisyDebugAdapterFactory, DaisyDebugAdapterTrackerFactory } from './debug/debug-adapter';
import { buildForHardware } from './commands/hardware-build';
import { flashToHardware } from './commands/dfu-flash';
import { SineParams, SINE_DEFAULTS, AudioSource, AUDIO_SOURCE_DEFAULTS, GeneratorParamsMap } from './webview/scope-panel';
import { GENERATOR_DEFAULTS, clampParams, isGeneratorId, type GeneratorId, type GeneratorParams } from './webview/scope/scope-generators';
import { SdEntry, sortSdEntries, SD_PREVIEW_MAX_BYTES } from './webview/sd-viewer';
import { ControlsViewProvider } from './sidebar/controls-editor-panel';
import { WiringViewProvider } from './sidebar/wiring-editor-panel';
import { createEffectProject } from './commands/create-effect-project';
import { addAiGuideToProject } from './commands/add-ai-guide';
import { ManagedToolchainService, vscodeToolchainUi } from './toolchain/managed-toolchain-ui';
import * as os from 'os';
import { getString } from './ipc/narrow';
// FR-EXT-10: the resolution/error-handling wrapper is shared with the build
// command (build.ts) rather than duplicated, so the ds-ide.effectSource
// setting can't drift out of sync between call sites.
import { resolveConfiguredEffectSource as findEffectSource } from './commands/find-effect-source';
import {
  TransportController, wireTransportEvents, wireTransportNotifications, isBuildSource, countErrors,
} from './transport/transport-controller';
import { isTransportBusy, type BoardInfo, type TransportMode } from './transport/transport-state';
import { detectBoard } from './hardware/board-detect';
import { TransportStatusItems } from './transport/status-items';
import { DaisyViewProvider, DAISY_VIEW_ID, formatAudioDetail, withViewProgress } from './views/daisy-view';
import { resolveActiveFolder, promptSelectActiveFolder } from './workspace/active-folder';
import { createProjectFileWatcher } from './workspace/project-watcher';

const FIDELITY_CAVEAT =
  'Emulator approximates the Seed — not bit-exact, does not validate hardware CPU/RAM budget.';

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

// FR-UDM-4: where a placed device's generated declaration lives — a control
// by its `// ds-ide: id=<id>, …` annotation inside the controls block, a
// bus/connector peripheral by its codegen's declaration line inside the
// peripherals block. Only a unique, well-formed marker block is searched
// (same findMarkerRange rule the edit path uses), so a hand-edited or
// duplicated block never yields a wrong line.
export type DeviceDeclarationLookup = { line: number } | 'not-found' | 'ambiguous';

export function findDeviceDeclarationLine(source: string, id: string): DeviceDeclarationLookup {
  const lines = source.split('\n');
  const periphCodegen = REGISTRY[id]?.peripheralCodegen;
  const [begin, end] = periphCodegen
    ? ['// ds-ide:peripherals:begin', '// ds-ide:peripherals:end']
    : ['// ds-ide:controls:begin', '// ds-ide:controls:end'];
  const range = findMarkerRange(lines, begin, end);
  if (range === 'ambiguous') return 'ambiguous';
  if (range === 'absent') return 'not-found';
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const annotation = new RegExp(`// ds-ide:\\s*id=${escaped}\\s*,`);
  for (let i = range.s + 1; i < range.e; i++) {
    const line = lines[i]!.replace(/\r$/, '');
    if (periphCodegen ? periphCodegen.isDeclLine(line) : annotation.test(line)) return { line: i };
  }
  return 'not-found';
}

// FR-UDM-4: opens the effect source and selects + reveals the device's
// declaration; warns (naming the device) rather than guessing when it can't
// be located.
export async function revealDeviceInCode(effectPath: string, id: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(effectPath));
  const found = findDeviceDeclarationLine(doc.getText(), id);
  if (typeof found !== 'object') {
    const name = REGISTRY[id]?.peripheralCodegen ? REGISTRY[id]!.label : id;
    void vscode.window.showWarningMessage(
      found === 'ambiguous'
        ? `ds-ide: can't reveal ${name} — its ds-ide marker block is duplicated or malformed.`
        : `ds-ide: can't find the generated code for ${name} — its ds-ide marker block may have been edited by hand.`,
    );
    return;
  }
  const editor = await vscode.window.showTextDocument(doc);
  const endChar = doc.lineAt(found.line).text.length;
  editor.selection = new vscode.Selection(found.line, 0, found.line, endChar);
  editor.revealRange(new vscode.Range(found.line, 0, found.line, endChar), vscode.TextEditorRevealType.InCenter);
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
    // FR-DEV-11: a bus peripheral's enable/disable edit lives in its own
    // marker pair, entirely separate from the wired-controls ones above, so
    // toggling a peripheral never touches the controls block and vice versa.
    ['// ds-ide:peripherals:begin',      '// ds-ide:peripherals:end'],
    ['// ds-ide:peripherals:init:begin', '// ds-ide:peripherals:init:end'],
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

// FR-SD-1: root-level listing only (matches the request's "root content
// list" scope — recursive browsing is future work). Missing ./sdcard/
// (peripheral never enabled, or nothing written yet) is treated as empty
// rather than an error.
async function readSdCardEntries(folder: string): Promise<SdEntry[]> {
  const dir = path.join(folder, 'sdcard');
  try {
    const names = await fs.promises.readdir(dir);
    const entries = await Promise.all(names.map(async (name): Promise<SdEntry | null> => {
      try {
        const stat = await fs.promises.stat(path.join(dir, name));
        return stat.isFile() ? { name, size: stat.size } : null;
      } catch {
        return null;
      }
    }));
    return sortSdEntries(entries.filter((e): e is SdEntry => e !== null));
  } catch {
    return [];
  }
}

// `name` is untrusted webview input — reject anything that isn't a bare
// root-level filename before it ever reaches path.join (FR-IPC-3-style
// guard, same convention as the wiring handlers' id-regex checks).
async function readSdCardPreview(folder: string, name: string): Promise<string | null> {
  if (!name || name.includes('/') || name.includes('\\') || name === '..') return null;
  const filePath = path.join(folder, 'sdcard', name);
  try {
    const buf = await fs.promises.readFile(filePath);
    const capped = buf.subarray(0, SD_PREVIEW_MAX_BYTES);
    return new TextDecoder('utf-8', { fatal: true }).decode(capped);
  } catch {
    return null;
  }
}

async function buildControlsConfig(folder: string, yamlCfg: ControllerConfig): Promise<ControlsConfig> {
  const placements: ControlsPlacement[] = [
    ...yamlCfg.pots.filter(p => p.pos).map(p => ({ id: p.id, pos: p.pos! })),
    ...yamlCfg.buttons.filter(b => b.pos).map(b => ({ id: b.id, pos: b.pos! })),
    ...yamlCfg.leds.filter(l => l.pos).map(l => ({ id: l.id, pos: l.pos! })),
    // FR-CE-3
    ...yamlCfg.encoders.filter(e => e.pos).map(e => ({ id: e.id, pos: e.pos! })),
    ...yamlCfg.toggles.filter(t => t.pos).map(t => ({ id: t.id, pos: t.pos! })),
    ...yamlCfg.rgbleds.filter(r => r.pos).map(r => ({ id: r.id, pos: r.pos! })),
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
  // FR-GEN-4: the parameters of each generator other than Sine, remembered for the session.
  generatorState: GeneratorParamsMap;
  activeRecordPath: string | undefined;

  constructor(private readonly workspaceState: vscode.Memento) {
    this.sineState = workspaceState.get<SineParams>('ds-ide.sine') ?? { ...SINE_DEFAULTS };
    this.audioSourceState = {
      ...AUDIO_SOURCE_DEFAULTS,
      ...workspaceState.get<Partial<AudioSource>>('ds-ide.audioSource'),
    };
    this.generatorState = workspaceState.get<GeneratorParamsMap>('ds-ide.generators') ?? {};
  }

  setGenerator(kind: GeneratorId, params: GeneratorParams): void {
    if (kind === 'sine') return;
    this.generatorState = { ...this.generatorState, [kind]: params };
    void this.workspaceState.update('ds-ide.generators', this.generatorState);
  }

  /** Remembered parameters of a generator, completed with the defaults. */
  generatorParams(kind: GeneratorId): GeneratorParams {
    return clampParams({ ...GENERATOR_DEFAULTS, ...(kind === 'sine' ? {} : this.generatorState[kind]) });
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
// state replay (sendControlSnapshot/sendSine/sendAudioMode/sendAudioDevice/
// WAV), called identically by ds-ide.buildAndDeploy,
// ds-ide.deploy, and ds-ide.debug so the sequence can no longer diverge
// between commands (FR-IPC-7).
// FR-EXT-30: grouped by concern (stores/panels/channels) rather than 17 flat
// positional parameters — the prior constructor had three PotStore/
// ButtonStore/ToggleStore params and three ScopePanel/OledPanel/MidiPanel
// params sitting adjacent to each other, exactly the shape where a
// transposed pair at a call site type-checks silently.
interface DeployCoordinatorOptions {
  manager: EmulatorManager;
  stores: { pot: PotStore; button: ButtonStore; toggle: ToggleStore };
  session: SessionState;
  panels: { scope: ScopePanel; oled: OledPanel; midi: MidiPanel };
  controlsProvider: ControlsViewProvider;
  diagnostics: vscode.DiagnosticCollection;
  channels: { build: vscode.OutputChannel; emulator: vscode.OutputChannel };
  extensionPath: string;
  loadControllerConfig: () => Promise<ControllerConfig>;
  workspaceState: vscode.Memento;
  // FR-CE-1 follow-up: the single shared, staleness-guarded computation
  // every other controls-refresh trigger also routes through (see
  // computeControlsConfig() in activate()) — deploy needs the computed
  // value even in debug mode (for togglePins below) but only pushes it
  // to the Controls Editor outside debug mode, so it can't use the
  // simpler refreshControlsView() wrapper those triggers share.
  computeControlsConfig: (folder: string, cfg: ControllerConfig) => Promise<ControlsConfig | undefined>;
  // FR-TRN-4: every build/deploy step is reported to the transport state, and
  // runs under a token the Daisy view's Cancel action can cancel.
  transport: TransportController;
}

class DeployCoordinator {
  private readonly manager: EmulatorManager;
  private readonly potStore: PotStore;
  private readonly buttonStore: ButtonStore;
  private readonly toggleStore: ToggleStore;
  private readonly session: SessionState;
  private readonly scopePanel: ScopePanel;
  private readonly oledPanel: OledPanel;
  private readonly midiPanel: MidiPanel;
  private readonly controlsProvider: ControlsViewProvider;
  private readonly diagnostics: vscode.DiagnosticCollection;
  private readonly buildChannel: vscode.OutputChannel;
  private readonly emulatorChannel: vscode.OutputChannel;
  private readonly extensionPath: string;
  private readonly loadControllerConfig: () => Promise<ControllerConfig>;
  private readonly workspaceState: vscode.Memento;
  private readonly computeControlsConfig: (folder: string, cfg: ControllerConfig) => Promise<ControlsConfig | undefined>;
  private readonly transport: TransportController;

  constructor(opts: DeployCoordinatorOptions) {
    this.manager = opts.manager;
    this.potStore = opts.stores.pot;
    this.buttonStore = opts.stores.button;
    this.toggleStore = opts.stores.toggle;
    this.session = opts.session;
    this.scopePanel = opts.panels.scope;
    this.oledPanel = opts.panels.oled;
    this.midiPanel = opts.panels.midi;
    this.controlsProvider = opts.controlsProvider;
    this.diagnostics = opts.diagnostics;
    this.buildChannel = opts.channels.build;
    this.emulatorChannel = opts.channels.emulator;
    this.extensionPath = opts.extensionPath;
    this.loadControllerConfig = opts.loadControllerConfig;
    this.workspaceState = opts.workspaceState;
    this.computeControlsConfig = opts.computeControlsConfig;
    this.transport = opts.transport;
  }

  // FR-DEV-15: unlike scopePanel (always shown — audio is core), the OLED
  // viewer only opens when the deployed effect actually enables it; popping
  // it for every effect regardless would be noise.
  private async showOledIfEnabled(): Promise<void> {
    const folder = resolveActiveFolder(this.workspaceState)?.uri.fsPath ?? '';
    const effectPath = await findEffectSource(folder);
    if (!effectPath) return;
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(effectPath));
    const state = computePeripheralDisplayStates(doc.getText()).find(p => p.id === 'oled');
    if (state?.enabled) this.oledPanel.show(state.bus);
  }

  // FR-DEV-18: mirrors showOledIfEnabled — opens the MIDI panel only when
  // the deployed effect actually enables a MIDI peripheral (midiTrs or
  // midiUsb; either is enough, since the panel's keyboard/monitor aren't
  // specific to one transport).
  private async showMidiIfEnabled(): Promise<void> {
    const folder = resolveActiveFolder(this.workspaceState)?.uri.fsPath ?? '';
    const effectPath = await findEffectSource(folder);
    if (!effectPath) return;
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(effectPath));
    const states = computePeripheralDisplayStates(doc.getText());
    const enabled = states.some(p => (p.id === 'midiTrs' || p.id === 'midiUsb') && p.enabled);
    if (enabled) this.midiPanel.show();
  }

  sendPostDeployState(): void {
    this.manager.sendControlSnapshot(
      this.potStore.getSnapshot(), this.buttonStore.getSnapshot(), this.toggleStore.getSnapshot(),
    );
    this.manager.sendSine(this.session.sineState.freq, this.session.sineState.amplitude);
    // FR-GEN-4: Sine uses the sine message above; any other generator is re-selected after it.
    const input = this.session.audioSourceState.input;
    if (isGeneratorId(input) && input !== 'sine') this.manager.sendGenerator(input, this.session.generatorParams(input));
    const mode = this.session.audioSourceState.input === 'live' ? 'realtime' : 'simulated';
    this.manager.sendAudioMode(mode);
    this.manager.sendAudioDevice(this.session.audioSourceState.sampleRate, this.session.audioSourceState.bufferSize);
    if (this.session.audioSourceState.input === 'wav' && this.session.audioSourceState.wavPath) {
      this.manager.sendWavFile(this.session.audioSourceState.wavPath, this.session.audioSourceState.wavLoop);
    }
  }

  // `mode` is the transport mode the deploy is for; it defaults from `debug`
  // (the granular ds-ide.debug path) but F5 passes 'debug' with debug:false,
  // since the ds-ide session attaches the debugger itself (FR-TRN-2).
  async performDeploy(
    opts: { build: boolean; debug: boolean; mode?: TransportMode },
    token?: vscode.CancellationToken,
  ): Promise<boolean> {
    const mode = opts.mode ?? (opts.debug ? 'debug' : 'run');
    return this.transport.trackWork(token, async (workToken) => {
      try {
        const ok = await this.deploy(opts, mode, workToken);
        if (!ok && isTransportBusy(this.transport.state.phase)) this.transport.dispatch({ type: 'deployAborted' });
        return ok;
      } catch (err) {
        this.transport.dispatch({ type: 'deployAborted' });
        throw err;
      }
    });
  }

  private async deploy(
    opts: { build: boolean; debug: boolean },
    mode: TransportMode,
    token: vscode.CancellationToken,
  ): Promise<boolean> {
    if (opts.build) {
      this.transport.dispatch({ type: 'buildStarted', mode });
      let failureReason: string | undefined;
      const ok = await buildForEmulator(
        this.manager, this.extensionPath, this.diagnostics, this.buildChannel, this.workspaceState, token,
        { genericFailureToast: false, onFailureReason: (reason) => { failureReason = reason; } },
      );
      if (!ok) {
        if (!token.isCancellationRequested) {
          this.transport.dispatch({
            type: 'deployFailed',
            problems: failureReason ? undefined : countErrors(this.diagnostics),
            ...(failureReason ? { reason: failureReason } : {}),
          });
        }
        return false;
      }
    }
    // FR-PRE-4: without a build of its own in this window, use the project's
    // existing one, or say what to do — never "Build before deploying".
    if (!opts.build) {
      const root = resolveActiveFolder(this.workspaceState)?.uri.fsPath ?? '';
      if (!await this.manager.adoptExistingBuild(root)) {
        this.emulatorChannel.appendLine(NOTHING_BUILT_MESSAGE);
        void vscode.window.showErrorMessage(`ds-ide: ${NOTHING_BUILT_MESSAGE}`);
        return false;
      }
    }
    this.transport.dispatch({ type: 'deployStarted', mode });
    const cfg = await this.loadControllerConfig();
    this.potStore.setDefaults(cfg.pots);
    this.buttonStore.setDefaults(cfg.buttons);

    // Toggle instances aren't declared in controllers.yaml (no ToggleDef —
    // see docs/milestones/v14/Milestone_M44.md's scope note); their pins are
    // recovered from the code annotation convention instead (FR-DEV-7).
    const folder = resolveActiveFolder(this.workspaceState)?.uri.fsPath ?? '';
    const controlsConfig = await this.computeControlsConfig(folder, cfg);
    const togglePins = (controlsConfig?.controls ?? []).filter(c => c.kind === 'toggle').map(c => c.pin);
    this.toggleStore.setDefaults(togglePins);

    if (opts.debug) {
      await debugDeploy(
        this.manager,
        () => cfg.pots,
        () => {
          this.scopePanel.show(this.session.sineState, this.session.audioSourceState, this.session.generatorState);
          void this.showOledIfEnabled();
          void this.showMidiIfEnabled();
        },
        () => this.potStore.getSnapshot(),
        () => this.sendPostDeployState(),
        this.emulatorChannel,
        this.workspaceState,
        token,
      );
      // debugDeploy reports its own failures; whether an emulator is up is
      // the only outcome it leaves behind.
      if (this.manager.childPid === undefined) return false;
      this.transport.dispatch({ type: 'deploySucceeded' });
      return true;
    }

    // FR-PRE-4: the viewers open only once the emulator is up, so a failed
    // deploy leaves nothing behind. The Controls Editor caches what is posted
    // to it, so the data is loaded up front and replayed when it appears.
    this.controlsProvider.loadEditor(cfg);
    if (controlsConfig) this.controlsProvider.postControlsConfig(controlsConfig);
    const deployed = await deployToEmulator(this.manager, this.emulatorChannel, token);
    if (!deployed) return false;
    this.scopePanel.show(this.session.sineState, this.session.audioSourceState, this.session.generatorState);
    void this.showOledIfEnabled();
    void this.showMidiIfEnabled();
    void vscode.commands.executeCommand('workbench.view.extension.ds-ide-controls');
    this.sendPostDeployState();
    this.transport.dispatch({ type: 'deploySucceeded' });
    return true;
  }
}

// FR-EXT-9: status/message routing extracted from activate() — this is the
// only place manager 'message'/'disconnect'/'error' events are translated
// into webview updates and notifications. The status bar renders from the
// transport state instead (FR-TRN-5).
function wireManagerEvents(
  manager: EmulatorManager,
  controlsProvider: ControlsViewProvider,
  emulatorChannel: vscode.OutputChannel,
): void {
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
      controlsProvider?.postStatus(msg);
    }
    if (msg['type'] === 'led') {
      controlsProvider?.postLed(msg);
    }
    if (msg['type'] === 'rgbLed') {
      controlsProvider?.postRgbLed(msg);
    }
    // FR-CE-2: dual-subscribed alongside OledPanel's own 'message' listener
    // (its constructor) — the docked strip needs live frames whether or not
    // the standalone panel is open.
    if (msg['type'] === 'oledFrame') {
      const data = getString(msg, 'data');
      if (data !== undefined) controlsProvider?.postOledFrame(data);
    }
  });

  // FR-TRN-6: the transport state turns this into its one crash notification
  // (Show Output / Debug); here it is only logged.
  manager.on('disconnect', () => {
    emulatorChannel.appendLine('ds-ide: emulator disconnected unexpectedly.');
  });

  // FR-EXT-6: Node's EventEmitter throws in-process on an unhandled 'error'
  // emission, which would otherwise crash the entire Extension Host on any
  // raw IPC socket error.
  manager.on('error', (err: Error) => {
    emulatorChannel.appendLine(`ds-ide: emulator error: ${err.message}`);
    void vscode.window.showErrorMessage(`ds-ide: emulator error: ${err.message}`);
  });

  // FR-EXT-25: dropped/malformed IPC traffic was previously visible only via
  // console.warn in the extension host's dev console — surfaced here instead
  // so it's visible in the same channel as every other emulator diagnostic.
  manager.on('warning', (warning: IpcWarning) => {
    emulatorChannel.appendLine(`ds-ide: ${warning.message} (${warning.count})`);
  });
}

interface ControlsProviderDeps {
  workspaceState: vscode.Memento;
  isControllerConfigUnreadable: () => boolean;
  refreshControlsView: (folder: string, cfg: ControllerConfig) => Promise<void>;
  potStore: PotStore;
  buttonStore: ButtonStore;
  toggleStore: ToggleStore;
  manager: EmulatorManager;
  showOledPanel: () => Promise<void>;
}

// FR-EXT-9: view-provider construction extracted from activate() — builds
// the Controls Editor's ControlsViewProvider and wires its callbacks to the
// stores/manager/refresh logic passed in via deps.
function createControlsProvider(context: vscode.ExtensionContext, deps: ControlsProviderDeps): ControlsViewProvider {
  const {
    workspaceState, isControllerConfigUnreadable, refreshControlsView,
    potStore, buttonStore, toggleStore, manager, showOledPanel,
  } = deps;

  const controlsProvider = new ControlsViewProvider(
    context.extensionUri,
    (cfg) => {
      if (isControllerConfigUnreadable()) {
        void vscode.window.showWarningMessage(
          'ds-ide: controllers.yaml could not be read earlier — refusing to overwrite it until the underlying issue is fixed and the file is reloaded.',
        );
        return;
      }
      const folder = resolveActiveFolder(workspaceState);
      if (!folder) return;
      const yamlPath = path.join(folder.uri.fsPath, 'controllers.yaml');
      void fs.promises.writeFile(yamlPath, serializeControllerConfig(cfg), 'utf8')
        .then(async () => {
          // Keep the provider's cache in sync with what's now on disk — otherwise the next
          // onDidChangeVisibility flush re-sends the stale pre-save snapshot and clobbers the
          // positions just saved (FR-CE-1).
          await refreshControlsView(folder.uri.fsPath, cfg);
        })
        .catch((err: unknown) => {
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
    (gpioPin, position) => {
      toggleStore?.set(gpioPin, position);
      manager?.sendToggle(gpioPin, position);
    },
    (gpioPin, position) => {
      manager?.sendEncoder(gpioPin, position);
    },
    () => {
      const folder = resolveActiveFolder(workspaceState);
      if (!folder) { controlsProvider.postSdContents([]); return; }
      void readSdCardEntries(folder.uri.fsPath).then(entries => controlsProvider.postSdContents(entries));
    },
    (name) => {
      const folder = resolveActiveFolder(workspaceState);
      if (!folder) { controlsProvider.postSdPreview(name, null); return; }
      void readSdCardPreview(folder.uri.fsPath, name).then(content => controlsProvider.postSdPreview(name, content));
    },
    // FR-CE-2: "show in separate view" reuses the same standalone OledPanel
    // the Wiring Editor's View button opens (showOledPanel) — the docked
    // strip never owns its own panel lifecycle.
    () => { void showOledPanel(); },
  );

  return controlsProvider;
}

interface WiringProviderDeps {
  workspaceState: vscode.Memento;
  loadControllerConfig: () => Promise<ControllerConfig>;
  refreshControlsView: (folder: string, cfg: ControllerConfig) => Promise<void>;
  showOledPanel: () => Promise<void>;
  midiPanel: MidiPanel;
}

// FR-EXT-9: view-provider construction extracted from activate() — builds
// the Wiring Editor's WiringViewProvider and its six message handlers
// (wirePin/unwirePin/setPeripheralEnabled/viewPeripheral/revealInCode/moveControl).
function createWiringProvider(context: vscode.ExtensionContext, deps: WiringProviderDeps): WiringViewProvider {
  const { workspaceState, loadControllerConfig, refreshControlsView, showOledPanel, midiPanel } = deps;

  // FR-UDM-7/8/9: shared by wirePin and moveControl. `removeIds` are
  // cleared from the source first — a conflict drop's replaced occupants
  // and, for a move, the control itself — then allocation, the conflict
  // check and the add all run against that text, and the whole change is
  // written as one edit (a single undo step). `resolve` names the control
  // to place from the pre-edit text, or returns null after saying why not.
  const placeControl = async (removeIds: string[], resolve: (text: string) => WiredPin | null): Promise<void> => {
    const folder = resolveActiveFolder(workspaceState)?.uri.fsPath ?? '';
    const effectPath = await findEffectSource(folder);
    if (!effectPath) {
      void vscode.window.showErrorMessage('ds-ide: no effect source file found — set ds-ide.effectSource');
      return;
    }
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(effectPath));
    const oldText = doc.getText();
    const wp = resolve(oldText);
    if (!wp) return;
    const baseText = removeIds.length ? removeOccupantsFromSource(oldText, removeIds) : oldText;

    // FR-DEV-8: a 'pins'-attachment device (rgbled) auto-claims its
    // remaining pins from the nearest free ones after the clicked pin,
    // rather than requiring a redesigned multi-pin picker in the popup.
    // FR-UDM-6: the footprint comes from the same computeDropTargets() the
    // drag preview used, so the pins written are the pins the user saw.
    const pinCount = REGISTRY[wp.deviceType]!.pinCount;
    let pins: number[] | undefined;
    if (pinCount !== undefined) {
      const allocated = computeDropTargets(wp.deviceType, PIN_DEFS, occupancyFromSource(baseText))
        .find(t => t.kind === 'pin' && t.pins[0] === wp.pinNumber)?.pins;
      if (!allocated) {
        void vscode.window.showErrorMessage(
          `ds-ide: not enough free pins after D${wp.pinNumber} to wire a ${REGISTRY[wp.deviceType]!.label} (needs ${pinCount}).`,
        );
        return;
      }
      pins = allocated;
    }

    // FR-DEV-13: wiring a control is also a pin-claiming action, so it must
    // be refused on the same terms enabling a peripheral already is — a
    // gap surfaced by manual testing (M46): wiring a button onto an
    // enabled bus peripheral's pin (e.g. SD Card's D1-D6, OLED's D7-D10)
    // previously succeeded silently. No peripheral is being toggled here,
    // so nothing is excluded from the occupant set.
    const candidateAttachment: Attachment = pins ? { kind: 'pins', pins } : { kind: 'pin', pin: wp.pinNumber };
    const wireRejection = checkConflict(candidateAttachment, buildOccupants(baseText), PIN_DEFS, candidateBusesFor);
    if (wireRejection) {
      void vscode.window.showErrorMessage(
        formatRejection(`${wp.id} (${REGISTRY[wp.deviceType]!.label})`, wireRejection),
      );
      return;
    }

    const afterDecl = insertIntoSource(baseText, wp.id, wp.deviceType, wp.pinNumber, pins);
    const { controls: controlsAfterDecl } = parseControlsConvention(afterDecl);
    const allPots = controlsAfterDecl.filter(c => c.kind === 'pot');
    const newText = insertInitIntoSource(afterDecl, wp.id, wp.deviceType, wp.pinNumber, allPots, pins);
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
    const wiredPinList: WiredPin[] = expandToWiredPins(controls);
    wiringProvider?.postWiredPins(wiredPinList);
    if (removeIds.length) wiringProvider?.postPeripherals(computePeripheralDisplayStates(newText));
    const cfg = await loadControllerConfig();
    await refreshControlsView(folder, cfg);
  };

  const wiringProvider = new WiringViewProvider(
    context.extensionUri,
    (wp: WiredPin, replace?: string[]) => placeControl(replace ?? [], () => wp),
    async (pinNumber: number, id: string) => {
      const folder = resolveActiveFolder(workspaceState)?.uri.fsPath ?? '';
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
      const wiredPinList: WiredPin[] = expandToWiredPins(controls);
      wiringProvider?.postWiredPins(wiredPinList);
      const cfg = await loadControllerConfig();
      await refreshControlsView(folder, cfg);
    },
    async (peripheralId: string, enabled: boolean, requestedBus?: string, replace?: string[]) => {
      const folder = resolveActiveFolder(workspaceState)?.uri.fsPath ?? '';
      const effectPath = await findEffectSource(folder);
      if (!effectPath) {
        void vscode.window.showErrorMessage('ds-ide: no effect source file found — set ds-ide.effectSource');
        return;
      }
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(effectPath));
      const oldText = doc.getText();
      // FR-UDM-8: same one-edit replace as placeControl above.
      let baseText = replace?.length ? removeOccupantsFromSource(oldText, replace) : oldText;
      // FR-UDM-9: dropping a placed peripheral on another lane moves it —
      // its old declaration is removed so the new bus's variant is written.
      if (
        enabled && requestedBus !== undefined && isPeripheralEnabled(baseText, peripheralId) &&
        currentBusOf(baseText, peripheralId) !== requestedBus
      ) {
        baseText = peripheralEditText(baseText, peripheralId, false);
      }

      // FR-DEV-13: a colliding enable is refused before any mutation, never
      // applied-and-flagged. Disabling a peripheral can never create a
      // conflict, so only the enable path is checked. The bus checked is
      // whichever `currentBusOf` resolves to — the peripheral's current
      // declaration if already enabled, or its default first choice
      // otherwise (FR-DEV-14).
      // FR-UDM-7: a drop names its lane's bus; the checkbox path never did.
      const bus = requestedBus ?? currentBusOf(oldText, peripheralId);
      if (enabled) {
        if (bus) {
          const occupants = buildOccupants(baseText, peripheralId);
          const rejection = checkConflict(
            { kind: 'bus', bus },
            occupants,
            PIN_DEFS,
            candidateBusesFor,
          );
          if (rejection) {
            void vscode.window.showErrorMessage(formatRejection(REGISTRY[peripheralId]!.label, rejection));
            return;
          }
        }
      }

      const newText = peripheralEditText(baseText, peripheralId, enabled, bus ?? undefined);
      const { edit, needsAppendConfirmation } = makeBlockEdit(doc, vscode.Uri.file(effectPath), oldText, newText);
      if (needsAppendConfirmation && !(await confirmAppendMarkerBlocks())) {
        return;
      }
      const applied = await vscode.workspace.applyEdit(edit);
      if (!applied) {
        void vscode.window.showErrorMessage('ds-ide: peripheral edit could not be applied — source file was not changed.');
        return;
      }
      await doc.save();
      wiringProvider?.postPeripherals(computePeripheralDisplayStates(newText));
      if (replace?.length) {
        wiringProvider?.postWiredPins(expandToWiredPins(parseControlsConvention(newText).controls));
        await refreshControlsView(folder, await loadControllerConfig());
      }
    },
    (peripheralId: string) => {
      if (peripheralId === 'oled') {
        void showOledPanel();
      } else if (peripheralId === 'midiTrs' || peripheralId === 'midiUsb') {
        midiPanel.show();
      }
    },
    async (id: string) => {
      const folder = resolveActiveFolder(workspaceState)?.uri.fsPath ?? '';
      const effectPath = await findEffectSource(folder);
      if (!effectPath) {
        void vscode.window.showErrorMessage('ds-ide: no effect source file found — set ds-ide.effectSource');
        return;
      }
      await revealDeviceInCode(effectPath, id);
    },
    (id: string, pinNumber: number, replace?: string[]) => placeControl([id, ...(replace ?? [])], text => {
      const control = parseControlsConvention(text).controls.find(c => c.id === id);
      if (!control) {
        void vscode.window.showErrorMessage(`ds-ide: can't move ${id} — it is no longer in the effect source.`);
        return null;
      }
      return { pinNumber, deviceType: control.kind as DeviceType, id };
    }),
  );

  return wiringProvider;
}

interface CommandDeps {
  manager: EmulatorManager;
  diagnostics: vscode.DiagnosticCollection;
  buildChannel: vscode.OutputChannel;
  hardwareChannel: vscode.OutputChannel;
  flashChannel: vscode.OutputChannel;
  workspaceState: vscode.Memento;
  extensionPath: string;
  deployCoordinator: DeployCoordinator;
  scopePanel: ScopePanel;
  midiPanel: MidiPanel;
  showOledPanel: () => Promise<void>;
  sessionState: SessionState;
  controlsProvider: ControlsViewProvider;
  initViewsFromProject: () => Promise<void>;
  emulatorChannel: vscode.OutputChannel;
  transport: TransportController;
  daisyView: DaisyViewProvider;
  stopEmulator: () => void;
  refreshBoard: () => Promise<BoardInfo | null>;
}

// FR-EXT-16: shared wrapper so a hung build/deploy/flash child process can
// be aborted from the progress notification instead of reloading the
// extension host window — every long-running command below routes through
// this instead of calling vscode.window.withProgress ad hoc.
// FR-TRN-4: the same work also shows progress on the Daisy view.
async function withCancellableProgress<T>(
  title: string,
  task: (token: vscode.CancellationToken) => Promise<T>,
): Promise<T> {
  return withViewProgress(() => vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title, cancellable: true },
    (_progress, token) => task(token),
  ));
}

// FR-EXT-9: command registration extracted from activate() — every
// vscode.commands.registerCommand('ds-ide.*', ...) call lives here.
function registerCommands(deps: CommandDeps): vscode.Disposable[] {
  const {
    manager, diagnostics, buildChannel, hardwareChannel, flashChannel,
    workspaceState, extensionPath, deployCoordinator, scopePanel, midiPanel, showOledPanel, sessionState, controlsProvider, initViewsFromProject,
    emulatorChannel, transport, stopEmulator, refreshBoard,
  } = deps;

  return [
    vscode.commands.registerCommand('ds-ide.build', () =>
      withCancellableProgress('ds-ide: building…', (token) =>
        buildForEmulator(manager, extensionPath, diagnostics, buildChannel, workspaceState, token),
      ),
    ),
    vscode.commands.registerCommand('ds-ide.buildAndDeploy', () =>
      withCancellableProgress('ds-ide: building and deploying…', (token) =>
        deployCoordinator.performDeploy({ build: true, debug: false }, token),
      ),
    ),
    vscode.commands.registerCommand('ds-ide.deploy', () =>
      withCancellableProgress('ds-ide: deploying…', (token) =>
        deployCoordinator.performDeploy({ build: false, debug: false }, token),
      ),
    ),
    vscode.commands.registerCommand('ds-ide.start', () => startAudio(manager)),
    vscode.commands.registerCommand('ds-ide.stop', () => {
      stopAudio(manager);
      scopePanel?.notifyStopped();
      controlsProvider?.postStatus({ type: 'status', running: false });
    }),
    vscode.commands.registerCommand('ds-ide.buildHardware', () => {
      const folder = resolveActiveFolder(workspaceState);
      if (!folder) {
        void vscode.window.showErrorMessage('ds-ide: no workspace folder open');
        return;
      }
      return withCancellableProgress('ds-ide: building for hardware…', (token) =>
        buildForHardware(folder.uri.fsPath, diagnostics, hardwareChannel, {}, token),
      );
    }),
    vscode.commands.registerCommand('ds-ide.flash', () => {
      const folder = resolveActiveFolder(workspaceState);
      if (!folder) {
        void vscode.window.showErrorMessage('ds-ide: no workspace folder open');
        return;
      }
      return withCancellableProgress('ds-ide: flashing…', (token) =>
        flashToHardware(folder.uri.fsPath, flashChannel, {}, token),
      );
    }),
    vscode.commands.registerCommand('ds-ide.debug', () =>
      withCancellableProgress('ds-ide: building and deploying…', (token) =>
        deployCoordinator.performDeploy({ build: false, debug: true }, token),
      ),
    ),
    // FR-TRN-3: the editor-title ▶ and its dropdown. Run / Debug go through
    // the one ds-ide launch configuration, so they get the same live session
    // (toolbar, Restart, Stop) as Ctrl+F5 / F5.
    vscode.commands.registerCommand('ds-ide.runEffect', () =>
      vscode.debug.startDebugging(resolveActiveFolder(workspaceState), { ...DS_IDE_LAUNCH_CONFIG }, { noDebug: true }),
    ),
    vscode.commands.registerCommand('ds-ide.debugEffect', () =>
      vscode.debug.startDebugging(resolveActiveFolder(workspaceState), { ...DS_IDE_LAUNCH_CONFIG }),
    ),
    // FR-TRN-7: detect the board first — with none in DFU mode, no hardware
    // build is started — then confirm, then reuse the buildHardware / flash
    // paths (flash's own BOOT/RESET prompt is already covered by detection).
    vscode.commands.registerCommand('ds-ide.buildAndFlash', async (): Promise<void> => {
      const folder = resolveActiveFolder(workspaceState);
      if (!folder) {
        void vscode.window.showErrorMessage('ds-ide: no workspace folder open');
        return;
      }
      let board = await refreshBoard();
      while (!board) {
        const retry = await vscode.window.showWarningMessage(
          'ds-ide: no Daisy Seed found in DFU mode. Hold BOOT, press and release RESET, then release BOOT — and retry.',
          'Retry',
        );
        if (retry !== 'Retry') return;
        board = await refreshBoard();
      }
      const confirm = await vscode.window.showInformationMessage(
        `Build "${folder.name}" for hardware and flash it to the ${board.name} (DFU ${board.usbId})?`,
        { modal: true },
        'Build & Flash',
      );
      if (confirm !== 'Build & Flash') return;
      const built = await withCancellableProgress('ds-ide: building for hardware…', (token) =>
        buildForHardware(folder.uri.fsPath, diagnostics, hardwareChannel, {}, token),
      );
      if (!built) return;
      await withCancellableProgress('ds-ide: flashing…', (token) =>
        flashToHardware(folder.uri.fsPath, flashChannel, { confirmBootloader: false }, token),
      );
    }),
    // FR-TRN-4: Daisy view title / row actions.
    vscode.commands.registerCommand('ds-ide.stopEffect', async () => {
      if (transport.session) {
        await vscode.debug.stopDebugging(transport.session);
        return;
      }
      // Deployed through a granular command — no session to end.
      stopEmulator();
    }),
    vscode.commands.registerCommand('ds-ide.cancelTransport', () => transport.cancelWork()),
    vscode.commands.registerCommand('ds-ide.restartEffect', () =>
      transport.session
        ? vscode.commands.executeCommand('workbench.action.debug.restart')
        : vscode.commands.executeCommand('ds-ide.buildAndDeploy'),
    ),
    vscode.commands.registerCommand('ds-ide.refreshBoard', () => refreshBoard()),
    vscode.commands.registerCommand('ds-ide.showEmulatorOutput', () => emulatorChannel.show()),
    // FR-TRN-5: the state item's default click action.
    vscode.commands.registerCommand('ds-ide.revealDaisyView', () =>
      vscode.commands.executeCommand(`${DAISY_VIEW_ID}.focus`)),
    // FR-RCH-1: reopen any surface without a build or deploy.
    vscode.commands.registerCommand('ds-ide.showScope', () =>
      scopePanel.show(sessionState.sineState, sessionState.audioSourceState, sessionState.generatorState)),
    vscode.commands.registerCommand('ds-ide.showOled', () => showOledPanel()),
    vscode.commands.registerCommand('ds-ide.showMidi', () => midiPanel.show()),
    vscode.commands.registerCommand('ds-ide.focusControls', () =>
      vscode.commands.executeCommand('ds-ide.controlsEditor.focus')),
    vscode.commands.registerCommand('ds-ide.focusWiring', () =>
      vscode.commands.executeCommand('ds-ide.wiringEditor.focus')),
    vscode.commands.registerCommand('ds-ide.createNewEffectProject', () => createEffectProject(extensionPath)),
    // FR-AIG-4: copy the AI agent guide into the project and point agent files at it.
    vscode.commands.registerCommand('ds-ide.addAiGuide', () => addAiGuideToProject(extensionPath, workspaceState)),
    vscode.commands.registerCommand('ds-ide.selectActiveFolder', async () => {
      const chosen = await promptSelectActiveFolder(workspaceState);
      if (chosen) void initViewsFromProject();
    }),
  ];
}

interface SaveListenerDeps {
  workspaceState: vscode.Memento;
  loadControllerConfig: () => Promise<ControllerConfig>;
  refreshControlsView: (folder: string, cfg: ControllerConfig) => Promise<void>;
  wiringProvider: WiringViewProvider;
  controlsProvider: ControlsViewProvider;
}

// FR-EXT-9: save-listener logic extracted from activate() — the
// onDidSaveTextDocument handler that keeps the Controls/Wiring editors in
// sync with controllers.yaml and the effect source file.
function createSaveListener(deps: SaveListenerDeps): vscode.Disposable {
  const { workspaceState, loadControllerConfig, refreshControlsView, wiringProvider, controlsProvider } = deps;

  return vscode.workspace.onDidSaveTextDocument(async (doc) => {
    const activeFolder = resolveActiveFolder(workspaceState);
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
    await refreshControlsView(folder, cfg);

    if (mightBeSource) {
      const effectPath = await findEffectSource(folder);
      if (effectPath && saved === effectPath) {
        let pins: WiredPin[] = [];
        let peripherals: PeripheralDisplayState[] = computePeripheralDisplayStates('');
        try {
          const text = await fs.promises.readFile(effectPath, 'utf8');
          const { controls } = parseControlsConvention(text);
          // Reuses the same expansion as the wirePin/unwirePin handlers
          // above (FR-DEV-8/9) — this listener re-fires on the doc.save()
          // those handlers themselves trigger, and previously used a
          // single-pin mapping that clobbered a multi-pin instance's
          // display down to one highlighted pin right after wiring it.
          pins = expandToWiredPins(controls);
          peripherals = computePeripheralDisplayStates(text);
        } catch { /* unreadable */ }
        wiringProvider.postWiredPins(pins);
        wiringProvider.postPeripherals(peripherals);
        controlsProvider.postSdCardEnabled(peripherals.some(p => p.id === 'sdcard' && p.enabled));
        const oledPeripheral = peripherals.find(p => p.id === 'oled');
        controlsProvider.postOledEnabled(!!oledPeripheral?.enabled, oledPeripheral?.bus ?? null);
      }
    }
  });
}

export function activate(context: vscode.ExtensionContext): void {
  const potStore    = new PotStore(context.workspaceState);
  const buttonStore = new ButtonStore(context.workspaceState);
  const toggleStore = new ToggleStore(context.workspaceState);
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
      return { pots: [], buttons: [], leds: [], encoders: [], toggles: [], rgbleds: [], errors: [] };
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
        return { pots: [], buttons: [], leds: [], encoders: [], toggles: [], rgbleds: [], errors: [] };
      }
      controllerConfigUnreadable = true;
      void vscode.window.showWarningMessage(
        `ds-ide: could not read controllers.yaml (${(err as NodeJS.ErrnoException)?.code ?? String(err)}) — treating as unreadable, not empty; edits will not be saved until this is resolved.`,
      );
      return { pots: [], buttons: [], leds: [], encoders: [], toggles: [], rgbleds: [], errors: [] };
    }
  }

  // FR-WIN-TCH-4: the managed Windows toolchain (download on first use). Offered
  // by the emulator build and the debugger when a tool is missing on Windows.
  const toolchain = new ManagedToolchainService(
    { storageDir: path.join(context.globalStorageUri.fsPath, 'toolchain'), extensionPath: context.extensionPath },
    vscodeToolchainUi(),
  );

  const manager = new EmulatorManager({ offerToolchain: () => toolchain.offer() });

  // Remove this workspace's stale UNIX socket files (FR-EXT-2; macOS only —
  // FR-WIN-IPC-1).
  {
    const activeFolder = resolveActiveFolder(context.workspaceState)?.uri.fsPath;
    if (activeFolder) {
      void sweepStaleSockets(path.join(activeFolder, '.ds-ide', 'build'), process.platform);
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

  // FR-CE-1 follow-up: buildControlsConfig() used to be independently
  // called and pushed from six separate triggers (activation, layout save,
  // wirePin, unwirePin, any yaml/cpp save, deploy) — each doing its own
  // "read the effect source, parse, rebuild placements" round trip with no
  // shared sequencing. Beyond the duplicated work, this is how a
  // slower-but-earlier-started refresh could resolve *after* a
  // faster-but-later one and silently revert it (observed: a control
  // disappearing from the canvas right after a successful save).
  // computeControlsConfig() is now the single place that performs this
  // read; requestId discards a response that's no longer the most recently
  // *started* one before it's ever handed back to a caller.
  let controlsConfigRequestId = 0;
  async function computeControlsConfig(folder: string, cfg: ControllerConfig): Promise<ControlsConfig | undefined> {
    const requestId = ++controlsConfigRequestId;
    const result = await buildControlsConfig(folder, cfg);
    if (requestId !== controlsConfigRequestId) return undefined;
    return result;
  }

  // Refreshes both halves of what the Controls Editor shows — the layout
  // (loadEditor) and the convention-derived control set (postControlsConfig)
  // — as one unit. Used by every trigger that always wants both pushed
  // unconditionally; DeployCoordinator is the one exception (it needs the
  // computed value even when not pushing, in debug mode — see
  // performDeploy), so it calls computeControlsConfig directly instead.
  async function refreshControlsView(folder: string, cfg: ControllerConfig): Promise<void> {
    controlsProvider.loadEditor(cfg);
    const result = await computeControlsConfig(folder, cfg);
    if (result) controlsProvider.postControlsConfig(result);
  }

  const oledPanel = new OledPanel(context.extensionUri, manager);

  // Shared by the Wiring Editor's "View" button (hasLiveView flow) and the
  // Controls Editor's docked-strip pop-out (FR-CE-2) — both just want
  // today's standalone OledPanel opened against the peripheral's current bus.
  async function showOledPanel(): Promise<void> {
    const folder = resolveActiveFolder(context.workspaceState)?.uri.fsPath ?? '';
    const effectPath = await findEffectSource(folder);
    if (!effectPath) return;
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(effectPath));
    const state = computePeripheralDisplayStates(doc.getText()).find(p => p.id === 'oled');
    oledPanel.show(state?.bus ?? null);
  }

  const midiPanel = new MidiPanel(context.extensionUri, manager);
  const hostMidiBridge = new HostMidiBridge(manager);
  hostMidiBridge.start();

  const controlsProvider = createControlsProvider(context, {
    workspaceState: context.workspaceState,
    isControllerConfigUnreadable: () => controllerConfigUnreadable,
    refreshControlsView,
    potStore, buttonStore, toggleStore, manager,
    showOledPanel,
  });

  const wiringProvider = createWiringProvider(context, {
    workspaceState: context.workspaceState,
    loadControllerConfig,
    refreshControlsView,
    showOledPanel,
    midiPanel,
  });

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
      // FR-GEN-4: Sine goes back to the sine message, other generators select themselves,
      // and the External inputs hand the input stage back.
      if (source.input === 'sine') manager?.sendSine(session.sineState.freq, session.sineState.amplitude);
      else if (isGeneratorId(source.input)) manager?.sendGenerator(source.input, session.generatorParams(source.input));
      else manager?.sendGenerator('none');
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
    (kind, params) => session.setGenerator(kind, params),
  );

  wireManagerEvents(manager, controlsProvider, emulatorChannel);

  // FR-TRN-4: one transport state for the Daisy view (and, below, every
  // other transport surface).
  const transport = new TransportController();
  const daisyView = new DaisyViewProvider(transport, () =>
    formatAudioDetail(session.audioSourceState.sampleRate, session.audioSourceState.bufferSize));
  const daisyTreeView = vscode.window.createTreeView(DAISY_VIEW_ID, { treeDataProvider: daisyView });
  // FR-TRN-7: board detection is on demand only — here, on Refresh, and
  // before Build & Flash. No background polling.
  async function refreshBoard(): Promise<BoardInfo | null> {
    // FR-WIN-TCH-3: on Windows, a board that is present but cannot be opened
    // (no WinUSB driver) is explained rather than reading as "no board".
    const board = await detectBoard({
      onDiagnostic: (message) => { void vscode.window.showWarningMessage(`ds-ide: ${message}`); },
    });
    transport.dispatch(board ? { type: 'boardDetected', board } : { type: 'boardNotDetected' });
    return board;
  }
  const boardOnVisible = daisyTreeView.onDidChangeVisibility((e) => {
    if (e.visible) void refreshBoard();
  });
  const statusItems = new TransportStatusItems(transport, FIDELITY_CAVEAT);
  const transportNotifications = wireTransportNotifications(transport);

  // Stop for a run session and for the view's Stop without a session: ends
  // the emulator process, and resets the panels that show live audio.
  function stopEmulator(opts: { immediate?: boolean } = {}): void {
    manager.stop(opts);
    scopePanel.notifyStopped();
    controlsProvider.postStatus({ type: 'status', running: false });
  }

  const debugAdapterFactory = new DaisyDebugAdapterFactory(undefined, undefined, () => toolchain.offer());
  const debugTrackerFactory = new DaisyDebugAdapterTrackerFactory((mode) => manager?.sendAudioMode(mode));

  const deployCoordinator = new DeployCoordinator({
    manager,
    stores: { pot: potStore, button: buttonStore, toggle: toggleStore },
    session,
    panels: { scope: scopePanel, oled: oledPanel, midi: midiPanel },
    controlsProvider, diagnostics,
    channels: { build: buildChannel, emulator: emulatorChannel },
    extensionPath: context.extensionPath,
    loadControllerConfig,
    workspaceState: context.workspaceState,
    computeControlsConfig,
    transport,
  });

  const runConfigProvider = new DaisyRunConfigurationProvider(
    (token, mode) => deployCoordinator.performDeploy({ build: true, debug: false, mode }, token),
    context.workspaceState,
  );

  // FR-TRN-3: the editor-title ▶ is shown only on the project's effect
  // source, tracked here as the ds-ide.isEffectSource context key.
  let effectSourcePath: string | undefined;
  function updateEffectSourceContext(editor: vscode.TextEditor | undefined): void {
    const active = editor?.document.uri.fsPath;
    const isEffectSource = effectSourcePath !== undefined && active !== undefined
      && path.resolve(active) === path.resolve(effectSourcePath);
    void vscode.commands.executeCommand('setContext', 'ds-ide.isEffectSource', isEffectSource);
  }

  async function initViewsFromProject(): Promise<void> {
    const activeFolder = resolveActiveFolder(context.workspaceState);
    if (!activeFolder) {
      effectSourcePath = undefined;
      void vscode.commands.executeCommand('setContext', 'ds-ide.isDaisyProject', false);
      daisyView.setDaisyProject(false);
      statusItems.setVisible(false);
      updateEffectSourceContext(vscode.window.activeTextEditor);
      return;
    }
    const folder = activeFolder.uri.fsPath;
    const cfg = await loadControllerConfig();
    await refreshControlsView(folder, cfg);
    const effectPath = await findEffectSource(folder);
    // Scopes the ds-ide.* keybindings (package.json) so they don't fire in
    // unrelated workspaces (FR-QA-EXT-6).
    void vscode.commands.executeCommand('setContext', 'ds-ide.isDaisyProject', effectPath !== undefined);
    daisyView.setDaisyProject(effectPath !== undefined);
    statusItems.setVisible(effectPath !== undefined);
    effectSourcePath = effectPath;
    updateEffectSourceContext(vscode.window.activeTextEditor);
    let wiredPins: WiredPin[] = [];
    let peripherals: PeripheralDisplayState[] = computePeripheralDisplayStates('');
    if (effectPath) {
      try {
        const text = await fs.promises.readFile(effectPath, 'utf8');
        const { controls } = parseControlsConvention(text);
        wiredPins = expandToWiredPins(controls);
        peripherals = computePeripheralDisplayStates(text);
      } catch { /* file unreadable — leave wiredPins/peripherals at their defaults */ }
    }
    wiringProvider.postWiredPins(wiredPins);
    wiringProvider.postPeripherals(peripherals);
    controlsProvider.postSdCardEnabled(peripherals.some(p => p.id === 'sdcard' && p.enabled));
    const oledPeripheral = peripherals.find(p => p.id === 'oled');
    controlsProvider.postOledEnabled(!!oledPeripheral?.enabled, oledPeripheral?.bus ?? null);
  }

  void initViewsFromProject();

  const commandDisposables = registerCommands({
    manager, diagnostics, buildChannel, hardwareChannel, flashChannel,
    workspaceState: context.workspaceState, extensionPath: context.extensionPath,
    deployCoordinator, scopePanel, midiPanel, showOledPanel, sessionState: session, controlsProvider, initViewsFromProject,
    emulatorChannel, transport, daisyView, stopEmulator, refreshBoard,
  });

  const saveListener = createSaveListener({
    workspaceState: context.workspaceState, loadControllerConfig, refreshControlsView,
    wiringProvider, controlsProvider,
  });

  // FR-AIG-6: changes made outside the VS Code editor (a coding agent, git, a
  // terminal) do not fire onDidSaveTextDocument, so watch the files on disk.
  const projectFileWatcher = createProjectFileWatcher({
    getActiveFolder: () => resolveActiveFolder(context.workspaceState)?.uri.fsPath,
    getEffectSource: () => effectSourcePath,
    refresh: initViewsFromProject,
  });

  // Registered after the listeners above so theirs run first.
  const transportEventDisposables = wireTransportEvents(transport, {
    emulator: manager,
    isProjectSource: (uri) => {
      const active = resolveActiveFolder(context.workspaceState);
      return active !== undefined && isBuildSource(uri.fsPath)
        && vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath === active.uri.fsPath;
    },
  });

  context.subscriptions.push(
    vscode.commands.registerCommand('ds-ide.installWindowsToolchain', () => toolchain.installFromCommand()),
    vscode.commands.registerCommand('ds-ide.installToolchainFromArchive', () => toolchain.installFromLocalArchive()),
    transport,
    daisyView,
    daisyTreeView,
    boardOnVisible,
    ...transportEventDisposables,
    vscode.window.onDidChangeActiveTextEditor(updateEffectSourceContext),
    diagnostics,
    buildChannel,
    emulatorChannel,
    hardwareChannel,
    flashChannel,
    statusItems,
    transportNotifications,
    vscode.window.registerWebviewViewProvider('ds-ide.controlsEditor', controlsProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.registerWebviewViewProvider('ds-ide.wiringEditor', wiringProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.debug.registerDebugAdapterDescriptorFactory(DAISY_DEBUG_TYPE, debugAdapterFactory),
    vscode.debug.registerDebugAdapterTrackerFactory(DAISY_DEBUG_TYPE, debugTrackerFactory),
    vscode.debug.registerDebugAdapterDescriptorFactory(DS_IDE_DEBUG_TYPE, new DsIdeDebugAdapterDescriptorFactory((session) => ({
      currentEmulatorPid: () => manager.childPid,
      stopEmulator,
      onEmulatorExit: (listener) => {
        manager.on('exit', listener);
        return { dispose: () => { manager.off('exit', listener); } };
      },
      consumeLaunch: (config) => runConfigProvider.consumeLaunch(config),
      rebuildAndDeploy: (mode, token) => runConfigProvider.buildAndDeployWithProgress(mode, token),
      attachDebugger: (pid) => runConfigProvider.attachDebugger(session, pid),
    }))),
    vscode.debug.registerDebugConfigurationProvider(DS_IDE_DEBUG_TYPE, runConfigProvider),
    saveListener,
    projectFileWatcher,
    ...commandDisposables,
    { dispose: () => {
      manager?.dispose(); scopePanel?.dispose(); oledPanel?.dispose(); midiPanel?.dispose();
      hostMidiBridge?.stop();
    } },
  );
}

export function deactivate(): void {
  // disposables are registered in context.subscriptions — VS Code disposes them automatically
}
