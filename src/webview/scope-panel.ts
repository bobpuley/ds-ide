import * as vscode from 'vscode';
import { EmulatorManager } from '../emulator/manager';
import { IpcMessage } from '../emulator/ipc-client';
import { ControllerDef, ButtonDef, LedDef } from '../controllers/controller-config';

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

  constructor(
    private readonly manager: EmulatorManager,
    private readonly onPotChange?: PotChangeHandler,
    private readonly onSineChange?: SineChangeHandler,
    private readonly onAudioSourceChange?: AudioSourceChangeHandler,
    private readonly onPickWav?: PickWavHandler,
    private readonly onButtonChange?: ButtonChangeHandler,
  ) {
    manager.on('message', (msg: IpcMessage) => {
      if (msg['type'] === 'scope') this.postScope(msg);
      if (msg['type'] === 'status') this.postStatus(msg);
      if (msg['type'] === 'event') this.postEvent(msg);
      if (msg['type'] === 'xrun') this.postXrun(msg);
      if (msg['type'] === 'latency') this.postLatency(msg);
      if (msg['type'] === 'led') this.postLed(msg);
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
    });

    this.panel.onDidDispose(() => {
      this.msgDisposable?.dispose();
      this.msgDisposable = null;
      this.panel = null;
    });
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

function buildSineControlsHtml(sine: SineParams): string {
  return `<div id="sine-controls">
    <span class="sine-label">Sine input:</span>
    <label class="sine-field">
      <span>Freq</span>
      <input type="number" id="sine-freq" min="20" max="20000" step="1" value="${sine.freq}"/>
      <span>Hz</span>
    </label>
    <label class="sine-field">
      <span>Amp</span>
      <input type="range" id="sine-amp" min="0" max="1" step="0.01" value="${sine.amplitude}"/>
      <span id="sine-amp-val">${sine.amplitude.toFixed(2)}</span>
    </label>
  </div>`;
}

function buildAudioSourceHtml(source: AudioSource): string {
  const isSine = source.input === 'sine';
  const isLive = source.input === 'live';
  const isWav  = source.input === 'wav';
  const bufSizes = [64, 128, 256, 512];
  const bufOptions = bufSizes.map(s =>
    `<option value="${s}" ${s === source.bufferSize ? 'selected' : ''}>${s}</option>`
  ).join('');
  const wavName = source.wavPath ? baseName(source.wavPath) : '';
  return `<div id="audio-source-bar">
    <span class="source-label">Input:</span>
    <label class="source-option">
      <input type="radio" name="audio-input" value="sine" ${isSine ? 'checked' : ''}/> Sine
    </label>
    <label class="source-option">
      <input type="radio" name="audio-input" value="live" ${isLive ? 'checked' : ''}/> Live (mic)
    </label>
    <label class="source-option">
      <input type="radio" name="audio-input" value="wav" ${isWav ? 'checked' : ''}/> WAV
    </label>
    <span class="source-sep">|</span>
    <label class="source-field">
      <span>Buffer</span>
      <select id="buffer-size">${bufOptions}</select>
      <span>samples</span>
    </label>
    <span class="source-sep">|</span>
    <span id="latency-display" class="latency-text">latency: —</span>
    <span class="source-sep">|</span>
    <span id="xrun-display" class="xrun-text">xruns: 0</span>
  </div>
  <div id="wav-controls">
    <span class="wav-label">WAV file:</span>
    <button id="wav-choose" type="button">Choose WAV…</button>
    <span id="wav-name" class="wav-name">${wavName ? escHtml(wavName) : 'no file selected'}</span>
    <label class="wav-loop">
      <input type="checkbox" id="wav-loop" ${source.wavLoop ? 'checked' : ''}/> Loop
    </label>
  </div>`;
}

function baseName(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildHtml(
  defs: ControllerDef[], initialValues: Record<number, number>, sine: SineParams, source: AudioSource,
  buttons: ButtonDef[] = [], leds: LedDef[] = [], initialButtons: Record<number, boolean> = {},
): string {
  const controllersHtml = buildControllersHtml(defs, initialValues);
  const sineHtml = buildSineControlsHtml(sine);
  const audioSourceHtml = buildAudioSourceHtml(source);
  const buttonsHtml = buildButtonsHtml(buttons, initialButtons);
  const ledsHtml = buildLedsHtml(leds);
  return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Daisy Scope</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #1e1e1e; color: #d4d4d4; font-family: monospace; font-size: 12px; display: flex; flex-direction: column; height: 100vh; }
    header { padding: 6px 12px; background: #252526; display: flex; align-items: center; gap: 16px; border-bottom: 1px solid #3c3c3c; flex-wrap: wrap; }
    #fidelity-caveat { font-size: 10px; color: #6a6a6a; cursor: default; margin-left: auto; }
    #status-text { flex: 1; }
    .legend { display: flex; gap: 12px; }
    .legend span { display: flex; align-items: center; gap: 4px; }
    .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
    .dot-in  { background: #4ec9b0; }
    .dot-out { background: #ce9178; }
    #events { padding: 3px 12px; min-height: 22px; background: #252526; border-bottom: 1px solid #3c3c3c; font-size: 11px; color: #f48771; }
    canvas { flex: 1; display: block; width: 100%; }
    #audio-source-bar { padding: 6px 12px; background: #252526; border-top: 1px solid #3c3c3c; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .source-label { color: #9cdcfe; }
    .source-option { display: flex; align-items: center; gap: 4px; cursor: pointer; }
    .source-option input[type="radio"] { cursor: pointer; accent-color: #4ec9b0; }
    .source-sep { color: #3c3c3c; user-select: none; }
    .source-field { display: flex; align-items: center; gap: 6px; }
    .source-field select { background: #3c3c3c; color: #d4d4d4; border: 1px solid #555; padding: 2px 4px; font-family: monospace; cursor: pointer; }
    .latency-text { color: #b5cea8; }
    .xrun-text { color: #b5cea8; }
    .xrun-text.xrun-warning { color: #f48771; }
    #wav-controls { padding: 6px 12px; background: #252526; border-top: 1px solid #3c3c3c; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .wav-label { color: #9cdcfe; }
    #wav-choose { background: #0e639c; color: #fff; border: none; padding: 3px 10px; font-family: monospace; cursor: pointer; border-radius: 2px; }
    #wav-choose:hover { background: #1177bb; }
    .wav-name { color: #b5cea8; font-style: italic; }
    .section-label { color: #9cdcfe; align-self: center; }
    #buttons { padding: 8px 12px; background: #252526; border-top: 1px solid #3c3c3c; display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
    .vbutton { display: flex; flex-direction: column; align-items: center; gap: 2px; background: #3c3c3c; color: #d4d4d4; border: 1px solid #555; border-radius: 4px; padding: 6px 12px; font-family: monospace; cursor: pointer; user-select: none; }
    .vbutton:active { background: #4a4a4a; }
    .vbutton-on { background: #0e639c; border-color: #1177bb; color: #fff; }
    .vbutton-label { font-size: 12px; }
    .vbutton-pin { font-size: 9px; color: #9a9a9a; }
    .vbutton-on .vbutton-pin { color: #cfe8ff; }
    #leds { padding: 8px 12px; background: #252526; border-top: 1px solid #3c3c3c; display: flex; flex-wrap: wrap; gap: 16px; align-items: center; }
    .vled { display: flex; align-items: center; gap: 6px; }
    .vled-dot { width: 12px; height: 12px; border-radius: 50%; background: #3c3c3c; border: 1px solid #555; box-shadow: none; }
    .vled-dot.vled-lit { background: #f04a4a; border-color: #ff6a6a; box-shadow: 0 0 6px 1px #f04a4a; }
    .vled-label { color: #b5cea8; }
    .wav-loop { display: flex; align-items: center; gap: 4px; cursor: pointer; }
    .wav-loop input { cursor: pointer; accent-color: #4ec9b0; }
    #sine-controls { padding: 6px 12px; background: #252526; border-top: 1px solid #3c3c3c; display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
    .sine-label { color: #9cdcfe; }
    .sine-field { display: flex; align-items: center; gap: 6px; }
    .sine-field input[type="number"] { width: 68px; background: #3c3c3c; color: #d4d4d4; border: 1px solid #555; padding: 2px 4px; font-family: monospace; }
    .sine-field input[type="range"] { width: 100px; cursor: pointer; }
    #controllers { padding: 8px 12px; background: #252526; border-top: 1px solid #3c3c3c; display: flex; flex-wrap: wrap; gap: 16px; }
    .pot { display: flex; align-items: center; gap: 8px; }
    .pot-label { min-width: 80px; color: #9cdcfe; }
    .pot-slider { width: 140px; cursor: pointer; }
    .pot-value { min-width: 40px; text-align: right; color: #b5cea8; }
    #getting-started { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: #6a6a6a; padding: 32px; text-align: center; }
    #getting-started ol { text-align: left; padding-left: 20px; line-height: 2; }
    #getting-started code { background: #3c3c3c; padding: 1px 4px; border-radius: 2px; color: #9cdcfe; }
  </style>
</head>
<body>
  <header>
    <span id="status-text">Deploy to start…</span>
    <span class="legend">
      <span><span class="dot dot-in"></span>Input</span>
      <span><span class="dot dot-out"></span>Output</span>
    </span>
    <span id="fidelity-caveat" title="Emulator approximates the Seed — not bit-exact, does not validate hardware CPU/RAM budget">ℹ Approx. Seed</span>
  </header>
  <div id="events"></div>
  <canvas id="scope" style="display:none"></canvas>
  <div id="getting-started">
    <div>Open a libDaisy project, then:</div>
    <ol>
      <li><code>Daisy IDE: Build for Emulator</code></li>
      <li><code>Daisy IDE: Deploy to Emulator</code></li>
      <li><code>Daisy IDE: Start Audio</code></li>
    </ol>
    <div style="margin-top:8px;font-size:11px">Use <code>Deploy and Debug</code> to attach breakpoints.</div>
  </div>
  ${audioSourceHtml}
  ${sineHtml}
  ${controllersHtml}
  ${buttonsHtml}
  ${ledsHtml}
  <script>
    const vscode = acquireVsCodeApi();
    const canvas = document.getElementById('scope');
    const ctx = canvas.getContext('2d');
    const statusEl = document.getElementById('status-text');
    const eventsEl = document.getElementById('events');
    const gettingStarted = document.getElementById('getting-started');
    const sineFreqEl = document.getElementById('sine-freq');
    const sineAmpEl  = document.getElementById('sine-amp');
    const sineAmpValEl = document.getElementById('sine-amp-val');
    const bufferSizeEl = document.getElementById('buffer-size');
    const latencyEl = document.getElementById('latency-display');
    const xrunEl = document.getElementById('xrun-display');
    const wavChooseEl = document.getElementById('wav-choose');
    const wavNameEl = document.getElementById('wav-name');
    const wavLoopEl = document.getElementById('wav-loop');

    let lastIn = [], lastOut = [];
    const activeEvents = new Set();
    let hasStatus = false;
    let xrunCount = 0;

    function showScope() {
      if (!hasStatus) return;
      canvas.style.display = 'block';
      gettingStarted.style.display = 'none';
      resize();
    }

    function resize() {
      canvas.width  = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
      draw();
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

    function sendSine() {
      const freq = parseFloat(sineFreqEl.value);
      const amplitude = parseFloat(sineAmpEl.value);
      if (!isNaN(freq) && !isNaN(amplitude)) {
        vscode.postMessage({ command: 'sine', freq, amplitude });
      }
    }

    function sendAudioSource() {
      const input = document.querySelector('input[name="audio-input"]:checked')?.value || 'sine';
      const bufferSize = parseInt(bufferSizeEl.value, 10);
      const sampleRate = 48000;
      const wavLoop = !!(wavLoopEl && wavLoopEl.checked);
      vscode.postMessage({ command: 'audioSource', input, sampleRate, bufferSize, wavLoop });
    }

    sineFreqEl.addEventListener('change', sendSine);
    sineAmpEl.addEventListener('input', () => {
      sineAmpValEl.textContent = parseFloat(sineAmpEl.value).toFixed(2);
      sendSine();
    });

    // Audio source selector
    document.querySelectorAll('input[name="audio-input"]').forEach(radio => {
      radio.addEventListener('change', sendAudioSource);
    });
    bufferSizeEl.addEventListener('change', sendAudioSource);

    // WAV controls
    wavChooseEl?.addEventListener('click', () => vscode.postMessage({ command: 'pickWav' }));
    wavLoopEl?.addEventListener('change', sendAudioSource);

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
      } else if (msg.command === 'status') {
        hasStatus = true;
        showScope();
        const r = msg.running ? '▶ Running' : '■ Stopped';
        statusEl.textContent = r + '  |  ' + msg.sampleRate + ' Hz  |  block ' + msg.blockSize + '  |  xruns: ' + xrunCount;
        if (!msg.running) {
          activeEvents.clear();
          eventsEl.textContent = '';
        }
      } else if (msg.command === 'wavSelected') {
        if (wavNameEl) wavNameEl.textContent = msg.name || 'no file selected';
        const wavRadio = document.querySelector('input[name="audio-input"][value="wav"]');
        if (wavRadio) wavRadio.checked = true;
      } else if (msg.command === 'event') {
        if (msg.kind === 'realtime_unavailable') {
          eventsEl.textContent = '⚠ Live input unavailable — check microphone permission. Falling back to sine.';
          // Uncheck "live", re-check "sine"
          const sineRadio = document.querySelector('input[name="audio-input"][value="sine"]');
          const liveRadio = document.querySelector('input[name="audio-input"][value="live"]');
          if (sineRadio) sineRadio.checked = true;
          if (liveRadio) liveRadio.checked = false;
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
        xrunEl.textContent = 'xruns: ' + xrunCount;
        xrunEl.className = xrunCount > 0 ? 'xrun-text xrun-warning' : 'xrun-text';
        // Also update status text xrun count if shown
        if (hasStatus) {
          statusEl.textContent = statusEl.textContent.replace(/xruns: \d+/, 'xruns: ' + xrunCount);
        }
      } else if (msg.command === 'latency') {
        const ms = msg.measuredMs;
        latencyEl.textContent = 'latency: ' + (ms ? ms.toFixed(1) + ' ms' : '—');
      } else if (msg.command === 'led') {
        document.querySelectorAll('.vled-dot[data-pin="' + msg.gpioPin + '"]').forEach(dot => {
          dot.classList.toggle('vled-lit', !!msg.lit);
        });
      }
    });
  </script>
</body>
</html>`;
}
