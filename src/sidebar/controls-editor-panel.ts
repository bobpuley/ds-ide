import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { IpcMessage } from '../emulator/ipc-client';
import { getBoolean, getNumber } from '../ipc/narrow';
import { ControllerConfig, parseControllerConfig, serializeControllerConfig } from '../controllers/controller-config';
import { ControlsConfig } from '../webview/scope-panel';
import { REGISTRY, wiredControlIds } from '../devices/registry';
import { TOGGLE_POSITIONS } from '../devices/codegen/toggle';
import { ENCODER_POSITION_MODULUS } from '../devices/codegen/encoder';
import { SdEntry } from '../webview/sd-viewer';
import { safeJson } from '../webview/html-safe';
import { truncId, TRUNC_MAX_LEN } from '../webview/id-truncate';
import { ControlsWebviewMessage } from '../webview/messages';

// Re-exported for existing callers/tests — the implementation itself now
// lives in webview/id-truncate.ts, shared with the webview side (FR-EXT-38).
export { truncId, TRUNC_MAX_LEN };
import { hasKnownCommand, assertNever } from '../webview/message-guard';

// FR-EXT-33: the discriminated union's own command literals, kept as a
// runtime Set so hasKnownCommand can narrow an incoming postMessage payload
// to ControlsWebviewMessage; the switch below's `default: assertNever(...)`
// is what actually catches a missing case at compile time if this list and
// messages.ts's union ever drift.
const CONTROLS_WEBVIEW_COMMANDS = new Set<ControlsWebviewMessage['command']>([
  'webviewReady', 'editorSave', 'pot', 'button', 'toggle', 'encoder', 'sdRefresh', 'sdPreview', 'oledPopOut',
]);

export class ControlsViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private lastControlsConfig: ControlsConfig | undefined;
  private lastEditorCfg: ControllerConfig | undefined;
  private lastStatus: IpcMessage | undefined;
  private lastSdEnabled = false;
  private lastSdEntries: SdEntry[] = [];
  private lastOledEnabled = false;
  private lastOledBus: string | null = null;
  private lastOledFrame: string | null = null;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly onEditorSave: (cfg: ControllerConfig) => void,
    private readonly onPotChange: (channel: number, value: number) => void,
    private readonly onButtonChange: (gpioPin: number, pressed: boolean) => void,
    private readonly onToggleChange: (gpioPin: number, position: number) => void,
    private readonly onEncoderChange: (gpioPin: number, position: number) => void,
    // FR-SD-1: fire-and-forget — the host re-reads ./sdcard/ from disk and
    // pushes the result back via postSdContents/postSdPreview, rather than
    // this provider owning any fs access itself (mirrors every other
    // callback here).
    private readonly onSdRefresh: () => void,
    private readonly onSdPreview: (name: string) => void,
    // FR-CE-2: "show in separate view" — the docked strip never owns the
    // standalone OledPanel's lifecycle, it just asks the host to open it.
    private readonly onOledPopOut: () => void,
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

    const msgDisposable = webviewView.webview.onDidReceiveMessage((raw: unknown) => {
      if (!hasKnownCommand<ControlsWebviewMessage>(raw, CONTROLS_WEBVIEW_COMMANDS)) return;
      const msg = raw;
      switch (msg.command) {
        case 'webviewReady': {
          this._flush();
          this.onSdRefresh();
          break;
        }
        case 'editorSave': {
          const cfg = msg.cfg;
          if (cfg && typeof cfg === 'object') {
            // cfg is untrusted webview input — serializeControllerConfig assumes
            // a well-formed ControllerConfig shape, so a missing/malformed field
            // (e.g. { pots: [{}] }) throws rather than producing validation
            // errors. Round trip is guarded so that never reaches the user as
            // an uncaught exception (FR-IPC-3).
            try {
              const validated = parseControllerConfig(serializeControllerConfig(cfg));
              if (validated.errors.length === 0) this.onEditorSave(validated);
            } catch {
              void vscode.window.showWarningMessage('ds-ide: could not save controls layout — malformed data from editor.');
            }
          }
          break;
        }
        case 'pot': {
          const ch = msg.channel;
          const val = msg.value;
          if (typeof ch === 'number' && Number.isInteger(ch) && ch >= 0 && ch <= 11 &&
              typeof val === 'number' && val >= 0 && val <= 1) {
            this.onPotChange(ch, val);
          }
          break;
        }
        case 'button': {
          if (typeof msg.gpioPin === 'number' && typeof msg.pressed === 'boolean') {
            this.onButtonChange(msg.gpioPin, msg.pressed);
          }
          break;
        }
        case 'toggle': {
          if (typeof msg.gpioPin === 'number' && typeof msg.position === 'number' &&
              Number.isInteger(msg.position) && msg.position >= 0 && msg.position < TOGGLE_POSITIONS) {
            this.onToggleChange(msg.gpioPin, msg.position);
          }
          break;
        }
        case 'encoder': {
          if (typeof msg.gpioPin === 'number' && typeof msg.position === 'number' &&
              Number.isInteger(msg.position) && msg.position >= 0 && msg.position < ENCODER_POSITION_MODULUS) {
            this.onEncoderChange(msg.gpioPin, msg.position);
          }
          break;
        }
        case 'sdRefresh': {
          this.onSdRefresh();
          break;
        }
        case 'sdPreview': {
          if (typeof msg.name === 'string') this.onSdPreview(msg.name);
          break;
        }
        case 'oledPopOut': {
          this.onOledPopOut();
          break;
        }
        default:
          assertNever(msg, 'ControlsViewProvider');
      }
    });

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this._flush();
        this.onSdRefresh();
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
      void this.view?.webview.postMessage(statusPayload(this.lastStatus));
    }
  }

  postStatus(msg: IpcMessage): void {
    this.lastStatus = msg;
    void this.view?.webview.postMessage(statusPayload(msg));
  }

  postLed(msg: IpcMessage): void {
    void this.view?.webview.postMessage({ command: 'led', gpioPin: msg['gpioPin'], lit: msg['lit'] });
  }

  postRgbLed(msg: IpcMessage): void {
    void this.view?.webview.postMessage({
      command: 'rgbLed', gpioPin: msg['gpioPin'], r: msg['r'], g: msg['g'], b: msg['b'],
    });
  }

  loadEditor(cfg: ControllerConfig): void {
    this.lastEditorCfg = cfg;
    void this.view?.webview.postMessage({ command: 'editorLoad', cfg });
  }

  // FR-SD-1
  postSdCardEnabled(enabled: boolean): void {
    this.lastSdEnabled = enabled;
    void this.view?.webview.postMessage({ command: 'sdCardEnabled', enabled });
  }

  postSdContents(entries: SdEntry[]): void {
    this.lastSdEntries = entries;
    void this.view?.webview.postMessage({ command: 'sdContents', entries });
  }

  postSdPreview(name: string, content: string | null): void {
    void this.view?.webview.postMessage({ command: 'sdPreview', name, content });
  }

  // FR-CE-2
  postOledEnabled(enabled: boolean, bus: string | null): void {
    this.lastOledEnabled = enabled;
    this.lastOledBus = bus;
    void this.view?.webview.postMessage({ command: 'oledEnabled', enabled, bus });
  }

  postOledFrame(data: string): void {
    this.lastOledFrame = data;
    void this.view?.webview.postMessage({ command: 'oledFrame', data });
  }

  private _flush(): void {
    if (this.lastEditorCfg) {
      void this.view?.webview.postMessage({ command: 'editorLoad', cfg: this.lastEditorCfg });
    }
    if (this.lastControlsConfig) {
      void this.view?.webview.postMessage({ command: 'controlsConfig', ...this.lastControlsConfig });
    }
    if (this.lastStatus) {
      void this.view?.webview.postMessage(statusPayload(this.lastStatus));
    }
    void this.view?.webview.postMessage({ command: 'sdCardEnabled', enabled: this.lastSdEnabled });
    void this.view?.webview.postMessage({ command: 'sdContents', entries: this.lastSdEntries });
    void this.view?.webview.postMessage({ command: 'oledEnabled', enabled: this.lastOledEnabled, bus: this.lastOledBus });
    if (this.lastOledFrame) {
      void this.view?.webview.postMessage({ command: 'oledFrame', data: this.lastOledFrame });
    }
  }
}

// msg originates from the emulator's IPC socket and must never be spread
// verbatim into a webview postMessage — only whitelisted, type-checked
// fields are forwarded (FR-IPC-2).
function statusPayload(msg: IpcMessage): Record<string, unknown> {
  return {
    command: 'status',
    running: getBoolean(msg, 'running') ?? false,
    sampleRate: getNumber(msg, 'sampleRate'),
    blockSize: getNumber(msg, 'blockSize'),
  };
}

// FR-DEV-2: one CSS rule per registry entry for both the palette item and
// the on-canvas control card, so adding a device changes what's generated
// here without editing this file again.
function paletteCssRules(): string {
  return wiredControlIds()
    .map(id => `    .palette-item[data-kind="${id}"] { border-left: 3px solid ${REGISTRY[id]!.accentColor}; }`)
    .join('\n');
}

function ctrlCardCssRules(): string {
  return wiredControlIds()
    .map(id => `    .ctrl-card[data-kind="${id}"] { border-top: 3px solid ${REGISTRY[id]!.accentColor}; }`)
    .join('\n');
}

function paletteItemsHtml(): string {
  return wiredControlIds()
    .map(id => `      <div class="palette-item" data-kind="${id}" draggable="true">${REGISTRY[id]!.label}</div>`)
    .join('\n');
}

export function buildHtml(nonce: string, scriptUri: string): string {
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
    /* OLED docked strip (FR-CE-2) — collapses to nothing (display:none) when
       the oled peripheral is disabled, so #design-area's flex:1 fills the
       space exactly as it does today; mirrors #convention-banner's toggle. */
    #oled-strip { display: none; flex-direction: column; align-items: center; justify-content: center; gap: 4px; height: 130px; flex-shrink: 0; background: #000; border-bottom: 1px solid #3c3c3c; position: relative; padding: 4px 0; }
    #oled-strip.enabled { display: flex; }
    #oled-strip-label { position: absolute; top: 5px; left: 8px; font-size: 9px; color: #6a6a6a; }
    #oled-popout-btn { position: absolute; top: 4px; right: 8px; background: #252526; border: 1px solid #555; color: #9cdcfe; padding: 2px 7px; border-radius: 2px; cursor: pointer; font-family: monospace; font-size: 9px; }
    #oled-popout-btn:hover { background: #2f2f2f; }
    #oled-strip-canvas { image-rendering: pixelated; background: #000; width: 192px; height: 96px; }
    #oled-strip-foot { font-size: 9px; color: #6a6a6a; }
    #design-area { display: flex; flex: 1; min-height: 0; overflow: hidden; }
    #palette { width: 140px; background: #252526; border-right: 1px solid #3c3c3c; padding: 10px 8px; display: flex; flex-direction: column; gap: 8px; flex-shrink: 0; overflow-y: auto; }
    .palette-title { font-size: 10px; color: #6a6a6a; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 2px; }
    .palette-item { padding: 7px 10px; border-radius: 4px; border: 1px solid #555; background: #3c3c3c; color: #d4d4d4; cursor: grab; user-select: none; font-size: 11px; text-align: center; }
    .palette-item:hover { background: #4a4a4a; }
${paletteCssRules()}
    #canvas-area { flex: 1; position: relative; overflow: auto; background: #1e1e1e; }
    #canvas-hint { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #3c3c3c; font-size: 13px; pointer-events: none; }
    .ctrl-card { position: absolute; min-width: 168px; background: #252526; border: 1px solid #555; border-radius: 4px; box-shadow: 0 2px 6px rgba(0,0,0,0.4); }
${ctrlCardCssRules()}
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
    .tgl-ce { background: #4a4a4a; border: 1px solid #666; border-radius: 4px; padding: 5px 10px; cursor: pointer; color: #d4d4d4; font-family: monospace; font-size: 12px; flex-shrink: 0; user-select: none; }
    .tgl-ce:hover { background: #5a5a5a; }
    .vled-dot { width: 12px; height: 12px; border-radius: 50%; background: #3c3c3c; border: 1px solid #555; box-shadow: none; display: inline-block; }
    .vled-dot.vled-lit { background: #f04a4a; border-color: #ff6a6a; box-shadow: 0 0 6px 1px #f04a4a; }
    .vrgb-dot { width: 14px; height: 14px; border-radius: 50%; background: #000; border: 1px solid #555; display: inline-block; }
    .enc-wrap { display: flex; flex-direction: column; align-items: center; gap: 3px; cursor: ns-resize; user-select: none; padding: 2px 4px; }
    .enc-value { color: #dcdcaa; font-size: 10px; font-family: monospace; min-width: 24px; text-align: center; }
    .section-label { color: #9cdcfe; align-self: center; }
    /* SD card content viewer (FR-SD-1) — inline accordion, mirrors the
       Wiring Editor's #peripherals section (.section-hdr/.periph rows). */
    #sdcard-contents { display: none; flex-direction: column; flex-shrink: 0; max-height: 260px; border-top: 1px solid #3c3c3c; overflow: auto; }
    #sdcard-contents .section-hdr { padding: 6px 14px; font-size: 11px; color: #9cdcfe; background: #252526; border-bottom: 1px solid #3c3c3c; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; }
    #sdcard-contents .section-hdr .count { color: #6a6a6a; font-weight: normal; }
    #sd-refresh-btn { background: #3c3c3c; border: 1px solid #555; color: #d4d4d4; padding: 2px 8px; border-radius: 2px; cursor: pointer; font-family: monospace; font-size: 10px; }
    #sd-refresh-btn:hover { background: #4a4a4a; }
    #sd-list { overflow: auto; }
    .sd-row { display: flex; align-items: center; gap: 8px; padding: 6px 14px; border-bottom: 1px solid #2a2a2a; cursor: pointer; }
    .sd-row:hover { background: #252526; }
    .sd-row .name { flex: 1; color: #d4d4d4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sd-row .size { color: #6a6a6a; font-size: 10px; }
    .sd-preview { padding: 8px 14px 10px 22px; background: #161616; border-bottom: 1px solid #2a2a2a; color: #ce9178; font-size: 11px; white-space: pre-wrap; word-break: break-word; }
    .sd-preview.unavailable { color: #6a6a6a; font-style: italic; }
    .sd-empty-state { padding: 16px 14px; text-align: center; color: #6a6a6a; font-size: 11px; }
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
  <div id="oled-strip">
    <span id="oled-strip-label">OLED preview</span>
    <button id="oled-popout-btn" title="Show in separate view">&#8599; Pop out</button>
    <canvas id="oled-strip-canvas" width="128" height="64"></canvas>
    <div id="oled-strip-foot">SSD1306 &middot; 128&times;64 &middot; &mdash;</div>
  </div>
  <div id="design-area">
    <div id="palette">
      <div class="palette-title">Palette</div>
${paletteItemsHtml()}
    </div>
    <div id="canvas-area">
      <div id="canvas-hint">Drag a control from the palette</div>
    </div>
  </div>
  <div id="sdcard-contents">
    <div class="section-hdr">
      <span>SD Card <span class="count" id="sd-count"></span></span>
      <button id="sd-refresh-btn" title="Refresh listing">&#x21bb; Refresh</button>
    </div>
    <div id="sd-list"></div>
  </div>
  <script id="yaml-init" type="application/json" nonce="${nonce}">${safeJson({ pots: [], buttons: [], leds: [], encoders: [], toggles: [], rgbleds: [] })}</script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
