import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { EmulatorManager } from '../emulator/manager';
import { IpcMessage } from '../emulator/ipc-client';
import { getString } from '../ipc/narrow';

const PANEL_ID = 'daisy-oled';
const PANEL_TITLE = 'Daisy OLED';

// Renders the SSD1306 framebuffer the emulator captures off the real-time
// path (FR-DEV-14) at its native 128×64, reporting frame rate and the
// peripheral's currently-selected bus (FR-DEV-15). Mirrors ScopePanel's
// structure (panel lifecycle, webviewReady handshake replaying last-known
// state on reveal) but carries far less state — one frame, one bus label.
export class OledPanel {
  private panel: vscode.WebviewPanel | null = null;
  private msgDisposable: vscode.Disposable | null = null;
  private lastFrame: string | null = null;
  private lastBus: string | null = null;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly manager: EmulatorManager,
  ) {
    manager.on('message', this._onManagerMessage);
  }

  private readonly _onManagerMessage = (msg: IpcMessage): void => {
    if (msg['type'] === 'oledFrame') this.postFrame(msg);
  };

  show(bus: string | null = null): void {
    this.lastBus = bus;

    if (this.panel) {
      // Reveal only — reassigning webview.html would reload the page and
      // discard nothing here (no trace history to lose), but stays
      // consistent with ScopePanel's convention for a panel already open.
      this.panel.reveal(vscode.ViewColumn.Two);
      this.postBus(this.lastBus);
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

    this.msgDisposable = this.panel.webview.onDidReceiveMessage((msg: unknown) => {
      if (!msg || typeof msg !== 'object') return;
      const m = msg as Record<string, unknown>;
      if (m['command'] === 'webviewReady') {
        if (this.lastFrame) this.postFrameData(this.lastFrame);
        this.postBus(this.lastBus);
      }
    });

    this.panel.onDidDispose(() => {
      this.msgDisposable?.dispose();
      this.msgDisposable = null;
      this.panel = null;
    });
  }

  // Called from extension.ts whenever peripheral state changes (the same
  // moment wiringProvider?.postPeripherals() runs) — the bus is a
  // TS/registry-side concept the emulator's frame message never carries.
  notifyBus(bus: string | null): void {
    this.lastBus = bus;
    this.postBus(bus);
  }

  dispose(): void {
    this.manager.off('message', this._onManagerMessage);
    this.msgDisposable?.dispose();
    this.msgDisposable = null;
    this.panel?.dispose();
    this.panel = null;
  }

  // Only the whitelisted, type-checked `data` field is forwarded — msg
  // originates from the emulator's IPC socket (FR-IPC-2).
  private postFrame(msg: IpcMessage): void {
    const data = getString(msg, 'data');
    if (data === undefined) return;
    this.postFrameData(data);
  }

  private postFrameData(data: string): void {
    this.lastFrame = data;
    this.panel?.webview.postMessage({ command: 'oledFrame', data });
  }

  private postBus(bus: string | null): void {
    this.panel?.webview.postMessage({ command: 'oledBus', bus });
  }

  private html(): string {
    const nonce = randomBytes(16).toString('base64');
    const scriptUri = this.panel!.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'oled-webview.js'),
    ).toString();
    return buildHtml(nonce, scriptUri);
  }
}

function buildHtml(nonce: string, scriptUri: string): string {
  return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Daisy OLED</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #1e1e1e; color: #d4d4d4; font-family: monospace; font-size: 12px; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; gap: 12px; }
    #oled { background: #000; border: 1px solid #555; image-rendering: pixelated; }
    #oled-foot { color: #9cdcfe; font-size: 11px; }
  </style>
</head>
<body>
  <canvas id="oled" width="128" height="64" style="width:512px;height:256px;"></canvas>
  <div id="oled-foot">SSD1306 · 128×64 · —</div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
