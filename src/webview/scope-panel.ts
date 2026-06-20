import * as vscode from 'vscode';
import { EmulatorManager } from '../emulator/manager';
import { IpcMessage } from '../emulator/ipc-client';
import { startAudio, stopAudio } from '../commands/transport';

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

export class ScopePanel {
  private panel: vscode.WebviewPanel | null = null;
  private sineParams: SineParams = { ...SINE_DEFAULTS };
  private audioSource: AudioSource = { ...AUDIO_SOURCE_DEFAULTS };
  private msgDisposable: vscode.Disposable | null = null;
  private lastStatusMsg: IpcMessage | null = null;

  constructor(
    private readonly manager: EmulatorManager,
    private readonly onSineChange?: SineChangeHandler,
    private readonly onAudioSourceChange?: AudioSourceChangeHandler,
    private readonly onPickWav?: PickWavHandler,
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
    sineParams: SineParams = { ...SINE_DEFAULTS },
    audioSource: AudioSource = { ...AUDIO_SOURCE_DEFAULTS },
  ): void {
    this.sineParams = sineParams;
    this.audioSource = audioSource;

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
        if (this.lastStatusMsg) this.postStatus(this.lastStatusMsg);
        return;
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

  notifyRecordingState(recording: boolean, replaying: boolean, fileName?: string): void {
    this.panel?.webview.postMessage({ command: 'recordingState', recording, replaying, fileName });
  }

  private html(): string {
    return buildHtml(this.sineParams, this.audioSource);
  }
}

function buildEmulatorBarHtml(source: AudioSource, sine: SineParams): string {
  const isSine = source.input === 'sine';
  const isLive = source.input === 'live';
  const isWav  = source.input === 'wav';
  const bufSizes = [64, 128, 256, 512];
  const bufOptions = bufSizes.map(s =>
    `<option value="${s}" ${s === source.bufferSize ? 'selected' : ''}>${s}</option>`
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
      <label class="emu-field">Freq <input type="number" id="sine-freq" min="20" max="20000" step="1" value="${sine.freq}"/> Hz</label>
      <label class="emu-field">Amp <input type="range" id="sine-amp" min="0" max="1" step="0.01" value="${sine.amplitude}"/>
        <span id="sine-amp-val">${sine.amplitude.toFixed(2)}</span></label>
    </span>
    <span id="wav-group" class="emu-group ${isWav ? '' : 'emu-hidden'}">
      <button id="wav-choose" type="button" class="emu-btn">Choose WAV…</button>
      <span id="wav-name" class="wav-name">${wavName ? escHtml(wavName) : 'no file'}</span>
      <label class="emu-field"><input type="checkbox" id="wav-loop" ${source.wavLoop ? 'checked' : ''}/> Loop</label>
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

function buildHtml(sine: SineParams, source: AudioSource): string {
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
    #vol-group { display: flex; align-items: center; gap: 6px; }
    #vol-label { color: #9cdcfe; font-size: 11px; }
    #output-vol { width: 80px; cursor: pointer; accent-color: #4ec9b0; }
    #vol-val { min-width: 30px; color: #b5cea8; font-size: 11px; }
    #events { padding: 3px 12px; min-height: 22px; background: #252526; border-bottom: 1px solid #3c3c3c; font-size: 11px; color: #f48771; flex-shrink: 0; }
    canvas { display: block; width: 100%; }
    #scope { flex: 1; min-height: 0; }
    #spectrum { height: 140px; border-top: 1px solid #3c3c3c; background: #1a1a1a; flex-shrink: 0; }
    .coll-section { background: #252526; border-top: 1px solid #3c3c3c; flex-shrink: 0; }
    .coll-header { display: flex; align-items: center; gap: 8px; padding: 5px 12px; cursor: pointer; user-select: none; color: #9cdcfe; font-size: 11px; }
    .coll-header:hover { background: #2a2a2a; }
    .coll-arrow { font-size: 10px; transition: transform 0.15s; }
    .coll-body { overflow: hidden; }
    .coll-body.collapsed { display: none; }
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
    .audio-btn { background: #3c3c3c; color: #d4d4d4; border: 1px solid #555; padding: 3px 8px; font-family: monospace; font-size: 13px; cursor: pointer; border-radius: 2px; }
    .audio-btn:disabled { opacity: 0.35; cursor: default; }
    #btn-audio-start { border-color: #4a7a4a; color: #4ec9b0; }
    #btn-audio-start:not(:disabled):hover { background: #1a3a1a; }
    #btn-audio-stop  { border-color: #7a3a3a; color: #f48771; }
    #btn-audio-stop:not(:disabled):hover  { background: #3a1a1a; }
    #getting-started { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: #6a6a6a; padding: 32px; text-align: center; }
    #getting-started ol { text-align: left; padding-left: 20px; line-height: 2; }
    #getting-started code { background: #3c3c3c; padding: 1px 4px; border-radius: 2px; color: #9cdcfe; }
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
  <div class="coll-section" id="emulator-section">
    <div class="coll-header" id="emulator-header" aria-expanded="false">
      <span class="coll-arrow" id="emulator-arrow" style="transform:rotate(-90deg)">&#9662;</span>
      <span>Emulator</span>
    </div>
    <div class="coll-body collapsed" id="emulator-body">
      ${audioSourceHtml}
    </div>
  </div>
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

    function drawSpectrum() {
      const W = specCanvas.width, H = specCanvas.height;
      specCtx.clearRect(0, 0, W, H);
      specCtx.fillStyle = '#1a1a1a';
      specCtx.fillRect(0, 0, W, H);
      if (!lastSpecIn || lastSpecIn.length < 2) return;
      const N = lastSpecIn.length;
      const maxFreq = Math.min(20000, lastBinHz * N);
      const maxBin  = lastBinHz > 0 ? Math.min(N, Math.ceil(maxFreq / lastBinHz)) : N;
      const peak = Math.max(
        lastSpecIn.slice(0, maxBin).reduce((a, v) => Math.max(a, v), 1e-9),
        lastSpecOut.slice(0, maxBin).reduce((a, v) => Math.max(a, v), 1e-9),
      );
      const LEFT = 36, BOTTOM = 16, TOP = 4;
      const plotW = W - LEFT;
      const plotH = H - BOTTOM - TOP;
      const ampToY = (amp) => TOP + plotH * (1 - amp / peak);
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

    function updateSourceGroups(input) {
      const isSine = input === 'sine';
      const isLive = input === 'live';
      const isWav  = input === 'wav';
      document.getElementById('sine-group')?.classList.toggle('emu-hidden', !isSine);
      document.getElementById('wav-group')?.classList.toggle('emu-hidden', !isWav);
      document.getElementById('buffer-group')?.classList.toggle('emu-hidden', !(isLive || isWav));
      document.getElementById('latency-group')?.classList.toggle('emu-hidden', !isLive);
    }

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
    document.getElementById('audio-source-select')?.addEventListener('change', sendAudioSource);
    bufferSizeEl?.addEventListener('change', sendAudioSource);
    wavChooseEl?.addEventListener('click', () => vscode.postMessage({ command: 'pickWav' }));
    wavLoopEl?.addEventListener('change', sendAudioSource);
    outputVolEl?.addEventListener('input', () => {
      const vol = parseFloat(outputVolEl.value);
      if (volValEl) volValEl.textContent = vol.toFixed(2);
      vscode.postMessage({ command: 'outputVolume', volume: vol });
    });

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

    window.addEventListener('resize', resize);
    resize();

    window.addEventListener('message', e => {
      const msg = e.data;
      if (msg.command === 'scope') {
        lastIn  = msg.in  || [];
        lastOut = msg.out || [];
        draw();
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
      } else if (msg.command === 'wavSelected') {
        if (wavNameEl) wavNameEl.textContent = msg.name || 'no file';
        const srcEl = document.getElementById('audio-source-select');
        if (srcEl) { srcEl.value = 'wav'; updateSourceGroups('wav'); }
      } else if (msg.command === 'event') {
        if (msg.kind === 'realtime_unavailable') {
          eventsEl.textContent = '⚠ Live input unavailable — check microphone permission. Falling back to sine.';
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
          statusEl.textContent = statusEl.textContent.replace(/xruns: \\d+/, 'xruns: ' + xrunCount);
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
      }
    });

    btnAudioStart?.addEventListener('click', () => {
      vscode.postMessage({ command: 'startAudio' });
      if (btnAudioStart) btnAudioStart.disabled = true;
      if (btnAudioStop)  btnAudioStop.disabled  = false;
    });
    btnAudioStop?.addEventListener('click', () => {
      vscode.postMessage({ command: 'stopAudio' });
      if (btnAudioStart) btnAudioStart.disabled = false;
      if (btnAudioStop)  btnAudioStop.disabled  = true;
    });

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

    vscode.postMessage({ command: 'webviewReady' });
  </script>
</body>
</html>`;
}
