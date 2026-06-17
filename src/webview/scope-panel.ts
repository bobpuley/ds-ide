import * as vscode from 'vscode';
import { EmulatorManager } from '../emulator/manager';
import { IpcMessage } from '../emulator/ipc-client';
import { ControllerDef } from '../controllers/controller-config';

const PANEL_ID = 'daisy-scope';
const PANEL_TITLE = 'Daisy Scope';

export const SINE_DEFAULTS = { freq: 440, amplitude: 0.5 } as const;

export interface SineParams {
  freq: number;
  amplitude: number;
}

export type PotChangeHandler = (channel: number, value: number) => void;
export type SineChangeHandler = (freq: number, amplitude: number) => void;

export class ScopePanel {
  private panel: vscode.WebviewPanel | null = null;
  private defs: ControllerDef[] = [];
  private initialValues: Record<number, number> = {};
  private sineParams: SineParams = { ...SINE_DEFAULTS };
  private msgDisposable: vscode.Disposable | null = null;

  constructor(
    private readonly manager: EmulatorManager,
    private readonly onPotChange?: PotChangeHandler,
    private readonly onSineChange?: SineChangeHandler,
  ) {
    manager.on('message', (msg: IpcMessage) => {
      if (msg['type'] === 'scope') this.postScope(msg);
      if (msg['type'] === 'status') this.postStatus(msg);
      if (msg['type'] === 'event') this.postEvent(msg);
    });
  }

  show(
    defs: ControllerDef[] = [],
    initialValues: Record<number, number> = {},
    sineParams: SineParams = { ...SINE_DEFAULTS },
  ): void {
    this.defs = defs;
    this.initialValues = initialValues;
    this.sineParams = sineParams;

    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Two);
      this.panel.webview.html = buildHtml(this.defs, this.initialValues, this.sineParams);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      PANEL_ID,
      PANEL_TITLE,
      vscode.ViewColumn.Two,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel.webview.html = buildHtml(this.defs, this.initialValues, this.sineParams);

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
    });

    this.panel.onDidDispose(() => {
      this.msgDisposable?.dispose();
      this.msgDisposable = null;
      this.panel = null;
    });
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

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildHtml(defs: ControllerDef[], initialValues: Record<number, number>, sine: SineParams): string {
  const controllersHtml = buildControllersHtml(defs, initialValues);
  const sineHtml = buildSineControlsHtml(sine);
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
  ${sineHtml}
  ${controllersHtml}
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

    let lastIn = [], lastOut = [];
    const activeEvents = new Set();
    let hasStatus = false;

    function showScope() {
      if (!hasStatus) return;
      canvas.style.display = 'block';
      gettingStarted.style.display = 'none';
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

    sineFreqEl.addEventListener('change', sendSine);
    sineAmpEl.addEventListener('input', () => {
      sineAmpValEl.textContent = parseFloat(sineAmpEl.value).toFixed(2);
      sendSine();
    });

    // Pot slider wiring
    document.querySelectorAll('.pot-slider').forEach(slider => {
      slider.addEventListener('input', () => {
        const channel = parseInt(slider.dataset.channel, 10);
        const value   = parseFloat(slider.value);
        slider.closest('.pot').querySelector('.pot-value').textContent = value.toFixed(3);
        vscode.postMessage({ command: 'pot', channel, value });
      });
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
        statusEl.textContent = r + '  |  ' + msg.sampleRate + ' Hz  |  block ' + msg.blockSize + '  |  xruns: n/a';
        if (!msg.running) {
          activeEvents.clear();
          eventsEl.textContent = '';
        }
      } else if (msg.command === 'event') {
        activeEvents.add(msg.kind.toUpperCase());
        eventsEl.textContent = [...activeEvents].map(k => '⚠ ' + k).join('  ');
      }
    });
  </script>
</body>
</html>`;
}
