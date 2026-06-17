import * as vscode from 'vscode';
import { EmulatorManager } from '../emulator/manager';
import { IpcMessage } from '../emulator/ipc-client';
import { ControllerDef } from '../controllers/controller-config';

const PANEL_ID = 'daisy-scope';
const PANEL_TITLE = 'Daisy Scope';

export type PotChangeHandler = (channel: number, value: number) => void;

export class ScopePanel {
  private panel: vscode.WebviewPanel | null = null;
  private defs: ControllerDef[] = [];
  private initialValues: Record<number, number> = {};
  private msgDisposable: vscode.Disposable | null = null;

  constructor(
    private readonly manager: EmulatorManager,
    private readonly onPotChange?: PotChangeHandler,
  ) {
    manager.on('message', (msg: IpcMessage) => {
      if (msg['type'] === 'scope') this.postScope(msg);
      if (msg['type'] === 'status') this.postStatus(msg);
      if (msg['type'] === 'event') this.postEvent(msg);
    });
  }

  show(defs: ControllerDef[] = [], initialValues: Record<number, number> = {}): void {
    this.defs = defs;
    this.initialValues = initialValues;

    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Two);
      // Refresh HTML to reflect new defs/values
      this.panel.webview.html = buildHtml(this.defs, this.initialValues);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      PANEL_ID,
      PANEL_TITLE,
      vscode.ViewColumn.Two,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel.webview.html = buildHtml(this.defs, this.initialValues);

    this.msgDisposable = this.panel.webview.onDidReceiveMessage((msg: unknown) => {
      if (!msg || typeof msg !== 'object') return;
      const m = msg as Record<string, unknown>;
      if (m['command'] === 'pot' && typeof m['channel'] === 'number' && typeof m['value'] === 'number') {
        this.manager.sendPot(m['channel'], m['value']);
        this.onPotChange?.(m['channel'], m['value']);
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

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildHtml(defs: ControllerDef[], initialValues: Record<number, number>): string {
  const controllersHtml = buildControllersHtml(defs, initialValues);
  return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Daisy Scope</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #1e1e1e; color: #d4d4d4; font-family: monospace; font-size: 12px; display: flex; flex-direction: column; height: 100vh; }
    header { padding: 6px 12px; background: #252526; display: flex; align-items: center; gap: 16px; border-bottom: 1px solid #3c3c3c; }
    #status-text { flex: 1; }
    .legend { display: flex; gap: 12px; }
    .legend span { display: flex; align-items: center; gap: 4px; }
    .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
    .dot-in  { background: #4ec9b0; }
    .dot-out { background: #ce9178; }
    #events { padding: 3px 12px; min-height: 22px; background: #252526; border-bottom: 1px solid #3c3c3c; font-size: 11px; color: #f48771; }
    canvas { flex: 1; display: block; width: 100%; }
    #controllers { padding: 8px 12px; background: #252526; border-top: 1px solid #3c3c3c; display: flex; flex-wrap: wrap; gap: 16px; }
    .pot { display: flex; align-items: center; gap: 8px; }
    .pot-label { min-width: 80px; color: #9cdcfe; }
    .pot-slider { width: 140px; cursor: pointer; }
    .pot-value { min-width: 40px; text-align: right; color: #b5cea8; }
  </style>
</head>
<body>
  <header>
    <span id="status-text">Waiting for emulator…</span>
    <span class="legend">
      <span><span class="dot dot-in"></span>Input</span>
      <span><span class="dot dot-out"></span>Output</span>
    </span>
  </header>
  <div id="events"></div>
  <canvas id="scope"></canvas>
  ${controllersHtml}
  <script>
    const vscode = acquireVsCodeApi();
    const canvas = document.getElementById('scope');
    const ctx = canvas.getContext('2d');
    const statusEl = document.getElementById('status-text');
    const eventsEl = document.getElementById('events');

    let lastIn = [], lastOut = [];

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
        const r = msg.running ? '▶ Running' : '■ Stopped';
        statusEl.textContent = r + '  |  ' + msg.sampleRate + ' Hz  |  block ' + msg.blockSize;
      } else if (msg.command === 'event') {
        eventsEl.textContent = '⚠ ' + msg.kind.toUpperCase();
        setTimeout(() => { eventsEl.textContent = ''; }, 4000);
      }
    });
  </script>
</body>
</html>`;
}
