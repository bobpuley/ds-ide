import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { EmulatorManager } from '../emulator/manager';
import { IpcMessage } from '../emulator/ipc-client';
import { getNumber } from '../ipc/narrow';
import { noteToBytes } from './midi-monitor';

const PANEL_ID = 'daisy-midi';
const PANEL_TITLE = 'Daisy MIDI';

// Combines an on-screen keyboard (sends notes into the emulator) and a
// message monitor (renders every midiRx event the shim confirms it parsed —
// FR-DEV-15's "watch what the effect actually receives" principle, extended
// to MIDI). Mirrors OledPanel's lifecycle/webviewReady handshake, but carries
// no per-frame replay state — unlike a framebuffer, a MIDI monitor's history
// is inherently a stream of past events with no single "current" snapshot
// worth replaying on reveal.
export class MidiPanel {
  private panel: vscode.WebviewPanel | null = null;
  private msgDisposable: vscode.Disposable | null = null;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly manager: EmulatorManager,
  ) {
    manager.on('message', this._onManagerMessage);
  }

  private readonly _onManagerMessage = (msg: IpcMessage): void => {
    if (msg['type'] === 'midiRx') this.postMidiRx(msg);
  };

  show(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Two);
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
      if (m['command'] === 'noteOn' || m['command'] === 'noteOff') {
        const note = getNumber(m, 'note');
        const velocity = getNumber(m, 'velocity');
        if (note === undefined || velocity === undefined) return;
        const { status, data1, data2 } = noteToBytes(m['command'], note, velocity);
        this.manager.sendMidiEvent(status, data1, data2);
      }
    });

    this.panel.onDidDispose(() => {
      this.msgDisposable?.dispose();
      this.msgDisposable = null;
      this.panel = null;
    });
  }

  dispose(): void {
    this.manager.off('message', this._onManagerMessage);
    this.msgDisposable?.dispose();
    this.msgDisposable = null;
    this.panel?.dispose();
    this.panel = null;
  }

  // Only whitelisted, type-checked fields are forwarded — msg originates
  // from the emulator's IPC socket (FR-IPC-2).
  private postMidiRx(msg: IpcMessage): void {
    const status = getNumber(msg, 'status');
    const data1 = getNumber(msg, 'data1');
    const data2 = getNumber(msg, 'data2');
    const channel = getNumber(msg, 'channel');
    const midiType = getNumber(msg, 'midiType');
    if (status === undefined || data1 === undefined || data2 === undefined
      || channel === undefined || midiType === undefined) return;
    this.panel?.webview.postMessage({ command: 'midiRx', status, data1, data2, channel, midiType });
  }

  private html(): string {
    const nonce = randomBytes(16).toString('base64');
    const scriptUri = this.panel!.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'midi-webview.js'),
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
  <title>Daisy MIDI</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #1e1e1e; color: #d4d4d4; font-family: monospace; font-size: 12px; display: flex; flex-direction: column; align-items: stretch; height: 100vh; gap: 8px; padding: 12px; }
    #keyboard { display: flex; height: 96px; gap: 2px; }
    .key { flex: 1; background: #3c3c3c; border: 1px solid #555; border-radius: 0 0 4px 4px; cursor: pointer; user-select: none; }
    .key:active, .key.pressed { background: #4ec9b0; }
    #monitor { flex: 1; overflow-y: auto; border: 1px solid #3c3c3c; padding: 6px; font-size: 11px; }
    .monitor-row { white-space: pre; }
  </style>
</head>
<body>
  <div id="keyboard"></div>
  <div id="monitor"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
