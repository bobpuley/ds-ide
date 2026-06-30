import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { IpcMessage } from '../emulator/ipc-client';
import { ControllerConfig, parseControllerConfig, serializeControllerConfig } from '../controllers/controller-config';
import { ControlsConfig } from '../webview/scope-panel';

export class ControlsViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private lastControlsConfig: ControlsConfig | undefined;
  private lastEditorCfg: ControllerConfig | undefined;
  private lastStatus: IpcMessage | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly onEditorSave: (cfg: ControllerConfig) => void,
    private readonly onPotChange: (channel: number, value: number) => void,
    private readonly onButtonChange: (gpioPin: number, pressed: boolean) => void,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')],
    };

    const nonce = randomBytes(16).toString('base64');
    const scriptUri = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'controls-webview.js'),
    ).toString();
    webviewView.webview.html = buildHtml(nonce, scriptUri);

    const msgDisposable = webviewView.webview.onDidReceiveMessage((msg: unknown) => {
      if (!msg || typeof msg !== 'object') return;
      const m = msg as Record<string, unknown>;
      if (m['command'] === 'webviewReady') {
        this._flush();
        return;
      }
      if (m['command'] === 'editorSave') {
        const cfg = m['cfg'] as ControllerConfig | undefined;
        if (cfg) {
          const validated = parseControllerConfig(serializeControllerConfig(cfg));
          if (validated.errors.length === 0) this.onEditorSave(validated);
        }
      }
      if (m['command'] === 'pot') {
        const ch = m['channel'];
        const val = m['value'];
        if (typeof ch === 'number' && Number.isInteger(ch) && ch >= 0 && ch <= 11 &&
            typeof val === 'number' && val >= 0 && val <= 1) {
          this.onPotChange(ch, val);
        }
      }
      if (m['command'] === 'button' && typeof m['gpioPin'] === 'number' && typeof m['pressed'] === 'boolean') {
        this.onButtonChange(m['gpioPin'], m['pressed']);
      }
    });

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this._flush();
      }
    });

    webviewView.onDidDispose(() => {
      msgDisposable.dispose();
      this.view = undefined;
    });

    this._flush();
  }

  get isVisible(): boolean { return this.view?.visible ?? false; }

  postControlsConfig(config: ControlsConfig): void {
    this.lastControlsConfig = config;
    void this.view?.webview.postMessage({ command: 'controlsConfig', ...config });
    if (this.lastStatus) {
      void this.view?.webview.postMessage({ command: 'status', ...this.lastStatus });
    }
  }

  postStatus(msg: IpcMessage): void {
    this.lastStatus = msg;
    void this.view?.webview.postMessage({ command: 'status', ...msg });
  }

  postLed(msg: IpcMessage): void {
    void this.view?.webview.postMessage({ command: 'led', gpioPin: msg['gpioPin'], lit: msg['lit'] });
  }

  loadEditor(cfg: ControllerConfig): void {
    this.lastEditorCfg = cfg;
    void this.view?.webview.postMessage({ command: 'editorLoad', cfg });
  }

  private _flush(): void {
    if (this.lastEditorCfg) {
      void this.view?.webview.postMessage({ command: 'editorLoad', cfg: this.lastEditorCfg });
    }
    if (this.lastControlsConfig) {
      void this.view?.webview.postMessage({ command: 'controlsConfig', ...this.lastControlsConfig });
    }
    if (this.lastStatus) {
      void this.view?.webview.postMessage({ command: 'status', ...this.lastStatus });
    }
  }
}

export const TRUNC_MAX_LEN = 15;
const TRUNC_SUFFIX = '…';

export function truncId(id: string): string {
  return id.length > TRUNC_MAX_LEN ? id.slice(0, TRUNC_MAX_LEN - 1) + TRUNC_SUFFIX : id;
}

function safeJson(obj: unknown): string {
  return JSON.stringify(obj)
    .replace(/&/g, '\\u0026')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');
}

function buildHtml(nonce: string, scriptUri: string): string {
  return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>DS-IDE Controls</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #1e1e1e; color: #d4d4d4; font-family: monospace; font-size: 12px; display: flex; flex-direction: column; height: 100vh; }
    #editor-toolbar { padding: 6px 12px; background: #252526; border-bottom: 1px solid #3c3c3c; display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
    #save-btn { background: #0e639c; color: #fff; border: none; padding: 4px 14px; font-family: monospace; cursor: pointer; border-radius: 2px; font-size: 12px; }
    #save-btn:hover { background: #1177bb; }
    #save-status { font-size: 11px; color: #b5cea8; }
    #ce-emu-status { font-size: 11px; }
    .ce-emu-running { color: #4ec94e; }
    .ce-emu-stopped { color: #f04a4a; }
    .emu-sep { color: #3c3c3c; user-select: none; }
    #convention-banner { display: none; align-items: center; gap: 8px; padding: 5px 12px; background: #3a2f00; border-bottom: 1px solid #7a6500; color: #f4c430; font-size: 11px; flex-shrink: 0; }
    #design-area { display: flex; flex: 1; min-height: 0; overflow: hidden; }
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
    .ctrl-handle { display: flex; align-items: center; gap: 6px; padding: 4px 6px 4px 8px; cursor: grab; background: rgba(255,255,255,0.03); border-bottom: 1px solid #3c3c3c; user-select: none; }
    .ctrl-handle:active { cursor: grabbing; }
    .handle-glyph { color: #555; font-size: 13px; }
    .card-id-label { flex: 1; color: #d4d4d4; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .card-pin-label { color: #6a6a6a; font-size: 10px; }
    .ctrl-body { padding: 6px 8px 8px; display: flex; align-items: center; justify-content: center; gap: 8px; flex-wrap: wrap; }
    .body-disabled { opacity: 0.35; pointer-events: none; }
    .knob-wrap { display: flex; flex-direction: column; align-items: center; gap: 3px; cursor: ns-resize; user-select: none; padding: 2px 4px; }
    .knob-svg { display: block; }
    .knob-value { color: #b5cea8; font-size: 10px; font-family: monospace; min-width: 36px; text-align: center; }
    .btn-ce { background: #4a4a4a; border: 1px solid #666; border-radius: 6px; padding: 7px; cursor: pointer; box-shadow: 0 3px 0 #111; transition: box-shadow 0.06s, transform 0.06s, background 0.06s; flex-shrink: 0; user-select: none; }
    .btn-ce[aria-pressed="true"] { box-shadow: none; transform: translateY(3px); background: #0e639c; border-color: #1177bb; }
    .vled-dot { width: 12px; height: 12px; border-radius: 50%; background: #3c3c3c; border: 1px solid #555; box-shadow: none; display: inline-block; }
    .vled-dot.vled-lit { background: #f04a4a; border-color: #ff6a6a; box-shadow: 0 0 6px 1px #f04a4a; }
    .section-label { color: #9cdcfe; align-self: center; }
  </style>
</head>
<body>
  <div id="editor-toolbar">
    <span id="ce-emu-status" class="ce-emu-stopped">&#9632;</span>
    <span class="emu-sep" style="margin:0 6px">|</span>
    <span id="save-wrap" style="display:inline-flex;align-items:center;gap:8px">
      <button id="save-btn">&#x1F4BE; layout</button>
      <span id="save-status"></span>
    </span>
  </div>
  <div id="convention-banner">&#9888; Code convention not detected &#8212; running in yaml-only mode</div>
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
  <script id="yaml-init" type="application/json" nonce="${nonce}">${safeJson({ pots: [], buttons: [], leds: [] })}</script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
