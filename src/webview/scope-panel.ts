import * as vscode from 'vscode';
import { EmulatorManager } from '../emulator/manager';
import { IpcMessage } from '../emulator/ipc-client';
import { startAudio, stopAudio } from '../commands/transport';
import { ControllerDef, ButtonDef, LedDef, ControllerConfig } from '../controllers/controller-config';
import { ConventionControl } from '../controllers/controls-convention-parser';

export interface ControlsPlacement {
  id: string;
  pos: [number, number];
}

export interface ControlsConfig {
  controls: ConventionControl[];
  placements: ControlsPlacement[];
  missingBlock: boolean;
}

const PANEL_ID = 'daisy-scope';
const PANEL_TITLE = 'Daisy Scope';

export const SINE_DEFAULTS = { freq: 440, amplitude: 0.5 } as const;

export interface SineParams {
  freq: number;
  amplitude: number;
}

export type AudioInputSource = 'sine' | 'live' | 'wav';

export interface AudioSource {
  input: AudioInputSource;
  sampleRate: number;
  bufferSize: number;
  // M9: WAV input. wavPath is the chosen file (empty = none); wavLoop toggles
  // repeating vs one-shot playback.
  wavLoop: boolean;
  wavPath?: string;
}

export const AUDIO_SOURCE_DEFAULTS: AudioSource = {
  input: 'sine',
  sampleRate: 48000,
  bufferSize: 256,
  wavLoop: true,
  wavPath: '',
};

export type PotChangeHandler = (channel: number, value: number) => void;
export type SineChangeHandler = (freq: number, amplitude: number) => void;
export type AudioSourceChangeHandler = (source: AudioSource) => void;
export type PickWavHandler = () => void;
export type ButtonChangeHandler = (gpioPin: number, pressed: boolean) => void;
export type EditorSaveHandler = (cfg: ControllerConfig) => void;
export type RecordStartHandler = () => void;
export type RecordStopHandler = () => void;
export type ReplayStartHandler = () => void;
export type OutputVolumeHandler = (volume: number) => void;

export class ScopePanel {
  private panel: vscode.WebviewPanel | null = null;
  private defs: ControllerDef[] = [];
  private initialValues: Record<number, number> = {};
  private sineParams: SineParams = { ...SINE_DEFAULTS };
  private audioSource: AudioSource = { ...AUDIO_SOURCE_DEFAULTS };
  private buttons: ButtonDef[] = [];
  private leds: LedDef[] = [];
  private initialButtons: Record<number, boolean> = {};
  private msgDisposable: vscode.Disposable | null = null;
  private pendingControlsConfig: ControlsConfig | null = null;
  private lastStatusMsg: IpcMessage | null = null;

  constructor(
    private readonly manager: EmulatorManager,
    private readonly onPotChange?: PotChangeHandler,
    private readonly onSineChange?: SineChangeHandler,
    private readonly onAudioSourceChange?: AudioSourceChangeHandler,
    private readonly onPickWav?: PickWavHandler,
    private readonly onButtonChange?: ButtonChangeHandler,
    private readonly onEditorSave?: EditorSaveHandler,
    private readonly onRecordStart?: RecordStartHandler,
    private readonly onRecordStop?: RecordStopHandler,
    private readonly onReplayStart?: ReplayStartHandler,
    private readonly onOutputVolume?: OutputVolumeHandler,
  ) {
    manager.on('message', (msg: IpcMessage) => {
      if (msg['type'] === 'scope') this.postScope(msg);
      if (msg['type'] === 'status') { this.lastStatusMsg = msg; this.postStatus(msg); }
      if (msg['type'] === 'event') this.postEvent(msg);
      if (msg['type'] === 'xrun') this.postXrun(msg);
      if (msg['type'] === 'latency') this.postLatency(msg);
      if (msg['type'] === 'led') this.postLed(msg);
      if (msg['type'] === 'spectrum') this.postSpectrum(msg);
      if (msg['type'] === 'replayDone') this.postReplayDone();
    });
  }

  show(
    defs: ControllerDef[] = [],
    initialValues: Record<number, number> = {},
    sineParams: SineParams = { ...SINE_DEFAULTS },
    audioSource: AudioSource = { ...AUDIO_SOURCE_DEFAULTS },
    buttons: ButtonDef[] = [],
    leds: LedDef[] = [],
    initialButtons: Record<number, boolean> = {},
  ): void {
    this.defs = defs;
    this.initialValues = initialValues;
    this.sineParams = sineParams;
    this.audioSource = audioSource;
    this.buttons = buttons;
    this.leds = leds;
    this.initialButtons = initialButtons;

    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Two);
      this.panel.webview.html = this.html();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      PANEL_ID,
      PANEL_TITLE,
      vscode.ViewColumn.Two,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel.webview.html = this.html();

    this.msgDisposable = this.panel.webview.onDidReceiveMessage((msg: unknown) => {
      if (!msg || typeof msg !== 'object') return;
      const m = msg as Record<string, unknown>;
      if (m['command'] === 'webviewReady') {
        if (this.pendingControlsConfig) {
          this.panel?.webview.postMessage({ command: 'controlsConfig', ...this.pendingControlsConfig });
        }
        if (this.lastStatusMsg) this.postStatus(this.lastStatusMsg);
        return;
      }
      if (m['command'] === 'pot' && typeof m['channel'] === 'number' && typeof m['value'] === 'number') {
        this.manager.sendPot(m['channel'], m['value']);
        this.onPotChange?.(m['channel'], m['value']);
      }
      if (m['command'] === 'sine' && typeof m['freq'] === 'number' && typeof m['amplitude'] === 'number') {
        this.sineParams = { freq: m['freq'], amplitude: m['amplitude'] };
        this.manager.sendSine(m['freq'], m['amplitude']);
        this.onSineChange?.(m['freq'], m['amplitude']);
      }
      if (m['command'] === 'audioSource') {
        const input = m['input'] as AudioInputSource;
        const sampleRate = m['sampleRate'] as number;
        const bufferSize = m['bufferSize'] as number;
        if (input && sampleRate && bufferSize) {
          this.audioSource = {
            ...this.audioSource,
            input,
            sampleRate,
            bufferSize,
            wavLoop: m['wavLoop'] === true,
          };
          this.onAudioSourceChange?.(this.audioSource);
        }
      }
      if (m['command'] === 'pickWav') {
        this.onPickWav?.();
      }
      if (m['command'] === 'button' && typeof m['gpioPin'] === 'number' && typeof m['pressed'] === 'boolean') {
        this.manager.sendButton(m['gpioPin'], m['pressed']);
        this.onButtonChange?.(m['gpioPin'], m['pressed']);
      }
      if (m['command'] === 'editorSave') {
        const cfg = m['cfg'] as ControllerConfig | undefined;
        if (cfg) this.onEditorSave?.(cfg);
      }
      if (m['command'] === 'startAudio') startAudio(this.manager);
      if (m['command'] === 'stopAudio')  stopAudio(this.manager);
      if (m['command'] === 'recordStart') this.onRecordStart?.();
      if (m['command'] === 'recordStop')  this.onRecordStop?.();
      if (m['command'] === 'replayStart') this.onReplayStart?.();
      if (m['command'] === 'outputVolume' && typeof m['volume'] === 'number') {
        this.manager.sendOutputVolume(m['volume']);
        this.onOutputVolume?.(m['volume']);
      }
    });

    this.panel.onDidDispose(() => {
      this.msgDisposable?.dispose();
      this.msgDisposable = null;
      this.panel = null;
    });
  }

  // Opens the panel (creating it if needed) and switches to the Controller Editor tab,
  // pushing cfg to the canvas. Can be called before or after show().
  loadEditor(cfg: ControllerConfig): void {
    if (!this.panel) {
      // Panel not open yet — create it with defaults so the HTML renders.
      this.show();
    }
    this.panel!.reveal(vscode.ViewColumn.Two);
    this.panel!.webview.postMessage({ command: 'editorLoad', cfg });
  }

  // Called by the extension after the user picks a WAV file via the native open
  // dialog: records the path and updates the webview (filename label + selection).
  notifyWavSelected(fileName: string, wavPath: string): void {
    this.audioSource = { ...this.audioSource, input: 'wav', wavPath };
    this.panel?.webview.postMessage({ command: 'wavSelected', name: fileName });
  }

  dispose(): void {
    this.msgDisposable?.dispose();
    this.msgDisposable = null;
    this.panel?.dispose();
    this.panel = null;
  }

  private postScope(msg: IpcMessage): void {
    this.panel?.webview.postMessage({ command: 'scope', in: msg['in'], out: msg['out'] });
  }

  private postStatus(msg: IpcMessage): void {
    this.panel?.webview.postMessage({ command: 'status', ...msg });
  }

  private postEvent(msg: IpcMessage): void {
    this.panel?.webview.postMessage({ command: 'event', kind: msg['kind'] });
  }

  private postXrun(msg: IpcMessage): void {
    this.panel?.webview.postMessage({ command: 'xrun', count: msg['count'] });
  }

  private postLatency(msg: IpcMessage): void {
    this.panel?.webview.postMessage({ command: 'latency', measuredMs: msg['measuredMs'] });
  }

  private postLed(msg: IpcMessage): void {
    this.panel?.webview.postMessage({ command: 'led', gpioPin: msg['gpioPin'], lit: msg['lit'] });
  }

  private postSpectrum(msg: IpcMessage): void {
    this.panel?.webview.postMessage({
      command: 'spectrum',
      in_fft: msg['in_fft'],
      out_fft: msg['out_fft'],
      binHz: msg['binHz'],
    });
  }

  private postReplayDone(): void {
    this.panel?.webview.postMessage({ command: 'replayDone' });
  }

  // Called by the extension after starting/stopping recording or replay.
  notifyRecordingState(recording: boolean, replaying: boolean, fileName?: string): void {
    this.panel?.webview.postMessage({ command: 'recordingState', recording, replaying, fileName });
  }

  // C9: send parsed convention controls + YAML placements to the Controls Editor.
  // Stores the config so it can be re-sent when the webview signals it is ready
  // (race guard: show() regenerates HTML and the next postMessage may arrive before JS init).
  postControlsConfig(config: ControlsConfig): void {
    this.pendingControlsConfig = config;
    this.panel?.webview.postMessage({ command: 'controlsConfig', ...config });
    if (this.lastStatusMsg) this.postStatus(this.lastStatusMsg);
  }

  private html(): string {
    return buildHtml(
      this.defs, this.initialValues, this.sineParams, this.audioSource,
      this.buttons, this.leds, this.initialButtons,
    );
  }
}

function buildControllersHtml(defs: ControllerDef[], initialValues: Record<number, number>): string {
  if (defs.length === 0) return '';

  const sliders = defs.map(d => {
    const val = initialValues[d.adcChannel] ?? d.default;
    return `
      <div class="pot" data-channel="${d.adcChannel}">
        <span class="pot-label">${escHtml(d.label)}</span>
        <input type="range" class="pot-slider"
               min="0" max="1" step="0.001"
               value="${val}"
               data-channel="${d.adcChannel}"/>
        <span class="pot-value">${val.toFixed(3)}</span>
      </div>`;
  }).join('\n');

  return `<div id="controllers">${sliders}\n</div>`;
}

function buildButtonsHtml(buttons: ButtonDef[], initial: Record<number, boolean>): string {
  if (buttons.length === 0) return '';

  const items = buttons.map(b => {
    const pressed = initial[b.gpioPin] ?? false;
    return `
      <button class="vbutton ${pressed ? 'vbutton-on' : ''}" type="button"
              data-pin="${b.gpioPin}" data-mode="${b.mode}"
              aria-pressed="${pressed}">
        <span class="vbutton-label">${escHtml(b.label)}</span>
        <span class="vbutton-pin">pin ${b.gpioPin}${b.mode === 'toggle' ? ' · toggle' : ''}</span>
      </button>`;
  }).join('\n');

  return `<div id="buttons"><span class="section-label">Buttons:</span>${items}\n</div>`;
}

function buildLedsHtml(leds: LedDef[]): string {
  if (leds.length === 0) return '';

  const items = leds.map(l => `
      <div class="vled" data-pin="${l.gpioPin}">
        <span class="vled-dot" data-pin="${l.gpioPin}"></span>
        <span class="vled-label">${escHtml(l.label)}</span>
      </div>`).join('\n');

  return `<div id="leds"><span class="section-label">LEDs:</span>${items}\n</div>`;
}

// T15.1+T15.3: single inline emulator bar — source dropdown + context-sensitive controls + recording
function buildEmulatorBarHtml(source: AudioSource, sine: SineParams): string {
  const isSine = source.input === 'sine';
  const isLive = source.input === 'live';
  const isWav  = source.input === 'wav';
  const bufSizes = [64, 128, 256, 512];
  const bufOptions = bufSizes.map(s =>
    `<option value="${s}" ${s === source.bufferSize ? 'selected' : ''}>${s}</option>`
  ).join('');
  const wavName = source.wavPath ? baseName(source.wavPath) : '';
  // T15.1: dropdown instead of radios
  const srcOptions = [
    `<option value="sine" ${isSine ? 'selected' : ''}>Sine</option>`,
    `<option value="live" ${isLive ? 'selected' : ''}>Live (mic)</option>`,
    `<option value="wav" ${isWav  ? 'selected' : ''}>WAV</option>`,
  ].join('');
  return `<div id="emulator-bar">
    <span class="emu-label">Input:</span>
    <select id="audio-source-select">${srcOptions}</select>
    <span class="emu-sep">|</span>
    <!-- Sine controls (shown only when sine selected) -->
    <span id="sine-group" class="emu-group ${isSine ? '' : 'emu-hidden'}">
      <label class="emu-field">Freq <input type="number" id="sine-freq" min="20" max="20000" step="1" value="${sine.freq}"/> Hz</label>
      <label class="emu-field">Amp <input type="range" id="sine-amp" min="0" max="1" step="0.01" value="${sine.amplitude}"/>
        <span id="sine-amp-val">${sine.amplitude.toFixed(2)}</span></label>
    </span>
    <!-- WAV controls (shown only when wav selected) -->
    <span id="wav-group" class="emu-group ${isWav ? '' : 'emu-hidden'}">
      <button id="wav-choose" type="button" class="emu-btn">Choose WAV…</button>
      <span id="wav-name" class="wav-name">${wavName ? escHtml(wavName) : 'no file'}</span>
      <label class="emu-field"><input type="checkbox" id="wav-loop" ${source.wavLoop ? 'checked' : ''}/> Loop</label>
    </span>
    <!-- Buffer (live + wav) -->
    <span id="buffer-group" class="emu-group ${isLive || isWav ? '' : 'emu-hidden'}">
      <label class="emu-field">Buffer <select id="buffer-size">${bufOptions}</select> samples</label>
    </span>
    <!-- Latency (live only) -->
    <span id="latency-group" class="emu-group ${isLive ? '' : 'emu-hidden'}">
      <span id="latency-display" class="latency-text">latency: —</span>
    </span>
    <span class="emu-rec-sep">|</span>
    <!-- Recording controls — always visible -->
    <span class="rec-label">Session:</span>
    <button id="rec-start-btn" class="rec-btn" type="button">&#9679;</button>
    <button id="rec-stop-btn"  class="rec-btn" type="button" disabled>&#9632;</button>
    <button id="replay-start-btn" class="rec-btn" type="button">&#9654; Replay file&hellip;</button>
    <span id="rec-filename" class="rec-filename"></span>
  </div>`;
}

function baseName(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function safeJsonEmbed(obj: unknown): string {
  return JSON.stringify(obj).replace(/<\//g, '<\\/');
}

function buildHtml(
  defs: ControllerDef[], initialValues: Record<number, number>, sine: SineParams, source: AudioSource,
  buttons: ButtonDef[] = [], leds: LedDef[] = [], initialButtons: Record<number, boolean> = {},
): string {
  const audioSourceHtml = buildEmulatorBarHtml(source, sine);
  return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Daisy Scope</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #1e1e1e; color: #d4d4d4; font-family: monospace; font-size: 12px; display: flex; flex-direction: column; height: 100vh; border: 1px solid #3c3c3c; }
    header { padding: 6px 12px; background: #252526; display: flex; align-items: center; gap: 16px; border-bottom: 1px solid #3c3c3c; flex-wrap: wrap; flex-shrink: 0; }
    #fidelity-caveat { font-size: 10px; color: #6a6a6a; cursor: default; margin-left: auto; }
    #status-text { flex: 1; }
    .legend { display: flex; gap: 12px; }
    .legend span { display: flex; align-items: center; gap: 4px; }
    .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
    .dot-in  { background: #4ec9b0; }
    .dot-out { background: #ce9178; }
    /* T15.4: master output volume in header */
    #vol-group { display: flex; align-items: center; gap: 6px; }
    #vol-label { color: #9cdcfe; font-size: 11px; }
    #output-vol { width: 80px; cursor: pointer; accent-color: #4ec9b0; }
    #vol-val { min-width: 30px; color: #b5cea8; font-size: 11px; }
    #events { padding: 3px 12px; min-height: 22px; background: #252526; border-bottom: 1px solid #3c3c3c; font-size: 11px; color: #f48771; flex-shrink: 0; }
    canvas { display: block; width: 100%; }
    #scope { flex: 1; min-height: 0; }
    #spectrum { height: 140px; border-top: 1px solid #3c3c3c; background: #1a1a1a; flex-shrink: 0; }
    /* T15.2: collapsible section wrappers */
    .coll-section { background: #252526; border-top: 1px solid #3c3c3c; flex-shrink: 0; }
    .coll-header { display: flex; align-items: center; gap: 8px; padding: 5px 12px; cursor: pointer; user-select: none; color: #9cdcfe; font-size: 11px; }
    .coll-header:hover { background: #2a2a2a; }
    .coll-arrow { font-size: 10px; transition: transform 0.15s; }
    .coll-body { overflow: hidden; }
    .coll-body.collapsed { display: none; }
    /* T15.3: single inline emulator bar */
    #emulator-bar { padding: 6px 12px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .emu-label { color: #9cdcfe; }
    #audio-source-select { background: #3c3c3c; color: #d4d4d4; border: 1px solid #555; padding: 2px 6px; font-family: monospace; cursor: pointer; border-radius: 2px; }
    .emu-sep { color: #3c3c3c; user-select: none; }
    .emu-rec-sep { color: #555; user-select: none; border-left: 1px solid #555; height: 14px; margin: 0 4px; }
    .emu-group { display: inline-flex; align-items: center; gap: 6px; }
    .emu-hidden { display: none !important; }
    .emu-field { display: inline-flex; align-items: center; gap: 4px; }
    .emu-field input[type="number"] { width: 64px; background: #3c3c3c; color: #d4d4d4; border: 1px solid #555; padding: 2px 4px; font-family: monospace; }
    .emu-field input[type="range"] { width: 90px; cursor: pointer; }
    .emu-field select { background: #3c3c3c; color: #d4d4d4; border: 1px solid #555; padding: 2px 4px; font-family: monospace; cursor: pointer; }
    .emu-btn { background: #0e639c; color: #fff; border: none; padding: 3px 8px; font-family: monospace; cursor: pointer; border-radius: 2px; }
    .emu-btn:hover { background: #1177bb; }
    .latency-text { color: #b5cea8; }
    .wav-name { color: #b5cea8; font-style: italic; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    /* Recording buttons inside the emulator bar */
    .rec-label { color: #9cdcfe; }
    .rec-btn { background: #3c3c3c; color: #d4d4d4; border: 1px solid #555; padding: 3px 10px; font-family: monospace; font-size: 12px; cursor: pointer; border-radius: 2px; }
    .rec-btn:hover { background: #4a4a4a; }
    .rec-btn:disabled { opacity: 0.4; cursor: default; }
    #rec-start-btn { border-color: #c94040; color: #f48771; }
    #rec-start-btn:hover:not(:disabled) { background: #5a1a1a; }
    #rec-start-btn.recording { background: #c94040; color: #fff; border-color: #ff6060; animation: blink 1s step-end infinite; }
    @keyframes blink { 50% { opacity: 0.5; } }
    #replay-start-btn { border-color: #4ec9b0; color: #4ec9b0; }
    #replay-start-btn:hover:not(:disabled) { background: #1a3a35; }
    #replay-start-btn.replaying { background: #1e5a4a; color: #fff; }
    .rec-filename { color: #b5cea8; font-style: italic; font-size: 11px; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    /* Effect controls section contents */
    .section-label { color: #9cdcfe; align-self: center; }
    #buttons { padding: 8px 12px; display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
    .vbutton { display: flex; flex-direction: column; align-items: center; gap: 2px; background: #3c3c3c; color: #d4d4d4; border: 1px solid #555; border-radius: 4px; padding: 6px 12px; font-family: monospace; cursor: pointer; user-select: none; }
    .vbutton:active { background: #4a4a4a; }
    .vbutton-on { background: #0e639c; border-color: #1177bb; color: #fff; }
    .vbutton-label { font-size: 12px; }
    .vbutton-pin { font-size: 9px; color: #9a9a9a; }
    .vbutton-on .vbutton-pin { color: #cfe8ff; }
    #leds { padding: 8px 12px; display: flex; flex-wrap: wrap; gap: 16px; align-items: center; }
    .vled { display: flex; align-items: center; gap: 6px; }
    .vled-dot { width: 12px; height: 12px; border-radius: 50%; background: #3c3c3c; border: 1px solid #555; box-shadow: none; }
    .vled-dot.vled-lit { background: #f04a4a; border-color: #ff6a6a; box-shadow: 0 0 6px 1px #f04a4a; }
    .vled-label { color: #b5cea8; }
    #controllers { padding: 8px 12px; display: flex; flex-wrap: wrap; gap: 16px; }
    .pot { display: flex; align-items: center; gap: 8px; }
    .pot-label { min-width: 80px; color: #9cdcfe; }
    .pot-slider { width: 140px; cursor: pointer; }
    .pot-value { min-width: 40px; text-align: right; color: #b5cea8; }
    .audio-btn { background: #3c3c3c; color: #d4d4d4; border: 1px solid #555; padding: 3px 8px; font-family: monospace; font-size: 13px; cursor: pointer; border-radius: 2px; }
    .audio-btn:disabled { opacity: 0.35; cursor: default; }
    #btn-audio-start { border-color: #4a7a4a; color: #4ec9b0; }
    #btn-audio-start:not(:disabled):hover { background: #1a3a1a; }
    #btn-audio-stop  { border-color: #7a3a3a; color: #f48771; }
    #btn-audio-stop:not(:disabled):hover  { background: #3a1a1a; }
    #getting-started { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: #6a6a6a; padding: 32px; text-align: center; }
    #getting-started ol { text-align: left; padding-left: 20px; line-height: 2; }
    #getting-started code { background: #3c3c3c; padding: 1px 4px; border-radius: 2px; color: #9cdcfe; }
    /* M10b — Controller Editor tab */
    #tab-bar { display: flex; background: #2d2d30; border-bottom: 1px solid #3c3c3c; flex-shrink: 0; }
    .tab { background: transparent; color: #9a9a9a; border: none; border-bottom: 2px solid transparent; padding: 7px 18px; cursor: pointer; font-family: monospace; font-size: 12px; }
    .tab:hover { color: #d4d4d4; background: #37373d; }
    .tab-active { color: #fff; border-bottom-color: #4ec9b0; }
    #scope-content { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; }
    #editor-wrap { display: flex; flex-direction: column; flex: 1; min-height: 0; }
    #editor-toolbar { padding: 6px 12px; background: #252526; border-bottom: 1px solid #3c3c3c; display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
    #save-btn { background: #0e639c; color: #fff; border: none; padding: 4px 14px; font-family: monospace; cursor: pointer; border-radius: 2px; font-size: 12px; }
    #save-btn:hover { background: #1177bb; }
    #save-status { font-size: 11px; color: #b5cea8; }
    #editor-main { display: flex; flex: 1; min-height: 0; overflow: hidden; }
    #palette { width: 140px; background: #252526; border-right: 1px solid #3c3c3c; padding: 10px 8px; display: flex; flex-direction: column; gap: 8px; flex-shrink: 0; overflow-y: auto; }
    .palette-title { font-size: 10px; color: #6a6a6a; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 2px; }
    .palette-item { padding: 7px 10px; border-radius: 4px; border: 1px solid #555; background: #3c3c3c; color: #d4d4d4; cursor: grab; user-select: none; font-size: 11px; text-align: center; }
    .palette-item:hover { background: #4a4a4a; }
    .palette-item[data-kind="pot"]    { border-left: 3px solid #4ec9b0; }
    .palette-item[data-kind="button"] { border-left: 3px solid #569cd6; }
    .palette-item[data-kind="led"]    { border-left: 3px solid #f04a4a; }
    #canvas-area { flex: 1; position: relative; overflow: auto; background: #1e1e1e; }
    #canvas-hint { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #3c3c3c; font-size: 13px; pointer-events: none; }
    .ctrl-card { position: absolute; min-width: 168px; background: #252526; border: 1px solid #555; border-radius: 4px; box-shadow: 0 2px 6px rgba(0,0,0,0.4); }
    .ctrl-card[data-kind="pot"]    { border-top: 3px solid #4ec9b0; }
    .ctrl-card[data-kind="button"] { border-top: 3px solid #569cd6; }
    .ctrl-card[data-kind="led"]    { border-top: 3px solid #f04a4a; }
    .card-header { padding: 4px 6px 4px 8px; display: flex; align-items: center; justify-content: space-between; cursor: grab; background: rgba(255,255,255,0.03); }
    .card-kind { font-size: 9px; color: #6a6a6a; text-transform: uppercase; letter-spacing: 0.5px; }
    .card-del { background: none; border: none; color: #555; cursor: pointer; font-size: 15px; padding: 0 2px; line-height: 1; }
    .card-del:hover { color: #f04a4a; }
    .card-body { padding: 5px 8px 8px; display: flex; flex-direction: column; gap: 4px; }
    .card-field { display: flex; align-items: center; gap: 5px; }
    .card-field label { font-size: 10px; color: #9a9a9a; min-width: 46px; }
    .card-inp { background: #3c3c3c; color: #d4d4d4; border: 1px solid #555; padding: 2px 4px; font-family: monospace; font-size: 11px; flex: 1; min-width: 0; }
    .card-sel { background: #3c3c3c; color: #d4d4d4; border: 1px solid #555; padding: 2px 4px; font-family: monospace; font-size: 11px; flex: 1; }
    .card-val { color: #b5cea8; font-size: 11px; }
    /* D19: handle-based UX — no mode toggle */
    .ctrl-handle { display: flex; align-items: center; gap: 6px; padding: 4px 6px 4px 8px; cursor: grab; background: rgba(255,255,255,0.03); border-bottom: 1px solid #3c3c3c; user-select: none; }
    .ctrl-handle:active { cursor: grabbing; }
    .handle-glyph { color: #555; font-size: 13px; }
    .card-id-label { flex: 1; color: #d4d4d4; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .card-pin-label { color: #6a6a6a; font-size: 10px; }
    .ctrl-body { padding: 6px 8px 8px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .body-disabled { opacity: 0.35; pointer-events: none; }
    #ce-emu-status { font-size: 11px; }
    .ce-emu-running { color: #4ec9b0; }
    .ce-emu-stopped { color: #9a9a9a; }
    .knob-wrap { display: flex; flex-direction: column; align-items: center; gap: 3px; cursor: ns-resize; user-select: none; padding: 2px 4px; }
    .knob-svg { display: block; }
    .knob-value { color: #b5cea8; font-size: 10px; font-family: monospace; min-width: 36px; text-align: center; }
    .btn-ce { background: #3c3c3c; color: #d4d4d4; border: 1px solid #555; border-radius: 4px; padding: 4px 10px; font-family: monospace; font-size: 11px; cursor: pointer; }
    .btn-ce[aria-pressed="true"] { background: #0e639c; border-color: #1177bb; color: #fff; }
    /* M17: convention diagnostic banner */
    #convention-banner { display: none; align-items: center; gap: 8px; padding: 5px 12px; background: #3a2f00; border-bottom: 1px solid #7a6500; color: #f4c430; font-size: 11px; flex-shrink: 0; }
    /* D19: design area (single-mode canvas) */
    #design-area { display: flex; flex: 1; min-height: 0; overflow: hidden; }
  </style>
</head>
<body>
  <div id="tab-bar">
    <button class="tab tab-active" id="tab-scope-btn">Scope</button>
    <button class="tab" id="tab-editor-btn">Controls Editor</button>
  </div>
  <div id="scope-content">
  <header>
    <span id="status-text">Deploy to start…</span>
    <span class="legend">
      <span><span class="dot dot-in"></span>In</span>
      <span><span class="dot dot-out"></span>Out</span>
    </span>
    <!-- T15.4: master output volume — always visible in header -->
    <span id="vol-group">
      <label id="vol-label" for="output-vol">Vol</label>
      <input type="range" id="output-vol" min="0" max="1" step="0.01" value="1"/>
      <span id="vol-val">1.00</span>
    </span>
    <button class="audio-btn" id="btn-audio-start" title="Start Audio" disabled>&#9654;</button>
    <button class="audio-btn" id="btn-audio-stop"  title="Stop Audio"  disabled>&#9632;</button>
    <span id="fidelity-caveat" title="Emulator approximates the Seed — not bit-exact, does not validate hardware CPU/RAM budget">ℹ Approx. Seed</span>
  </header>
  <div id="events"></div>
  <canvas id="scope" style="display:none"></canvas>
  <canvas id="spectrum" style="display:none"></canvas>
  <div id="getting-started">
    <div>Open a libDaisy project, then:</div>
    <ol>
      <li><code>Daisy IDE: Build for Emulator</code></li>
      <li><code>Daisy IDE: Deploy to Emulator</code></li>
      <li><code>Daisy IDE: Start Audio</code></li>
    </ol>
    <div style="margin-top:8px;font-size:11px">Use <code>Deploy and Debug</code> to attach breakpoints.</div>
  </div>
  <!-- T15.2: collapsible Emulator section (collapsed by default) -->
  <div class="coll-section" id="emulator-section">
    <div class="coll-header" id="emulator-header" aria-expanded="false">
      <span class="coll-arrow" id="emulator-arrow" style="transform:rotate(-90deg)">▾</span>
      <span>Emulator</span>
    </div>
    <div class="coll-body collapsed" id="emulator-body">
      ${audioSourceHtml}
    </div>
  </div>
  </div><!-- #scope-content -->
  <div id="editor-wrap" style="display:none">
    <div id="editor-toolbar">
      <span id="ce-emu-status" class="ce-emu-stopped">&#9632; Stopped</span>
      <span class="emu-sep" style="margin:0 6px">|</span>
      <span id="save-wrap" style="display:inline-flex;align-items:center;gap:8px">
        <button id="save-btn">Save controllers.yaml</button>
        <span id="save-status"></span>
      </span>
    </div>
    <div id="convention-banner">⚠ Code convention not detected — running in yaml-only mode</div>
    <div id="design-area">
      <div id="palette">
        <div class="palette-title">Palette</div>
        <div class="palette-item" data-kind="pot" draggable="true">Pot</div>
        <div class="palette-item" data-kind="button" draggable="true">Button</div>
        <div class="palette-item" data-kind="led" draggable="true">LED</div>
      </div>
      <div id="canvas-area">
        <div id="canvas-hint">Drag a control from the palette</div>
      </div>
    </div>
  </div><!-- #editor-wrap -->
  <script id="yaml-init" type="application/json">${safeJsonEmbed({ pots: defs, buttons, leds })}</script>
  <script>
    const vscode = acquireVsCodeApi();
    const canvas = document.getElementById('scope');
    const ctx = canvas.getContext('2d');
    const specCanvas = document.getElementById('spectrum');
    const specCtx = specCanvas.getContext('2d');
    const statusEl   = document.getElementById('status-text');
    const btnAudioStart = document.getElementById('btn-audio-start');
    const btnAudioStop  = document.getElementById('btn-audio-stop');
    const eventsEl = document.getElementById('events');
    const gettingStarted = document.getElementById('getting-started');
    const sineFreqEl = document.getElementById('sine-freq');
    const sineAmpEl  = document.getElementById('sine-amp');
    const sineAmpValEl = document.getElementById('sine-amp-val');
    const bufferSizeEl = document.getElementById('buffer-size');
    const latencyEl = document.getElementById('latency-display');
    const wavChooseEl = document.getElementById('wav-choose');
    const wavNameEl = document.getElementById('wav-name');
    const wavLoopEl = document.getElementById('wav-loop');
    const outputVolEl = document.getElementById('output-vol');
    const volValEl = document.getElementById('vol-val');

    let lastIn = [], lastOut = [];
    let lastSpecIn = [], lastSpecOut = [], lastBinHz = 0;
    const activeEvents = new Set();
    let hasStatus = false;
    let xrunCount = 0;

    function showScope() {
      if (!hasStatus) return;
      canvas.style.display = 'block';
      specCanvas.style.display = 'block';
      gettingStarted.style.display = 'none';
      resize();
    }

    function resize() {
      canvas.width  = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
      specCanvas.width  = specCanvas.clientWidth;
      specCanvas.height = specCanvas.clientHeight;
      draw();
      drawSpectrum();
    }

    // [SYNC] draw — mirrors mockup/scope.html draw/drawWave/drawSpectrum block
    function draw() {
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#1e1e1e';
      ctx.fillRect(0, 0, W, H);

      ctx.strokeStyle = '#3c3c3c';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2);
      ctx.moveTo(0, H / 4); ctx.lineTo(W, H / 4);
      ctx.moveTo(0, 3 * H / 4); ctx.lineTo(W, 3 * H / 4);
      ctx.stroke();

      drawWave(lastIn,  '#4ec9b0');
      drawWave(lastOut, '#ce9178');
    }

    // [SYNC] drawWave
    function drawWave(pts, color) {
      if (!pts || pts.length < 2) return;
      const W = canvas.width, H = canvas.height;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const x = (i / (pts.length - 1)) * W;
        const y = H / 2 - pts[i] * (H / 2 * 0.9);
        if (i === 0) ctx.moveTo(x, y);
        else         ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // [SYNC] drawSpectrum
    function drawSpectrum() {
      const W = specCanvas.width, H = specCanvas.height;
      specCtx.clearRect(0, 0, W, H);
      specCtx.fillStyle = '#1a1a1a';
      specCtx.fillRect(0, 0, W, H);

      if (!lastSpecIn || lastSpecIn.length < 2) return;

      const N = lastSpecIn.length;
      // Display bins up to 20 kHz (or Nyquist, whichever is lower)
      const maxFreq = Math.min(20000, lastBinHz * N);
      const maxBin  = lastBinHz > 0 ? Math.min(N, Math.ceil(maxFreq / lastBinHz)) : N;
      const peak = Math.max(
        lastSpecIn.slice(0, maxBin).reduce((a, v) => Math.max(a, v), 1e-9),
        lastSpecOut.slice(0, maxBin).reduce((a, v) => Math.max(a, v), 1e-9),
      );

      // Margins: left for dB labels, bottom for freq labels
      const LEFT = 36, BOTTOM = 16, TOP = 4;
      const plotW = W - LEFT;
      const plotH = H - BOTTOM - TOP;
      const ampToY = (amp) => TOP + plotH * (1 - amp / peak);

      // Grid lines (dB: 0, -20, -40, -60) + y-axis labels (left of plot)
      specCtx.font = '9px monospace';
      specCtx.textAlign = 'right';
      let lastDbLabelY = -Infinity;
      for (let db = 0; db >= -60; db -= 20) {
        const y = ampToY(Math.pow(10, db / 20) * peak);
        specCtx.strokeStyle = '#2a2a2a';
        specCtx.lineWidth = 1;
        specCtx.beginPath();
        specCtx.moveTo(LEFT, y); specCtx.lineTo(W, y);
        specCtx.stroke();
        if (y - lastDbLabelY >= 11) {
          specCtx.fillStyle = '#777';
          specCtx.fillText(db + 'dB', LEFT - 4, y + 4);
          lastDbLabelY = y;
        }
      }
      specCtx.textAlign = 'left';

      // x-axis baseline
      specCtx.strokeStyle = '#3c3c3c';
      specCtx.lineWidth = 1;
      specCtx.beginPath();
      specCtx.moveTo(LEFT, TOP + plotH); specCtx.lineTo(W, TOP + plotH);
      specCtx.stroke();

      function drawSpecLine(fft, color) {
        specCtx.strokeStyle = color;
        specCtx.lineWidth = 1.5;
        specCtx.beginPath();
        for (let i = 0; i < maxBin; i++) {
          const x = LEFT + (i / (maxBin - 1)) * plotW;
          const y = ampToY(fft[i]);
          if (i === 0) specCtx.moveTo(x, y);
          else         specCtx.lineTo(x, y);
        }
        specCtx.stroke();
      }

      drawSpecLine(lastSpecIn,  '#4ec9b0');
      drawSpecLine(lastSpecOut, '#ce9178');

      // Frequency axis labels — skip any label that would overlap the previous one
      if (lastBinHz > 0) {
        specCtx.fillStyle = '#999';
        specCtx.font = '10px monospace';
        specCtx.textAlign = 'left';
        const freqLabels = [1000, 2000, 5000, 10000, 20000];
        let lastLabelRight = LEFT - 4;
        for (const f of freqLabels) {
          if (f > maxFreq) break;
          const x = LEFT + (f / maxFreq) * plotW;
          const text = f >= 1000 ? (f / 1000) + 'k' : String(f);
          if (x < lastLabelRight + 4) continue;
          specCtx.fillText(text, x + 2, H - 4);
          lastLabelRight = x + 2 + specCtx.measureText(text).width;
        }
      }
    }

    function sendSine() {
      const freq = parseFloat(sineFreqEl.value);
      const amplitude = parseFloat(sineAmpEl.value);
      if (!isNaN(freq) && !isNaN(amplitude)) {
        vscode.postMessage({ command: 'sine', freq, amplitude });
      }
    }

    // T15.3: show/hide source-specific control groups based on selected source
    function updateSourceGroups(input) {
      const isSine = input === 'sine';
      const isLive = input === 'live';
      const isWav  = input === 'wav';
      document.getElementById('sine-group')?.classList.toggle('emu-hidden', !isSine);
      document.getElementById('wav-group')?.classList.toggle('emu-hidden', !isWav);
      document.getElementById('buffer-group')?.classList.toggle('emu-hidden', !(isLive || isWav));
      document.getElementById('latency-group')?.classList.toggle('emu-hidden', !isLive);
    }

    // T15.1: dropdown handler
    function sendAudioSource() {
      const srcEl = document.getElementById('audio-source-select');
      const input = srcEl ? srcEl.value : 'sine';
      const bufferSize = parseInt(bufferSizeEl?.value || '256', 10);
      const sampleRate = 48000;
      const wavLoop = !!(wavLoopEl && wavLoopEl.checked);
      updateSourceGroups(input);
      vscode.postMessage({ command: 'audioSource', input, sampleRate, bufferSize, wavLoop });
    }

    sineFreqEl?.addEventListener('change', sendSine);
    sineAmpEl?.addEventListener('input', () => {
      if (sineAmpValEl) sineAmpValEl.textContent = parseFloat(sineAmpEl.value).toFixed(2);
      sendSine();
    });

    // T15.1: dropdown instead of radios
    document.getElementById('audio-source-select')?.addEventListener('change', sendAudioSource);
    bufferSizeEl?.addEventListener('change', sendAudioSource);

    // WAV controls
    wavChooseEl?.addEventListener('click', () => vscode.postMessage({ command: 'pickWav' }));
    wavLoopEl?.addEventListener('change', sendAudioSource);

    // T15.4: master output volume
    outputVolEl?.addEventListener('input', () => {
      const vol = parseFloat(outputVolEl.value);
      if (volValEl) volValEl.textContent = vol.toFixed(2);
      vscode.postMessage({ command: 'outputVolume', volume: vol });
    });

    // T15.2: collapsible section toggle
    function setupCollapsible(headerId, bodyId, arrowId) {
      const header = document.getElementById(headerId);
      const body   = document.getElementById(bodyId);
      const arrow  = document.getElementById(arrowId);
      if (!header || !body) return;
      header.addEventListener('click', () => {
        const expanded = header.getAttribute('aria-expanded') !== 'false';
        header.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        body.classList.toggle('collapsed', expanded);
        if (arrow) arrow.style.transform = expanded ? 'rotate(-90deg)' : '';
        resize();
      });
    }
    setupCollapsible('emulator-header', 'emulator-body', 'emulator-arrow');

    // Pot slider wiring
    document.querySelectorAll('.pot-slider').forEach(slider => {
      slider.addEventListener('input', () => {
        const channel = parseInt(slider.dataset.channel, 10);
        const value   = parseFloat(slider.value);
        slider.closest('.pot').querySelector('.pot-value').textContent = value.toFixed(3);
        vscode.postMessage({ command: 'pot', channel, value });
      });
    });

    // Virtual buttons (M10): momentary = held; toggle = latched per click.
    function setButtonVisual(btn, pressed) {
      btn.classList.toggle('vbutton-on', pressed);
      btn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    }
    function sendButton(pin, pressed) {
      vscode.postMessage({ command: 'button', gpioPin: pin, pressed });
    }
    document.querySelectorAll('.vbutton').forEach(btn => {
      const pin = parseInt(btn.dataset.pin, 10);
      const mode = btn.dataset.mode;
      if (mode === 'toggle') {
        btn.addEventListener('click', () => {
          const next = btn.getAttribute('aria-pressed') !== 'true';
          setButtonVisual(btn, next);
          sendButton(pin, next);
        });
      } else {
        const press   = () => { setButtonVisual(btn, true);  sendButton(pin, true); };
        const release = () => { setButtonVisual(btn, false); sendButton(pin, false); };
        btn.addEventListener('mousedown', press);
        btn.addEventListener('mouseup', release);
        btn.addEventListener('mouseleave', () => {
          if (btn.getAttribute('aria-pressed') === 'true') release();
        });
      }
    });

    window.addEventListener('resize', resize);
    resize();

    window.addEventListener('message', e => {
      const msg = e.data;
      if (msg.command === 'scope') {
        lastIn  = msg.in  || [];
        lastOut = msg.out || [];
        draw();
      } else if (msg.command === 'controlsConfig') {
        applyControlsConfig(msg);
      } else if (msg.command === 'status') {
        hasStatus = true;
        showScope();
        const r = msg.running ? '▶ Running' : '■ Stopped';
        if (statusEl) statusEl.textContent = r + '  |  ' + msg.sampleRate + ' Hz  |  block ' + msg.blockSize + '  |  xruns: ' + xrunCount;
        if (btnAudioStart) btnAudioStart.disabled = !!msg.running;
        if (btnAudioStop)  btnAudioStop.disabled  = !msg.running;
        if (!msg.running) {
          activeEvents.clear();
          eventsEl.textContent = '';
        }
        updateCeEmulatorState(!!msg.running);
      } else if (msg.command === 'wavSelected') {
        if (wavNameEl) wavNameEl.textContent = msg.name || 'no file';
        // T15.1: set dropdown to wav
        const srcEl = document.getElementById('audio-source-select');
        if (srcEl) { srcEl.value = 'wav'; updateSourceGroups('wav'); }
      } else if (msg.command === 'event') {
        if (msg.kind === 'realtime_unavailable') {
          eventsEl.textContent = '⚠ Live input unavailable — check microphone permission. Falling back to sine.';
          // T15.1: reset dropdown to sine
          const srcEl = document.getElementById('audio-source-select');
          if (srcEl) { srcEl.value = 'sine'; updateSourceGroups('sine'); }
          return;
        }
        if (msg.kind === 'wav_error') {
          eventsEl.textContent = '⚠ Could not load WAV file — unsupported format or unreadable.';
          return;
        }
        activeEvents.add(msg.kind.toUpperCase());
        eventsEl.textContent = [...activeEvents].map(k => '⚠ ' + k).join('  ');
      } else if (msg.command === 'xrun') {
        xrunCount = msg.count || 0;
        if (hasStatus) {
          statusEl.textContent = statusEl.textContent.replace(/xruns: \d+/, 'xruns: ' + xrunCount);
        }
      } else if (msg.command === 'latency') {
        const ms = msg.measuredMs;
        if (latencyEl) latencyEl.textContent = 'latency: ' + (ms ? ms.toFixed(1) + ' ms' : '—');
      } else if (msg.command === 'led') {
        document.querySelectorAll('.vled-dot[data-pin="' + msg.gpioPin + '"]').forEach(dot => {
          dot.classList.toggle('vled-lit', !!msg.lit);
        });
      } else if (msg.command === 'spectrum') {
        lastSpecIn  = msg.in_fft  || [];
        lastSpecOut = msg.out_fft || [];
        lastBinHz   = msg.binHz   || 0;
        specCanvas.width = specCanvas.clientWidth;
        specCanvas.height = specCanvas.clientHeight;
        drawSpectrum();
      } else if (msg.command === 'recordingState') {
        setRecordingState(!!msg.recording, !!msg.replaying, msg.fileName);
      } else if (msg.command === 'replayDone') {
        setRecordingState(false, false, null);
      } else if (msg.command === 'editorLoad') {
        editorLoad(msg.cfg || {});
      }
    });

    // ── Audio transport buttons (T19-2) ─────────────────────────────────
    btnAudioStart?.addEventListener('click', () => {
      vscode.postMessage({ command: 'startAudio' });
      if (btnAudioStart) btnAudioStart.disabled = true;
      if (btnAudioStop)  btnAudioStop.disabled  = false;
      updateCeEmulatorState(true);
    });
    btnAudioStop?.addEventListener('click', () => {
      vscode.postMessage({ command: 'stopAudio' });
      if (btnAudioStart) btnAudioStart.disabled = false;
      if (btnAudioStop)  btnAudioStop.disabled  = true;
      updateCeEmulatorState(false);
    });

    // ── Recording bar (M14) ──────────────────────────────────────────────
    const recStartBtn   = document.getElementById('rec-start-btn');
    const recStopBtn    = document.getElementById('rec-stop-btn');
    const replayBtn     = document.getElementById('replay-start-btn');
    const recFilenameEl = document.getElementById('rec-filename');

    let isRecording = false;
    let isReplaying = false;

    function setRecordingState(recording, replaying, fileName) {
      isRecording = recording;
      isReplaying = replaying;
      recStartBtn.disabled  = recording || replaying;
      recStopBtn.disabled   = !recording;
      replayBtn.disabled    = recording || replaying;
      recStartBtn.classList.toggle('recording', recording);
      replayBtn.classList.toggle('replaying', replaying);
      if (fileName != null) recFilenameEl.textContent = fileName || '';
    }

    recStartBtn.addEventListener('click', () => {
      if (isRecording || isReplaying) return;
      vscode.postMessage({ command: 'recordStart' });
    });
    recStopBtn.addEventListener('click', () => {
      if (!isRecording) return;
      vscode.postMessage({ command: 'recordStop' });
    });
    replayBtn.addEventListener('click', () => {
      if (isRecording || isReplaying) return;
      vscode.postMessage({ command: 'replayStart' });
    });

    // ── M17: Controls Editor convention logic (D19: single-mode handle UX) ─
    const _yamlInitEl = document.getElementById('yaml-init');
    const _yamlInit = JSON.parse(_yamlInitEl ? _yamlInitEl.textContent || '{}' : '{}');
    let _yamlCfg = { pots: _yamlInit.pots || [], buttons: _yamlInit.buttons || [], leds: _yamlInit.leds || [], errors: [] };

    let conventionControls = [];
    let conventionPlacements = [];
    let conventionMissing = true;
    let ceEmulatorRunning = false;

    function applyControlsConfig(msg) {
      conventionControls = msg.controls || [];
      conventionPlacements = msg.placements || [];
      conventionMissing = !!msg.missingBlock;
      const banner = document.getElementById('convention-banner');
      if (banner) banner.style.display = conventionMissing ? 'flex' : 'none';
      const palette = document.getElementById('palette');
      if (palette) palette.style.display = conventionMissing ? 'flex' : 'none';
      if (!conventionMissing) {
        renderConventionCanvas();
      }
    }

    function updateCeEmulatorState(running) {
      ceEmulatorRunning = running;
      const ceStatusEl = document.getElementById('ce-emu-status');
      if (ceStatusEl) {
        ceStatusEl.textContent = running ? '▶ Running' : '■ Stopped';
        ceStatusEl.className = running ? 'ce-emu-running' : 'ce-emu-stopped';
      }
      document.querySelectorAll('#canvas-area .ctrl-body').forEach(body => {
        body.classList.toggle('body-disabled', !running);
      });
    }

    function renderConventionCanvas() {
      const area = document.getElementById('canvas-area');
      const hint = document.getElementById('canvas-hint');
      if (!area) return;
      area.querySelectorAll('.ctrl-card').forEach(c => c.remove());
      const placementMap = {};
      for (const p of conventionPlacements) placementMap[p.id] = p.pos;
      const conventionIds = new Set(conventionControls.map(c => c.id));
      let ax = 20, ay = 20;
      function nextPos() { const p = [ax, ay]; ax += 190; if (ax > 580) { ax = 20; ay += 170; } return p; }
      for (const ctrl of conventionControls) {
        const pos = placementMap[ctrl.id] || nextPos();
        area.appendChild(buildConventionCard(ctrl, pos));
      }
      for (const pl of conventionPlacements) {
        if (!conventionIds.has(pl.id)) area.appendChild(buildNotInCodeCard(pl));
      }
      if (hint) hint.style.display = (conventionControls.length === 0 && conventionPlacements.length === 0) ? 'flex' : 'none';
      updateCeEmulatorState(ceEmulatorRunning);
    }

    // ── T20-2: Rotary knob helpers ────────────────────────────────────────
    function buildKnobSvg(value) {
      const sz = 52, cx = 26, cy = 26, trackR = 20, dotR2 = 14;
      const startDeg = -225, rangeDeg = 270;
      const toRad = d => d * Math.PI / 180;
      const cv = Math.max(0, Math.min(1, value));
      const fmt = n => n.toFixed(2);
      const svgAng = toRad(startDeg + cv * rangeDeg);
      const x0 = cx + trackR * Math.cos(toRad(startDeg));
      const y0 = cy + trackR * Math.sin(toRad(startDeg));
      const x1 = cx + trackR * Math.cos(toRad(startDeg + rangeDeg));
      const y1 = cy + trackR * Math.sin(toRad(startDeg + rangeDeg));
      const xa = cx + trackR * Math.cos(svgAng);
      const ya = cy + trackR * Math.sin(svgAng);
      const dx = cx + dotR2 * Math.cos(svgAng);
      const dy = cy + dotR2 * Math.sin(svgAng);
      const span = cv * rangeDeg;
      const la = span > 180 ? 1 : 0;
      const trackPath = 'M ' + fmt(x0) + ' ' + fmt(y0) + ' A ' + trackR + ' ' + trackR + ' 0 1 1 ' + fmt(x1) + ' ' + fmt(y1);
      const valPath = span > 0.1 ? 'M ' + fmt(x0) + ' ' + fmt(y0) + ' A ' + trackR + ' ' + trackR + ' 0 ' + la + ' 1 ' + fmt(xa) + ' ' + fmt(ya) : 'M 0 0';
      return '<svg class="knob-svg" viewBox="0 0 ' + sz + ' ' + sz + '" width="' + sz + '" height="' + sz + '">' +
        '<circle cx="' + cx + '" cy="' + cy + '" r="18" fill="#1e1e1e" stroke="#3c3c3c" stroke-width="1.5"/>' +
        '<path d="' + trackPath + '" fill="none" stroke="#3c3c3c" stroke-width="3" stroke-linecap="round"/>' +
        '<path class="knob-value-path" d="' + valPath + '" fill="none" stroke="#4ec9b0" stroke-width="3" stroke-linecap="round"' + (span <= 0.1 ? ' style="display:none"' : '') + '/>' +
        '<circle class="knob-dot" cx="' + fmt(dx) + '" cy="' + fmt(dy) + '" r="2.5" fill="#4ec9b0"/>' +
        '</svg>';
    }

    function updateKnobPaths(knobWrap, value) {
      const cv = Math.max(0, Math.min(1, value));
      const cx = 26, cy = 26, trackR = 20, dotR2 = 14;
      const startDeg = -225, rangeDeg = 270;
      const toRad = d => d * Math.PI / 180;
      const svgAng = toRad(startDeg + cv * rangeDeg);
      const x0 = cx + trackR * Math.cos(toRad(startDeg));
      const y0 = cy + trackR * Math.sin(toRad(startDeg));
      const xa = cx + trackR * Math.cos(svgAng);
      const ya = cy + trackR * Math.sin(svgAng);
      const dx = cx + dotR2 * Math.cos(svgAng);
      const dy = cy + dotR2 * Math.sin(svgAng);
      const span = cv * rangeDeg;
      const la = span > 180 ? 1 : 0;
      const fmt = n => n.toFixed(2);
      const vp = knobWrap.querySelector('.knob-value-path');
      if (vp) {
        if (span > 0.1) {
          vp.setAttribute('d', 'M ' + fmt(x0) + ' ' + fmt(y0) + ' A ' + trackR + ' ' + trackR + ' 0 ' + la + ' 1 ' + fmt(xa) + ' ' + fmt(ya));
          vp.style.display = '';
        } else {
          vp.style.display = 'none';
        }
      }
      const dot = knobWrap.querySelector('.knob-dot');
      if (dot) { dot.setAttribute('cx', fmt(dx)); dot.setAttribute('cy', fmt(dy)); }
      const valEl = knobWrap.querySelector('.knob-value');
      if (valEl) valEl.textContent = cv.toFixed(3);
      return cv;
    }

    function buildConventionCard(ctrl, pos) {
      const kindLabel = ctrl.kind === 'pot' ? 'Pot' : ctrl.kind === 'button' ? 'Button' : 'LED';
      const card = document.createElement('div');
      card.className = 'ctrl-card';
      card.dataset.kind = ctrl.kind;
      card.dataset.id = ctrl.id;
      card.style.left = pos[0] + 'px';
      card.style.top = pos[1] + 'px';

      let bodyInnerHtml = '';
      let adcCh = 0;
      if (ctrl.kind === 'pot') {
        adcCh = adcChannelFromPin(ctrl.pin);
        bodyInnerHtml =
          '<div class="knob-wrap" data-channel="' + adcCh + '" data-value="0">' +
            buildKnobSvg(0) +
            '<span class="knob-value">0.000</span>' +
          '</div>';
      } else if (ctrl.kind === 'button') {
        bodyInnerHtml =
          '<button class="btn-ce" type="button" data-pin="' + ctrl.pin + '" aria-pressed="false">' + escJ(ctrl.id) + '</button>';
      } else {
        bodyInnerHtml =
          '<span class="vled-dot" data-pin="' + ctrl.pin + '"></span>' +
          '<span class="vled-label">' + escJ(ctrl.id) + '</span>';
      }

      card.innerHTML =
        '<div class="ctrl-handle">' +
          '<span class="handle-glyph">&#x283F;</span>' +
          '<span class="card-kind">' + kindLabel + '</span>' +
          '<span class="card-id-label">' + escJ(ctrl.id) + '</span>' +
          '<span class="card-pin-label">pin ' + ctrl.pin + '</span>' +
        '</div>' +
        '<div class="ctrl-body' + (ceEmulatorRunning ? '' : ' body-disabled') + '">' +
          bodyInnerHtml +
        '</div>';

      if (ctrl.kind === 'pot') {
        const knobWrap = card.querySelector('.knob-wrap');
        let kDrag = false, kStartY = 0, kStartVal = 0;
        knobWrap.addEventListener('mousedown', e => {
          kDrag = true;
          kStartY = e.clientY;
          kStartVal = parseFloat(knobWrap.dataset.value || '0');
          e.preventDefault();
        });
        const onKnobMove = e => {
          if (!kDrag) return;
          const delta = (kStartY - e.clientY) / 100;
          const newVal = updateKnobPaths(knobWrap, kStartVal + delta);
          knobWrap.dataset.value = String(newVal);
          vscode.postMessage({ command: 'pot', channel: adcCh, value: newVal });
        };
        const onKnobUp = () => { kDrag = false; };
        document.addEventListener('mousemove', onKnobMove);
        document.addEventListener('mouseup', onKnobUp);
      } else if (ctrl.kind === 'button') {
        const btn     = card.querySelector('.btn-ce');
        const gpioPin = ctrl.pin;
        const press   = () => { btn.setAttribute('aria-pressed', 'true');  vscode.postMessage({ command: 'button', gpioPin, pressed: true }); };
        const release = () => { btn.setAttribute('aria-pressed', 'false'); vscode.postMessage({ command: 'button', gpioPin, pressed: false }); };
        btn.addEventListener('mousedown', press);
        btn.addEventListener('mouseup',   release);
        btn.addEventListener('mouseleave', () => { if (btn.getAttribute('aria-pressed') === 'true') release(); });
      }

      makeDraggable(card, { pos: [pos[0], pos[1]] });
      return card;
    }

    function buildNotInCodeCard(pl) {
      const card = document.createElement('div');
      card.className = 'ctrl-card not-in-code-card';
      card.dataset.id = pl.id;
      card.style.left = pl.pos[0] + 'px';
      card.style.top = pl.pos[1] + 'px';
      card.style.opacity = '0.4';
      card.innerHTML =
        '<div class="card-header"><span class="card-kind" style="color:#f48771">not in code</span></div>' +
        '<div class="card-body"><div class="card-field"><label>id</label><span class="card-val">' + escJ(pl.id) + '</span></div></div>';
      return card;
    }

    function adcChannelFromPin(pin) {
      return (pin >= 15 && pin <= 26) ? pin - 15 : 0;
    }


    // ── Controller Editor (M10b) ──────────────────────────────────────────
    let editorControls = [];
    let nextCtrlIdx = 0;

    function escJ(s) {
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function switchTab(tab) {
      const scopeEl  = document.getElementById('scope-content');
      const editorEl = document.getElementById('editor-wrap');
      const sBtn = document.getElementById('tab-scope-btn');
      const eBtn = document.getElementById('tab-editor-btn');
      if (tab === 'editor') {
        scopeEl.style.display  = 'none';
        editorEl.style.display = 'flex';
        sBtn.classList.remove('tab-active');
        eBtn.classList.add('tab-active');
        updateCeEmulatorState(ceEmulatorRunning);
      } else {
        scopeEl.style.display  = 'flex';
        editorEl.style.display = 'none';
        sBtn.classList.add('tab-active');
        eBtn.classList.remove('tab-active');
        resize();
      }
    }

    document.getElementById('tab-scope-btn').addEventListener('click',  () => switchTab('scope'));
    document.getElementById('tab-editor-btn').addEventListener('click', () => switchTab('editor'));

    function editorLoad(cfg) {
      _yamlCfg = { pots: cfg.pots || [], buttons: cfg.buttons || [], leds: cfg.leds || [], errors: [] };
      editorControls = [];
      let ax = 20, ay = 20;
      function nextPos() { const p = [ax, ay]; ax += 190; if (ax > 580) { ax = 20; ay += 170; } return p; }
      for (const p of (cfg.pots   || [])) editorControls.push({ kind:'pot',    id:p.id, label:p.label, adcChannel:p.adcChannel, range:p.range||[0,1], taper:p.taper||'linear', def:p.default??0.5, gpioPin:null, mode:null, activeLevel:null, pos:p.pos||nextPos() });
      for (const b of (cfg.buttons|| [])) editorControls.push({ kind:'button', id:b.id, label:b.label, adcChannel:null, range:null, taper:null, def:null, gpioPin:b.gpioPin??0, mode:b.mode||'momentary', activeLevel:b.activeLevel||'low', pos:b.pos||nextPos() });
      for (const l of (cfg.leds   || [])) editorControls.push({ kind:'led',    id:l.id, label:l.label, adcChannel:null, range:null, taper:null, def:null, gpioPin:l.gpioPin??0, mode:null, activeLevel:null, pos:l.pos||nextPos() });
      nextCtrlIdx = Math.max(editorControls.length, nextCtrlIdx);
      renderCanvas();
      switchTab('editor');
    }

    function renderCanvas() {
      const area = document.getElementById('canvas-area');
      const hint = document.getElementById('canvas-hint');
      area.innerHTML = '';
      if (hint) area.appendChild(hint);
      hint && (hint.style.display = editorControls.length ? 'none' : 'flex');
      for (const ctrl of editorControls) area.appendChild(buildCard(ctrl));
    }

    function buildCard(ctrl) {
      const kindLabel = ctrl.kind === 'pot' ? 'Pot' : ctrl.kind === 'button' ? 'Button' : 'LED';
      const pinOpts = [...Array(32).keys()].map(i => '<option value="'+i+'"'+(ctrl.gpioPin===i?' selected':'')+'>pin '+i+'</option>').join('');
      const chOpts  = [...Array(12).keys()].map(i => '<option value="'+i+'"'+(ctrl.adcChannel===i?' selected':'')+'>ch '+i+'</option>').join('');
      const taperOpts = ['linear','log','antilog'].map(t => '<option value="'+t+'"'+(ctrl.taper===t?' selected':'')+'>'+t+'</option>').join('');
      const modeOpts  = ['momentary','toggle'].map(m => '<option value="'+m+'"'+(ctrl.mode===m?' selected':'')+'>'+m+'</option>').join('');

      const card = document.createElement('div');
      card.className = 'ctrl-card';
      card.dataset.kind = ctrl.kind;
      card.style.left = ctrl.pos[0] + 'px';
      card.style.top  = ctrl.pos[1] + 'px';
      card.innerHTML =
        '<div class="card-header">' +
          '<span class="card-kind">'+kindLabel+'</span>' +
          '<button class="card-del" title="Remove">×</button>' +
        '</div>' +
        '<div class="card-body">' +
          '<div class="card-field"><label>ID</label><input class="card-inp card-id" value="'+escJ(ctrl.id)+'"/></div>' +
          '<div class="card-field"><label>Label</label><input class="card-inp card-lbl" value="'+escJ(ctrl.label)+'"/></div>' +
          (ctrl.kind === 'pot'
            ? '<div class="card-field"><label>ADC ch</label><select class="card-sel card-ch">'+chOpts+'</select></div>' +
              '<div class="card-field"><label>Taper</label><select class="card-sel card-taper">'+taperOpts+'</select></div>' +
              '<div class="card-field"><label>Default</label><input class="card-inp card-def" type="number" min="0" max="1" step="0.01" value="'+ctrl.def+'"/></div>'
            : '<div class="card-field"><label>GPIO pin</label><select class="card-sel card-pin">'+pinOpts+'</select></div>' +
              (ctrl.kind === 'button' ? '<div class="card-field"><label>Mode</label><select class="card-sel card-mode">'+modeOpts+'</select></div>' : '')) +
        '</div>';

      card.querySelector('.card-del').addEventListener('click', () => {
        editorControls = editorControls.filter(c => c !== ctrl);
        card.remove();
        const hint = document.getElementById('canvas-hint');
        if (hint) hint.style.display = editorControls.length ? 'none' : 'flex';
      });
      card.querySelector('.card-id').addEventListener('input',  e => { ctrl.id    = e.target.value; });
      card.querySelector('.card-lbl').addEventListener('input', e => { ctrl.label = e.target.value; });
      if (ctrl.kind === 'pot') {
        card.querySelector('.card-ch').addEventListener('change',    e => { ctrl.adcChannel = parseInt(e.target.value, 10); });
        card.querySelector('.card-taper').addEventListener('change', e => { ctrl.taper = e.target.value; });
        card.querySelector('.card-def').addEventListener('change',   e => { ctrl.def = parseFloat(e.target.value); });
      } else {
        card.querySelector('.card-pin').addEventListener('change', e => { ctrl.gpioPin = parseInt(e.target.value, 10); });
        if (ctrl.kind === 'button') card.querySelector('.card-mode').addEventListener('change', e => { ctrl.mode = e.target.value; });
      }
      makeDraggable(card, ctrl);
      return card;
    }

    function makeDraggable(card, ctrl) {
      const header = card.querySelector('.ctrl-handle') || card.querySelector('.card-header');
      if (!header) return;
      let drag = false, sx, sy, sl, st;
      header.addEventListener('mousedown', e => {
        if (e.target.closest('.card-del')) return;
        drag = true; sx = e.clientX; sy = e.clientY;
        sl = parseInt(card.style.left,10)||0; st = parseInt(card.style.top,10)||0;
        e.preventDefault();
      });
      document.addEventListener('mousemove', e => {
        if (!drag) return;
        const nx = Math.max(0, sl + e.clientX - sx);
        const ny = Math.max(0, st + e.clientY - sy);
        card.style.left = nx + 'px'; card.style.top = ny + 'px';
        ctrl.pos = [nx, ny];
      });
      document.addEventListener('mouseup', () => { drag = false; });
    }

    // Palette → canvas drop
    document.querySelectorAll('.palette-item').forEach(item => {
      item.addEventListener('dragstart', e => e.dataTransfer.setData('text/plain', item.dataset.kind));
    });
    const canvasArea = document.getElementById('canvas-area');
    canvasArea.addEventListener('dragover', e => e.preventDefault());
    canvasArea.addEventListener('drop', e => {
      e.preventDefault();
      const kind = e.dataTransfer.getData('text/plain');
      if (!['pot','button','led'].includes(kind)) return;
      const rect = canvasArea.getBoundingClientRect();
      const x = Math.max(0, e.clientX - rect.left);
      const y = Math.max(0, e.clientY - rect.top);
      nextCtrlIdx++;
      const ctrl = {
        kind, pos: [x, y],
        id: kind + '_' + nextCtrlIdx,
        label: (kind==='pot'?'Pot':kind==='button'?'Button':'LED') + ' ' + nextCtrlIdx,
        adcChannel: kind==='pot'?0:null, range:kind==='pot'?[0,1]:null,
        taper:kind==='pot'?'linear':null, def:kind==='pot'?0.5:null,
        gpioPin:kind!=='pot'?0:null, mode:kind==='button'?'momentary':null,
        activeLevel:kind==='button'?'low':null,
      };
      editorControls.push(ctrl);
      canvasArea.appendChild(buildCard(ctrl));
      const hint = document.getElementById('canvas-hint');
      if (hint) hint.style.display = 'none';
    });

    // Signal extension host that JS is ready — allows pending controlsConfig to be flushed
    vscode.postMessage({ command: 'webviewReady' });

    // Save
    document.getElementById('save-btn').addEventListener('click', () => {
      let cfg;
      if (!conventionMissing) {
        // Convention mode: update only positions from current DOM card positions
        const domPos = {};
        document.querySelectorAll('#canvas-area .ctrl-card[data-id]').forEach(c => {
          domPos[c.dataset.id] = [parseInt(c.style.left,10)||0, parseInt(c.style.top,10)||0];
        });
        const updatedPots    = _yamlCfg.pots.map(p => ({ ...p, pos: domPos[p.id] || p.pos }));
        const updatedButtons = _yamlCfg.buttons.map(b => ({ ...b, pos: domPos[b.id] || b.pos }));
        const updatedLeds    = _yamlCfg.leds.map(l => ({ ...l, pos: domPos[l.id] || l.pos }));
        cfg = { pots: updatedPots, buttons: updatedButtons, leds: updatedLeds, errors: [] };
      } else {
        const pots    = editorControls.filter(c=>c.kind==='pot').map(c=>({ id:c.id, label:c.label, adcChannel:c.adcChannel??0, range:c.range||[0,1], taper:c.taper||'linear', default:c.def??0.5, errors:[], pos:c.pos }));
        const buttons = editorControls.filter(c=>c.kind==='button').map(c=>({ id:c.id, label:c.label, gpioPin:c.gpioPin??0, mode:c.mode||'momentary', activeLevel:c.activeLevel||'low', pos:c.pos }));
        const leds    = editorControls.filter(c=>c.kind==='led').map(c=>({ id:c.id, label:c.label, gpioPin:c.gpioPin??0, pos:c.pos }));
        cfg = { pots, buttons, leds, errors: [] };
      }
      vscode.postMessage({ command:'editorSave', cfg });
      const st = document.getElementById('save-status');
      st.textContent = 'Saved ✓';
      setTimeout(()=>{ st.textContent=''; }, 2000);
    });
  </script>
</body>
</html>`;
}
