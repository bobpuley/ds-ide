import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { EmulatorManager } from '../emulator/manager';
import { IpcMessage } from '../emulator/ipc-client';
import { startAudio, stopAudio } from '../commands/transport';
import { getBoolean, getNumber } from '../ipc/narrow';
import { ScopeWebviewMessage } from './messages';
import { hasKnownCommand, assertNever } from './message-guard';
import { themeCss } from './theme/theme-css';
import { TIME_BASES_MS, DEFAULT_TIME_BASE_MS } from './scope/scope-view';

// FR-EXT-33: see controls-editor-panel.ts's identical comment — the
// switch's `default: assertNever(...)` is the actual drift-detector; this
// Set only drives the runtime hasKnownCommand narrow.
const SCOPE_WEBVIEW_COMMANDS = new Set<ScopeWebviewMessage['command']>([
  'webviewReady', 'sine', 'audioSource', 'pickWav', 'startAudio', 'stopAudio',
  'recordStart', 'recordStop', 'replayStart', 'outputVolume',
]);

export interface ControlsPlacement {
  id: string;
  pos: [number, number];
}

export interface ControlsConfig {
  controls: import('../controllers/controls-convention-parser').ConventionControl[];
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

export type SineChangeHandler = (freq: number, amplitude: number) => void;
export type AudioSourceChangeHandler = (source: AudioSource) => void;
export type PickWavHandler = () => void;
export type RecordStartHandler = () => void;
export type RecordStopHandler = () => void;
export type ReplayStartHandler = () => void;
export type OutputVolumeHandler = (volume: number) => void;
export type StopAudioHandler = () => void;

export class ScopePanel {
  private panel: vscode.WebviewPanel | null = null;
  private sineParams: SineParams = { ...SINE_DEFAULTS };
  private audioSource: AudioSource = { ...AUDIO_SOURCE_DEFAULTS };
  private msgDisposable: vscode.Disposable | null = null;
  private lastStatusMsg: IpcMessage | null = null;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly manager: EmulatorManager,
    private readonly onSineChange?: SineChangeHandler,
    private readonly onAudioSourceChange?: AudioSourceChangeHandler,
    private readonly onPickWav?: PickWavHandler,
    private readonly onRecordStart?: RecordStartHandler,
    private readonly onRecordStop?: RecordStopHandler,
    private readonly onReplayStart?: ReplayStartHandler,
    private readonly onOutputVolume?: OutputVolumeHandler,
    private readonly onStopAudio?: StopAudioHandler,
  ) {
    manager.on('message', this._onManagerMessage);
  }

  private readonly _onManagerMessage = (msg: IpcMessage): void => {
    if (msg['type'] === 'scope') this.postScope(msg);
    if (msg['type'] === 'status') { this.lastStatusMsg = msg; this.postStatus(msg); }
    if (msg['type'] === 'event') this.postEvent(msg);
    if (msg['type'] === 'xrun') this.postXrun(msg);
    if (msg['type'] === 'latency') this.postLatency(msg);
    if (msg['type'] === 'led') this.postLed(msg);
    if (msg['type'] === 'spectrum') this.postSpectrum(msg);
    if (msg['type'] === 'replayDone') this.postReplayDone();
  };

  show(
    sineParams: SineParams = { ...SINE_DEFAULTS },
    audioSource: AudioSource = { ...AUDIO_SOURCE_DEFAULTS },
  ): void {
    this.sineParams = sineParams;
    this.audioSource = audioSource;

    if (this.panel) {
      // Reveal only — reassigning webview.html would reload the page and
      // discard the scope/spectrum trace history already drawn there
      // (FR-QA-EXT-7). Post current state instead, the same way a freshly
      // loaded webview catches up via the 'webviewReady' handshake below.
      this.panel.reveal(vscode.ViewColumn.Two);
      if (this.lastStatusMsg) this.postStatus(this.lastStatusMsg);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      PANEL_ID,
      PANEL_TITLE,
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')],
      },
    );
    this.panel.webview.html = this.html();

    this.msgDisposable = this.panel.webview.onDidReceiveMessage((raw: unknown) => {
      if (!hasKnownCommand<ScopeWebviewMessage>(raw, SCOPE_WEBVIEW_COMMANDS)) return;
      const msg = raw;
      switch (msg.command) {
        case 'webviewReady': {
          if (this.lastStatusMsg) this.postStatus(this.lastStatusMsg);
          break;
        }
        case 'sine': {
          const { freq, amplitude } = msg;
          if (typeof freq === 'number' && typeof amplitude === 'number') {
            this.sineParams = { freq, amplitude };
            this.manager.sendSine(freq, amplitude);
            this.onSineChange?.(freq, amplitude);
          }
          break;
        }
        case 'audioSource': {
          const inputRaw = msg.input;
          const input: AudioInputSource | undefined =
            inputRaw === 'sine' || inputRaw === 'live' || inputRaw === 'wav' ? inputRaw : undefined;
          const sampleRate = typeof msg.sampleRate === 'number' ? msg.sampleRate : undefined;
          const bufferSize = typeof msg.bufferSize === 'number' ? msg.bufferSize : undefined;
          const validSampleRates = [8000, 22050, 44100, 48000];
          const validBufferSizes = [64, 128, 256, 512];
          if (
            input && sampleRate && bufferSize &&
            validSampleRates.includes(sampleRate) &&
            validBufferSizes.includes(bufferSize)
          ) {
            this.audioSource = {
              ...this.audioSource,
              input,
              sampleRate,
              bufferSize,
              wavLoop: msg.wavLoop === true,
            };
            this.onAudioSourceChange?.(this.audioSource);
          }
          break;
        }
        case 'pickWav': {
          this.onPickWav?.();
          break;
        }
        case 'startAudio': {
          startAudio(this.manager);
          break;
        }
        case 'stopAudio': {
          stopAudio(this.manager);
          this._synthesizeStopped();
          this.onStopAudio?.();
          break;
        }
        case 'recordStart': {
          this.onRecordStart?.();
          break;
        }
        case 'recordStop': {
          this.onRecordStop?.();
          break;
        }
        case 'replayStart': {
          this.onReplayStart?.();
          break;
        }
        case 'outputVolume': {
          const vol = typeof msg.volume === 'number' ? msg.volume : undefined;
          if (vol !== undefined && vol >= 0 && vol <= 1) {
            this.manager.sendOutputVolume(vol);
            this.onOutputVolume?.(vol);
          }
          break;
        }
        default:
          assertNever(msg, 'ScopePanel');
      }
    });

    this.panel.onDidDispose(() => {
      this.msgDisposable?.dispose();
      this.msgDisposable = null;
      this.panel = null;
    });
  }

  notifyWavSelected(fileName: string, wavPath: string): void {
    this.audioSource = { ...this.audioSource, input: 'wav', wavPath };
    this.panel?.webview.postMessage({ command: 'wavSelected', name: fileName });
  }

  dispose(): void {
    this.manager.off('message', this._onManagerMessage);
    this.msgDisposable?.dispose();
    this.msgDisposable = null;
    this.panel?.dispose();
    this.panel = null;
  }

  private postScope(msg: IpcMessage): void {
    // out_r / step were validated by the IPC narrower (FR-SCI-2); absent on older emulators.
    this.panel?.webview.postMessage({
      command: 'scope', in: msg['in'], out: msg['out'],
      ...(msg['out_r'] !== undefined && { out_r: msg['out_r'] }),
      ...(msg['step'] !== undefined && { step: msg['step'] }),
    });
  }

  // Only whitelisted, type-checked fields are forwarded — msg originates from
  // the emulator's IPC socket and must never be spread verbatim into a
  // webview postMessage (FR-IPC-2).
  private postStatus(msg: IpcMessage): void {
    this.panel?.webview.postMessage({
      command: 'status',
      running: getBoolean(msg, 'running') ?? false,
      sampleRate: getNumber(msg, 'sampleRate'),
      blockSize: getNumber(msg, 'blockSize'),
    });
  }

  private postEvent(msg: IpcMessage): void {
    this.panel?.webview.postMessage({ command: 'event', kind: msg['kind'] });
  }

  private postXrun(msg: IpcMessage): void {
    this.panel?.webview.postMessage({ command: 'xrun', count: msg['count'] });
  }

  private postLatency(msg: IpcMessage): void {
    this.panel?.webview.postMessage({ command: 'latency', estimatedMs: msg['estimatedMs'] });
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

  notifyStopped(): void {
    this._synthesizeStopped();
  }

  private _synthesizeStopped(): void {
    const stopped: IpcMessage = { ...(this.lastStatusMsg ?? {}), type: 'status', running: false };
    this.lastStatusMsg = stopped;
    this.postStatus(stopped);
  }

  notifyRecordingState(recording: boolean, replaying: boolean, fileName?: string): void {
    this.panel?.webview.postMessage({ command: 'recordingState', recording, replaying, fileName });
  }

  private html(): string {
    const nonce = randomBytes(16).toString('base64');
    const scriptUri = this.panel!.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'scope-webview.js'),
    ).toString();
    return buildHtml(nonce, scriptUri, this.sineParams, this.audioSource);
  }
}

function buildEmulatorBarHtml(source: AudioSource, sine: SineParams): string {
  const freq      = Number(sine.freq)        || SINE_DEFAULTS.freq;
  const amplitude = Number(sine.amplitude)   || SINE_DEFAULTS.amplitude;
  const bufferSize = Number(source.bufferSize) || AUDIO_SOURCE_DEFAULTS.bufferSize;
  const wavLoop   = !!source.wavLoop;

  const isSine = source.input === 'sine';
  const isLive = source.input === 'live';
  const isWav  = source.input === 'wav';
  const bufSizes = [64, 128, 256, 512];
  const bufOptions = bufSizes.map(s =>
    `<option value="${s}" ${s === bufferSize ? 'selected' : ''}>${s}</option>`
  ).join('');
  const wavName = source.wavPath ? baseName(source.wavPath) : '';
  const srcOptions = [
    `<option value="sine" ${isSine ? 'selected' : ''}>Sine</option>`,
    `<option value="live" ${isLive ? 'selected' : ''}>Live (mic)</option>`,
    `<option value="wav" ${isWav  ? 'selected' : ''}>WAV</option>`,
  ].join('');
  return `<div id="emulator-bar">
    <span class="emu-label">Input:</span>
    <select id="audio-source-select">${srcOptions}</select>
    <span class="emu-sep">|</span>
    <span id="sine-group" class="emu-group ${isSine ? '' : 'emu-hidden'}">
      <label class="emu-field">Freq <input type="number" id="sine-freq" min="20" max="20000" step="1" value="${freq}"/> Hz</label>
      <label class="emu-field">Amp <input type="range" id="sine-amp" min="0" max="1" step="0.01" value="${amplitude}"/>
        <span id="sine-amp-val">${amplitude.toFixed(2)}</span></label>
    </span>
    <span id="wav-group" class="emu-group ${isWav ? '' : 'emu-hidden'}">
      <button id="wav-choose" type="button" class="emu-btn">Choose WAV…</button>
      <span id="wav-name" class="wav-name">${wavName ? escHtml(wavName) : 'no file'}</span>
      <label class="emu-field"><input type="checkbox" id="wav-loop" ${wavLoop ? 'checked' : ''}/> Loop</label>
    </span>
    <span id="buffer-group" class="emu-group ${isLive || isWav ? '' : 'emu-hidden'}">
      <label class="emu-field">Buffer <select id="buffer-size">${bufOptions}</select> samples</label>
    </span>
    <span id="latency-group" class="emu-group ${isLive ? '' : 'emu-hidden'}">
      <span id="latency-display" class="latency-text">latency: —</span>
    </span>
    <span class="emu-rec-sep">|</span>
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

function buildHtml(nonce: string, scriptUri: string, sine: SineParams, source: AudioSource): string {
  const audioSourceHtml = buildEmulatorBarHtml(source, sine);
  const timeBaseOptions = TIME_BASES_MS.map(ms =>
    `<option value="${ms}"${ms === DEFAULT_TIME_BASE_MS ? ' selected' : ''}>${ms} ms/div</option>`,
  ).join('');
  return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Daisy Scope</title>
  <style>
${themeCss({ surface: 'editor' })}
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: var(--ds-surface); color: var(--ds-text); font-family: monospace; font-size: 12px; display: flex; flex-direction: column; height: 100vh; border: 1px solid var(--ds-border); }
    header { padding: 6px 12px; background: var(--ds-surface-raised); display: flex; align-items: center; gap: 16px; border-bottom: 1px solid var(--ds-border); flex-wrap: wrap; flex-shrink: 0; }
    #fidelity-caveat { font-size: 10px; color: var(--ds-text-muted); cursor: default; margin-left: auto; }
    #status-text { flex: 1; }
    .legend { display: flex; gap: 12px; }
    .legend span { display: flex; align-items: center; gap: 4px; }
    .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
    .dot-in  { background: var(--ds-trace-in); }
    .dot-out { background: var(--ds-trace-out); }
    #vol-group { display: flex; align-items: center; gap: 6px; }
    #vol-label { color: var(--ds-text-muted); font-size: 11px; }
    #output-vol { width: 80px; cursor: pointer; accent-color: var(--ds-trace-in); }
    #vol-val { min-width: 30px; color: var(--ds-text); font-size: 11px; }
    #events { padding: 3px 12px; min-height: 22px; background: var(--ds-surface-raised); border-bottom: 1px solid var(--ds-border); font-size: 11px; color: var(--ds-error); flex-shrink: 0; }
    #scope-controls { display: flex; align-items: center; gap: 12px; padding: 4px 12px; background: var(--ds-surface-raised); border-bottom: 1px solid var(--ds-border); flex-shrink: 0; }
    .seg { display: inline-flex; }
    .seg-btn { background: var(--ds-input-bg); color: var(--ds-input-fg); border: 1px solid var(--ds-border); padding: 2px 8px; font-family: monospace; cursor: pointer; margin-left: -1px; }
    .seg-btn:first-child { border-radius: 2px 0 0 2px; margin-left: 0; }
    .seg-btn:last-child { border-radius: 0 2px 2px 0; }
    .seg-btn:hover { background: var(--ds-hover-bg); }
    .seg-btn.active { background: var(--ds-button-bg); color: var(--ds-button-fg); border-color: var(--ds-focus); }
    #rate-note { font-size: 11px; color: var(--ds-text-muted); }
    #rate-note.low-res { color: var(--ds-warning-fg); }
    canvas { display: block; width: 100%; }
    #scope { flex: 1; min-height: 0; }
    #spectrum { height: 140px; border-top: 1px solid var(--ds-border); background: var(--ds-surface); flex-shrink: 0; }
    #emulator-section { background: var(--ds-surface-raised); border-top: 1px solid var(--ds-border); flex-shrink: 0; }
    #emulator-bar { padding: 6px 12px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .emu-label { color: var(--ds-text-muted); }
    #audio-source-select { background: var(--ds-input-bg); color: var(--ds-input-fg); border: 1px solid var(--ds-border); padding: 2px 6px; font-family: monospace; cursor: pointer; border-radius: 2px; }
    .emu-sep { color: var(--ds-border); user-select: none; }
    .emu-rec-sep { color: var(--ds-border); user-select: none; border-left: 1px solid var(--ds-border); height: 14px; margin: 0 4px; }
    .emu-group { display: inline-flex; align-items: center; gap: 6px; }
    .emu-hidden { display: none !important; }
    .emu-field { display: inline-flex; align-items: center; gap: 4px; }
    .emu-field input[type="number"] { width: 64px; background: var(--ds-input-bg); color: var(--ds-input-fg); border: 1px solid var(--ds-border); padding: 2px 4px; font-family: monospace; }
    .emu-field input[type="range"] { width: 90px; cursor: pointer; }
    .emu-field select { background: var(--ds-input-bg); color: var(--ds-input-fg); border: 1px solid var(--ds-border); padding: 2px 4px; font-family: monospace; cursor: pointer; }
    .emu-btn { background: var(--ds-button-bg); color: var(--ds-button-fg); border: 1px solid transparent; padding: 3px 8px; font-family: monospace; cursor: pointer; border-radius: 2px; }
    .emu-btn:hover { background: var(--ds-button-hover-bg); }
    .latency-text { color: var(--ds-text); }
    .wav-name { color: var(--ds-text); font-style: italic; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rec-label { color: var(--ds-text-muted); }
    .rec-btn { background: var(--ds-input-bg); color: var(--ds-input-fg); border: 1px solid var(--ds-border); padding: 3px 10px; font-family: monospace; font-size: 12px; cursor: pointer; border-radius: 2px; }
    .rec-btn:hover { background: var(--ds-hover-bg); }
    .rec-btn:disabled { opacity: 0.4; cursor: default; }
    #rec-start-btn { border-color: var(--ds-error); color: var(--ds-error); }
    #rec-start-btn:hover:not(:disabled) { background: var(--ds-hover-bg); }
    #rec-start-btn.recording { background: var(--ds-error); color: var(--ds-surface); border-color: var(--ds-error); animation: blink 1s step-end infinite; }
    @keyframes blink { 50% { opacity: 0.5; } }
    #replay-start-btn { border-color: var(--ds-ok); color: var(--ds-ok); }
    #replay-start-btn:hover:not(:disabled) { background: var(--ds-hover-bg); }
    #replay-start-btn.replaying { background: var(--ds-ok); color: var(--ds-surface); }
    .rec-filename { color: var(--ds-text); font-style: italic; font-size: 11px; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .audio-btn { background: var(--ds-input-bg); color: var(--ds-input-fg); border: 1px solid var(--ds-border); padding: 3px 8px; font-family: monospace; font-size: 13px; cursor: pointer; border-radius: 2px; }
    .audio-btn:disabled { opacity: 0.35; cursor: default; }
    #btn-audio-start { border-color: var(--ds-ok); color: var(--ds-ok); }
    #btn-audio-start:not(:disabled):hover { background: var(--ds-hover-bg); }
    #btn-audio-stop  { border-color: var(--ds-error); color: var(--ds-error); }
    #btn-audio-stop:not(:disabled):hover  { background: var(--ds-hover-bg); }
    #getting-started { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: var(--ds-text-muted); padding: 32px; text-align: center; }
    #getting-started ol { text-align: left; padding-left: 20px; line-height: 2; }
    #getting-started code { background: var(--ds-input-bg); padding: 1px 4px; border-radius: 2px; color: var(--ds-text); }
  </style>
</head>
<body>
  <header>
    <span id="status-text">Deploy to start…</span>
    <span class="legend">
      <span><span class="dot dot-in"></span>In</span>
      <span><span class="dot dot-out"></span>Out</span>
    </span>
    <span id="vol-group">
      <label id="vol-label" for="output-vol">Vol</label>
      <input type="range" id="output-vol" min="0" max="1" step="0.01" value="1"/>
      <span id="vol-val">1.00</span>
    </span>
    <button class="audio-btn" id="btn-audio-start" title="Start Audio" disabled>&#9654;</button>
    <button class="audio-btn" id="btn-audio-stop"  title="Stop Audio"  disabled>&#9632;</button>
    <span id="fidelity-caveat" title="Emulator approximates the Seed — not bit-exact, does not validate hardware CPU/RAM budget">&#x2139; Approx. Seed</span>
  </header>
  <div id="events"></div>
  <div id="scope-controls" style="display:none">
    <label class="emu-field">Time <select id="timebase">${timeBaseOptions}</select></label>
    <span class="emu-field">Gain
      <span class="seg" id="gain-seg">
        <button type="button" class="seg-btn active" data-gain="1">×1</button><button type="button" class="seg-btn" data-gain="2">×2</button><button type="button" class="seg-btn" data-gain="4">×4</button><button type="button" class="seg-btn" data-gain="auto">Auto</button>
      </span></span>
    <span class="emu-field">Scale
      <span class="seg" id="unit-seg">
        <button type="button" class="seg-btn active" data-unit="lin">Linear</button><button type="button" class="seg-btn" data-unit="db">dBFS</button>
      </span></span>
    <span id="rate-note"></span>
  </div>
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
  <div id="emulator-section">
    ${audioSourceHtml}
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
