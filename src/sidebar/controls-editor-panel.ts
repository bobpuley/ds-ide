import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { IpcMessage } from '../emulator/ipc-client';
import { getBoolean, getNumber } from '../ipc/narrow';
import { ControllerConfig, parseControllerConfig, serializeControllerConfig } from '../controllers/controller-config';
import { ControlsConfig } from '../webview/scope-panel';
import { REGISTRY, wiredControlIds, accentVar } from '../devices/registry';
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
import { themeCss } from '../webview/theme/theme-css';

// FR-EXT-33: the discriminated union's own command literals, kept as a
// runtime Set so hasKnownCommand can narrow an incoming postMessage payload
// to ControlsWebviewMessage; the switch below's `default: assertNever(...)`
// is what actually catches a missing case at compile time if this list and
// messages.ts's union ever drift.
const CONTROLS_WEBVIEW_COMMANDS = new Set<ControlsWebviewMessage['command']>([
  'webviewReady', 'editorSave', 'pot', 'button', 'toggle', 'encoder', 'sdRefresh', 'sdPreview', 'oledPopOut', 'focusWiring',
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
        case 'focusWiring': {
          void vscode.commands.executeCommand('ds-ide.focusWiring');
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

// FR-DEV-2: one CSS rule per registry entry for the on-canvas control card,
// so adding a device changes what's generated here without editing this file
// again. (FR-UDM-2: the Controls Editor no longer has a palette — devices are
// added in the Wiring Editor.)
function ctrlCardCssRules(): string {
  return wiredControlIds()
    .map(id => `    .ctrl-card[data-kind="${id}"] { --accent: ${accentVar(REGISTRY[id]!.id)}; }`)
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
${themeCss({ surface: 'sidebar' })}
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: var(--ds-surface); color: var(--ds-text); font-family: monospace; font-size: 12px; display: flex; flex-direction: column; height: 100vh; }
    #editor-toolbar { padding: 6px 12px; background: var(--ds-surface-raised); border-bottom: 1px solid var(--ds-border); display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
    #save-status { font-size: 11px; color: var(--ds-ok); }
    .tool-btn { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 22px; padding: 0; background: var(--ds-input-bg); border: 1px solid var(--ds-border); color: var(--ds-input-fg); border-radius: 2px; cursor: pointer; }
    .tool-btn svg { display: block; }
    .tool-btn:hover:not(:disabled) { background: var(--ds-hover-bg); }
    .tool-btn:disabled { opacity: .4; cursor: default; }
    #convention-banner { display: none; align-items: center; gap: 8px; padding: 5px 12px; background: var(--ds-warning-bg); border-bottom: 1px solid var(--ds-warning-border); color: var(--ds-warning-fg); font-size: 11px; flex-shrink: 0; }
    /* OLED docked strip (FR-CE-2) — collapses to nothing (display:none) when
       the oled peripheral is disabled, so #design-area's flex:1 fills the
       space exactly as it does today; mirrors #convention-banner's toggle. */
    #oled-strip { display: none; flex-direction: column; align-items: center; justify-content: center; gap: 4px; height: 130px; flex-shrink: 0; background: var(--ds-surface-raised); border-bottom: 1px solid var(--ds-border); position: relative; padding: 4px 0; }
    #oled-strip.enabled { display: flex; }
    #oled-strip-label { position: absolute; top: 5px; left: 8px; font-size: 9px; color: var(--ds-text-muted); }
    #oled-popout-btn { position: absolute; top: 4px; right: 8px; background: var(--ds-surface-raised); border: 1px solid var(--ds-border); color: var(--ds-text-muted); padding: 2px 7px; border-radius: 2px; cursor: pointer; font-family: monospace; font-size: 9px; }
    #oled-popout-btn:hover { background: var(--ds-hover-bg); }
    #oled-strip-canvas { image-rendering: pixelated; background: black; width: 192px; height: 96px; }
    #oled-strip-foot { font-size: 9px; color: var(--ds-text-muted); }
    #design-area { display: flex; flex: 1; min-height: 0; overflow: hidden; }
    #canvas-area { flex: 1; position: relative; overflow: auto; background: var(--ds-surface); }
    #canvas-hint { position: absolute; inset: 0; display: flex; flex-direction: column; gap: 8px; align-items: center; justify-content: center; color: var(--ds-text-muted); font-size: 13px; pointer-events: none; }
    #open-wiring-btn { pointer-events: auto; cursor: pointer; padding: 2px 10px; font: inherit; color: var(--ds-button-fg); background: var(--ds-button-bg); border: 1px solid var(--ds-border); border-radius: 2px; }
    /* FR-CWS-3: the palette chip's tile — themed frame, accent underline. */
    .ctrl-card { position: absolute; min-width: 132px; background: var(--ds-surface-raised); border: 1px solid var(--ds-border); border-radius: 8px; box-shadow: 0 2px 6px var(--ds-shadow); }
    .ctrl-card::after { content: ''; position: absolute; left: 22%; right: 22%; bottom: 2px; height: 2px; border-radius: 2px; background: var(--accent); opacity: .75; pointer-events: none; }
${ctrlCardCssRules()}
    .card-header { padding: 4px 6px 4px 8px; display: flex; align-items: center; justify-content: space-between; cursor: grab; background: var(--ds-surface); }
    .card-kind { font-size: 9px; color: var(--ds-text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
    .card-del { background: none; border: none; color: var(--ds-text-muted); cursor: pointer; font-size: 15px; padding: 0 2px; line-height: 1; }
    .card-del:hover { color: var(--ds-error); }
    .card-body { padding: 5px 8px 8px; display: flex; flex-direction: column; gap: 4px; }
    .card-field { display: flex; align-items: center; gap: 5px; }
    .card-field label { font-size: 10px; color: var(--ds-text-muted); min-width: 46px; }
    .card-inp { background: var(--ds-input-bg); color: var(--ds-input-fg); border: 1px solid var(--ds-border); padding: 2px 4px; font-family: monospace; font-size: 11px; flex: 1; min-width: 0; }
    .card-sel { background: var(--ds-input-bg); color: var(--ds-input-fg); border: 1px solid var(--ds-border); padding: 2px 4px; font-family: monospace; font-size: 11px; flex: 1; }
    .card-val { color: var(--ds-text); font-size: 11px; }
    .ctrl-handle { display: flex; align-items: center; gap: 6px; padding: 4px 6px 4px 8px; cursor: grab; background: var(--ds-surface); border-bottom: 1px solid var(--ds-border); user-select: none; }
    .ctrl-handle:active { cursor: grabbing; }
    .handle-glyph { color: var(--ds-text-muted); font-size: 13px; }
    .card-id-label { flex: 1; color: var(--ds-text); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .card-pin-label { color: var(--ds-text-muted); font-size: 10px; }
    .ctrl-body { padding: 6px 8px 8px; display: flex; align-items: center; justify-content: center; gap: 8px; flex-wrap: wrap; }
    .body-disabled { opacity: 0.35; pointer-events: none; }
    .knob-wrap { display: flex; flex-direction: column; align-items: center; gap: 3px; cursor: ns-resize; user-select: none; padding: 2px 4px; }
    /* Live illustrated widgets (FR-CWS-2): the art is the palette's; state arrives as
       CSS variables on the widget root and moves the art's data-part hooks. */
    svg.icon-live { width: 72px; height: 72px; display: block; }
    .btn-ce, .tgl-ce { background: none; border: none; padding: 0; margin: 0; color: var(--ds-text); font-family: monospace; cursor: pointer; flex-shrink: 0; user-select: none; }
    .btn-ce:focus-visible, .tgl-ce:focus-visible { outline: 1px solid var(--ds-focus); outline-offset: 2px; }
    .knob-wrap, .enc-wrap, .tgl-ce { display: flex; flex-direction: column; align-items: center; gap: 3px; }
    .knob-wrap, .enc-wrap { cursor: ns-resize; user-select: none; padding: 2px 4px; }
    .knob-value, .enc-value, .tgl-pos { color: var(--ds-text); font-size: 10px; font-family: monospace; min-width: 36px; text-align: center; }
    .vled-dot, .vrgb-dot { display: inline-block; }
    .knob-wrap [data-part="pointer"] { transform-box: view-box; transform-origin: 24px 26px; transform: rotate(calc(-135deg + var(--v, 0) * 270deg)); }
    .enc-wrap [data-part="pointer"] { transform-box: view-box; transform-origin: 24px 24px; transform: rotate(calc(var(--e, 0) * 11.25deg)); }
    .btn-ce[aria-pressed="true"] [data-part="cap"] { transform: translateY(2px); }
    .tgl-ce [data-part="lever"] { transform: translateY(calc(var(--p, 0) * 5px)); }
    .vled-dot [data-part="lens"] { opacity: 0.35; }
    .vled-dot [data-part="glow"] { opacity: 0.05; }
    .vled-dot.vled-lit [data-part="lens"] { opacity: 1; }
    .vled-dot.vled-lit [data-part="glow"] { opacity: 0.6; }
    .vrgb-dot [data-part="lens"] { fill: var(--c, black); fill-opacity: 1; opacity: var(--co, 0); }
    .section-label { color: var(--ds-text-muted); align-self: center; }
    /* SD card content viewer (FR-SD-1) — inline accordion, mirrors the
       Wiring Editor's #peripherals section (.section-hdr/.periph rows). */
    #sdcard-contents { display: none; flex-direction: column; flex-shrink: 0; max-height: 260px; border-top: 1px solid var(--ds-border); overflow: auto; }
    #sdcard-contents .section-hdr { padding: 6px 14px; font-size: 11px; color: var(--ds-text-muted); background: var(--ds-surface-raised); border-bottom: 1px solid var(--ds-border); display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; }
    #sdcard-contents .section-hdr .count { color: var(--ds-text-muted); font-weight: normal; }
    #sd-refresh-btn { background: var(--ds-input-bg); border: 1px solid var(--ds-border); color: var(--ds-input-fg); padding: 2px 8px; border-radius: 2px; cursor: pointer; font-family: monospace; font-size: 10px; }
    #sd-refresh-btn:hover { background: var(--ds-hover-bg); }
    #sd-list { overflow: auto; }
    .sd-row { display: flex; align-items: center; gap: 8px; padding: 6px 14px; border-bottom: 1px solid var(--ds-border); cursor: pointer; }
    .sd-row:hover { background: var(--ds-hover-bg); }
    .sd-row .name { flex: 1; color: var(--ds-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sd-row .size { color: var(--ds-text-muted); font-size: 10px; }
    .sd-preview { max-height: 160px; overflow: auto; padding: 8px 14px 10px 22px; background: var(--ds-input-bg); border-bottom: 1px solid var(--ds-border); color: var(--ds-text); font-size: 11px; white-space: pre-wrap; word-break: break-word; }
    .sd-preview.unavailable { color: var(--ds-text-muted); font-style: italic; }
    .sd-empty-state { padding: 16px 14px; text-align: center; color: var(--ds-text-muted); font-size: 11px; }
  </style>
</head>
<body>
  <div id="editor-toolbar">
    <span id="layout-tools" style="display:inline-flex;align-items:center;gap:6px">
      <button id="align-grid-btn" class="tool-btn" title="Align to grid — snap every card to a 20 px grid" aria-label="Align to grid"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2" width="5" height="5"/><rect x="9" y="2" width="5" height="5"/><rect x="2" y="9" width="5" height="5"/><rect x="9" y="9" width="5" height="5"/></svg></button>
      <button id="auto-arrange-btn" class="tool-btn" title="Auto-arrange — lay the cards out in tidy rows" aria-label="Auto-arrange"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 4h12M2 8h12M2 12h12"/></svg></button>
      <button id="reset-positions-btn" class="tool-btn" title="Reset positions — return every card to the default layout" aria-label="Reset positions"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8a5 5 0 1 0 1.6-3.7"/><path d="M3 2.5v3h3"/></svg></button>
    </span>
    <span id="save-wrap" style="display:inline-flex;align-items:center;gap:8px">
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
    <div id="canvas-area">
      <div id="canvas-hint">No controls yet &#8212; add devices in the Wiring Editor <button id="open-wiring-btn">Open Wiring Editor</button></div>
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
