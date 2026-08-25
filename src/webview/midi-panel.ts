import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { EmulatorManager } from '../emulator/manager';
import { IpcMessage } from '../emulator/ipc-client';
import { getNumber } from '../ipc/narrow';
import { noteToBytes, programChangeToBytes, controlChangeToBytes } from './midi-monitor';
import { MidiWebviewMessage } from './messages';
import { hasKnownCommand, assertNever } from './message-guard';

// FR-EXT-33: see controls-editor-panel.ts's identical comment.
const MIDI_WEBVIEW_COMMANDS = new Set<MidiWebviewMessage['command']>([
  'webviewReady', 'noteOn', 'noteOff', 'programChange', 'controlChange',
]);

// Program/CC numbers are 7-bit MIDI values (FR-MIDI-1) — same range every
// other MIDI byte in this shim is validated against.
const MIDI_7BIT_MAX = 127;
function isValid7Bit(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= MIDI_7BIT_MAX;
}

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
    if (msg['type'] === 'midiTx') this.postMidiTx(msg);
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

    this.msgDisposable = this.panel.webview.onDidReceiveMessage((raw: unknown) => {
      if (!hasKnownCommand<MidiWebviewMessage>(raw, MIDI_WEBVIEW_COMMANDS)) return;
      const msg = raw;
      switch (msg.command) {
        case 'webviewReady': {
          break;
        }
        case 'noteOn':
        case 'noteOff': {
          const note = typeof msg.note === 'number' ? msg.note : undefined;
          const velocity = typeof msg.velocity === 'number' ? msg.velocity : undefined;
          if (note === undefined || velocity === undefined) return;
          const { status, data1, data2 } = noteToBytes(msg.command, note, velocity);
          this.manager.sendMidiEvent(status, data1, data2);
          break;
        }
        case 'programChange': {
          const program = typeof msg.program === 'number' ? msg.program : undefined;
          if (program === undefined || !isValid7Bit(program)) return;
          const { status, data1, data2 } = programChangeToBytes(program);
          this.manager.sendMidiEvent(status, data1, data2);
          break;
        }
        case 'controlChange': {
          const controller = typeof msg.controller === 'number' ? msg.controller : undefined;
          const value = typeof msg.value === 'number' ? msg.value : undefined;
          if (controller === undefined || value === undefined
            || !isValid7Bit(controller) || !isValid7Bit(value)) return;
          const { status, data1, data2 } = controlChangeToBytes(controller, value);
          this.manager.sendMidiEvent(status, data1, data2);
          break;
        }
        default:
          assertNever(msg, 'MidiPanel');
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

  // FR-MIDI-1: mirrors postMidiRx — same whitelisting (FR-IPC-2), the shim's
  // own SendMessage() outbound path instead of the inbound one.
  private postMidiTx(msg: IpcMessage): void {
    const status = getNumber(msg, 'status');
    const data1 = getNumber(msg, 'data1');
    const data2 = getNumber(msg, 'data2');
    const channel = getNumber(msg, 'channel');
    const midiType = getNumber(msg, 'midiType');
    if (status === undefined || data1 === undefined || data2 === undefined
      || channel === undefined || midiType === undefined) return;
    this.panel?.webview.postMessage({ command: 'midiTx', status, data1, data2, channel, midiType });
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
    #keyboard { display: flex; height: 96px; gap: 2px; flex-shrink: 0; }
    .key { flex: 1; background: #3c3c3c; border: 1px solid #555; border-radius: 0 0 4px 4px; cursor: pointer; user-select: none; }
    .key:active, .key.pressed { background: #4ec9b0; }
    /* FR-MIDI-1: Program Change / Control Change sender — stacked below the
       keyboard, above the monitor (docs/mockups/m48-io-monitors.html Variant A). */
    #sender { flex-shrink: 0; border: 1px solid #3c3c3c; border-radius: 4px; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
    .sender-row { display: flex; align-items: center; gap: 6px; }
    .sender-row label { width: 50px; color: #9a9a9a; font-size: 10px; }
    .sender-row select, .sender-row input { background: #3c3c3c; border: 1px solid #555; color: #d4d4d4; padding: 3px 5px; font-family: monospace; font-size: 11px; width: 64px; }
    .sender-row button { background: #0e639c; border: 1px solid #1177bb; color: #fff; padding: 3px 10px; border-radius: 2px; cursor: pointer; font-family: monospace; font-size: 10px; margin-left: auto; }
    .sender-row button:hover { background: #1177bb; }
    #monitor { flex: 1; overflow-y: auto; border: 1px solid #3c3c3c; padding: 6px; font-size: 11px; }
    .monitor-row { white-space: pre; }
    .monitor-row.dir-rx { color: #4ec9b0; }
    .monitor-row.dir-tx { color: #569cd6; }
    #monitor-legend { flex-shrink: 0; display: flex; gap: 14px; font-size: 10px; color: #9a9a9a; }
    #monitor-legend .sw { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; }
    #monitor-legend .sw.rx { background: #4ec9b0; } #monitor-legend .sw.tx { background: #569cd6; }
  </style>
</head>
<body>
  <div id="keyboard"></div>
  <div id="sender">
    <div class="sender-row">
      <label>Program</label>
      <select id="pc-select"></select>
      <button id="pc-send">Send PC</button>
    </div>
    <div class="sender-row">
      <label>CC</label>
      <input id="cc-num" type="number" min="0" max="127" value="1"/>
      <input id="cc-val" type="number" min="0" max="127" value="64"/>
      <button id="cc-send">Send CC</button>
    </div>
  </div>
  <div id="monitor"></div>
  <div id="monitor-legend"><span><span class="sw rx"></span>Rx</span><span><span class="sw tx"></span>Tx</span></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
