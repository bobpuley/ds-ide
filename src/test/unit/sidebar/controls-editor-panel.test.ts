import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { ControlsViewProvider, truncId, buildHtml } from '../../../sidebar/controls-editor-panel';
import { themeCss } from '../../../webview/theme/theme-css';

function makeWebviewViewMock() {
  const onDisposeHandlers: Array<() => void> = [];
  const onVisibilityHandlers: Array<() => void> = [];

  const webview = {
    html: '',
    options: {} as vscode.WebviewOptions,
    onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
    postMessage: vi.fn(),
    asWebviewUri: vi.fn((uri: unknown) => uri),
    cspSource: 'vscode-resource:',
  };

  const view = {
    webview,
    visible: true,
    onDidDispose: vi.fn((cb: () => void) => {
      onDisposeHandlers.push(cb);
      return { dispose: vi.fn() };
    }),
    onDidChangeVisibility: vi.fn((cb: () => void) => {
      onVisibilityHandlers.push(cb);
      return { dispose: vi.fn() };
    }),
    show: vi.fn(),
    _simulateDispose: () => onDisposeHandlers.forEach(h => h()),
    _simulateVisibilityChange: (visible: boolean) => {
      view.visible = visible;
      onVisibilityHandlers.forEach(h => h());
    },
  };

  return view;
}

describe('ControlsViewProvider', () => {
  let onEditorSave: ReturnType<typeof vi.fn>;
  let onPotChange: ReturnType<typeof vi.fn>;
  let onButtonChange: ReturnType<typeof vi.fn>;
  let onToggleChange: ReturnType<typeof vi.fn>;
  let onEncoderChange: ReturnType<typeof vi.fn>;
  let onSdRefresh: ReturnType<typeof vi.fn>;
  let onSdPreview: ReturnType<typeof vi.fn>;
  let onOledPopOut: ReturnType<typeof vi.fn>;
  let provider: ControlsViewProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    onEditorSave  = vi.fn();
    onPotChange   = vi.fn();
    onButtonChange = vi.fn();
    onToggleChange = vi.fn();
    onEncoderChange = vi.fn();
    onSdRefresh = vi.fn();
    onSdPreview = vi.fn();
    onOledPopOut = vi.fn();
    provider = new ControlsViewProvider(
      { fsPath: '/ext' } as unknown as vscode.Uri,
      onEditorSave, onPotChange, onButtonChange, onToggleChange, onEncoderChange,
      onSdRefresh, onSdPreview, onOledPopOut,
    );
  });

  it('resolveWebviewView sets enableScripts and localResourceRoots on webview options (FR-TWE-1)', () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    expect(view.webview.options).toMatchObject({
      enableScripts: true,
      localResourceRoots: [expect.anything()],
    });
  });

  it('resolveWebviewView sets HTML containing DS-IDE Controls title', () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    expect(view.webview.html).toContain('DS-IDE Controls');
  });

  it('resolveWebviewView sets HTML with CSP meta tag and nonce (FR-ES-1)', () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    expect(view.webview.html).toContain('<meta http-equiv="Content-Security-Policy"');
    expect(view.webview.html).toContain('nonce-');
  });

  it('resolveWebviewView sets HTML with script nonce matching CSP (FR-ES-1)', () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    const html = view.webview.html;
    const nonceMatch = html.match(/nonce-([^'";]+)/);
    expect(nonceMatch).toBeTruthy();
    const nonce = nonceMatch![1];
    expect(html).toContain(`<script nonce="${nonce}" src=`);
  });

  it('resolveWebviewView registers onDidReceiveMessage on the webview', () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    expect(view.webview.onDidReceiveMessage).toHaveBeenCalled();
  });

  it('resolveWebviewView registers onDidChangeVisibility on the view', () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    expect(view.onDidChangeVisibility).toHaveBeenCalled();
  });

  it('resolveWebviewView registers onDidDispose on the view', () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    expect(view.onDidDispose).toHaveBeenCalled();
  });

  it('isVisible is true while view is visible, false before resolve', () => {
    expect(provider.isVisible).toBe(false);
    const view = makeWebviewViewMock();
    view.visible = true;
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    expect(provider.isVisible).toBe(true);
  });

  it('isVisible becomes false after view is disposed', () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    view._simulateDispose();
    expect(provider.isVisible).toBe(false);
  });

  it('calls onPotChange when pot message received', () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    const handler = (view.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0] as (msg: unknown) => void;
    handler({ command: 'pot', channel: 2, value: 0.75 });
    expect(onPotChange).toHaveBeenCalledWith(2, 0.75);
  });

  it('calls onButtonChange when button message received', () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    const handler = (view.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0] as (msg: unknown) => void;
    handler({ command: 'button', gpioPin: 28, pressed: true });
    expect(onButtonChange).toHaveBeenCalledWith(28, true);
  });

  it('calls onToggleChange when toggle message received (FR-DEV-7)', () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    const handler = (view.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0] as (msg: unknown) => void;
    handler({ command: 'toggle', gpioPin: 5, position: 2 });
    expect(onToggleChange).toHaveBeenCalledWith(5, 2);
  });

  it('drops a toggle message with an out-of-range position', () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    const handler = (view.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0] as (msg: unknown) => void;
    handler({ command: 'toggle', gpioPin: 5, position: 3 });
    handler({ command: 'toggle', gpioPin: 5, position: -1 });
    handler({ command: 'toggle', gpioPin: 5, position: 1.5 });
    expect(onToggleChange).not.toHaveBeenCalled();
  });

  it('calls onEncoderChange when encoder message received (FR-DEV-9)', () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    const handler = (view.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0] as (msg: unknown) => void;
    handler({ command: 'encoder', gpioPin: 5, position: 42 });
    expect(onEncoderChange).toHaveBeenCalledWith(5, 42);
  });

  it('drops an encoder message with an out-of-range position', () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    const handler = (view.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0] as (msg: unknown) => void;
    handler({ command: 'encoder', gpioPin: 5, position: -1 });
    handler({ command: 'encoder', gpioPin: 5, position: 1024 });
    handler({ command: 'encoder', gpioPin: 5, position: 1.5 });
    expect(onEncoderChange).not.toHaveBeenCalled();
  });

  it('calls onEditorSave with valid cfg when editorSave message received', () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    const handler = (view.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0] as (msg: unknown) => void;
    const cfg = { pots: [], buttons: [], leds: [], encoders: [], toggles: [], rgbleds: [], errors: [] };
    handler({ command: 'editorSave', cfg });
    expect(onEditorSave).toHaveBeenCalledWith(expect.objectContaining({ pots: [], buttons: [], leds: [] }));
  });

  it('drops editorSave with malformed cfg (FR-ES-2)', () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    const handler = (view.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0] as (msg: unknown) => void;
    const cfg = { pots: [{ id: '', label: '', adcChannel: -99, range: [0, 1], taper: 'linear', default: 0.5, errors: [] }], buttons: [], leds: [], errors: [] };
    handler({ command: 'editorSave', cfg });
    expect(onEditorSave).not.toHaveBeenCalled();
  });

  it('does not throw and shows a warning when editorSave cfg has grossly malformed shape (FR-IPC-3)', () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    const handler = (view.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0] as (msg: unknown) => void;
    const warnSpy = vscode.window.showWarningMessage as ReturnType<typeof vi.fn>;
    warnSpy.mockClear();
    expect(() => handler({ command: 'editorSave', cfg: { pots: [{}] } })).not.toThrow();
    expect(onEditorSave).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('ignores malformed messages', () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    const handler = (view.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0] as (msg: unknown) => void;
    handler(null);
    handler({ command: 'pot' }); // missing channel/value
    handler({ command: 'button', gpioPin: 28 }); // missing pressed
    expect(onPotChange).not.toHaveBeenCalled();
    expect(onButtonChange).not.toHaveBeenCalled();
  });

  it('postControlsConfig sends controlsConfig message to webview', () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    view.webview.postMessage.mockClear();
    const config = { controls: [], placements: [], missingBlock: false };
    provider.postControlsConfig(config);
    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'controlsConfig' }),
    );
  });

  it('postStatus sends status message to webview', () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    view.webview.postMessage.mockClear();
    provider.postStatus({ type: 'status', running: true, sampleRate: 48000, blockSize: 256 });
    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'status', running: true }),
    );
  });

  it('does not forward unwhitelisted fields on a status message to the webview (FR-IPC-2)', () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    view.webview.postMessage.mockClear();
    provider.postStatus({ type: 'status', running: true, evil: '<img src=x onerror=alert(1)>' });
    const call = (view.webview.postMessage as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>)['command'] === 'status',
    );
    expect(call![0]).not.toHaveProperty('evil');
  });

  it('does not forward unwhitelisted lastStatus fields when flushing on resolve (FR-IPC-2)', () => {
    provider.postStatus({ type: 'status', running: true, evil: '<img src=x onerror=alert(1)>' });
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    const call = (view.webview.postMessage as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>)['command'] === 'status',
    );
    expect(call![0]).not.toHaveProperty('evil');
  });

  it('postLed forwards gpioPin and lit to webview', () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    view.webview.postMessage.mockClear();
    provider.postLed({ type: 'led', gpioPin: 23, lit: true });
    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'led', gpioPin: 23, lit: true }),
    );
  });

  it('loadEditor sends editorLoad message to webview', () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    view.webview.postMessage.mockClear();
    const cfg = { pots: [], buttons: [], leds: [], encoders: [], toggles: [], rgbleds: [], errors: [] };
    provider.loadEditor(cfg);
    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'editorLoad', cfg }),
    );
  });

  // FR-TWE-6 — state restoration on initial resolve
  it('flushes last-known state to webview on resolveWebviewView (FR-TWE-6)', () => {
    const editorCfg = { pots: [], buttons: [], leds: [], encoders: [], toggles: [], rgbleds: [], errors: [] };
    const config = { controls: [], placements: [], missingBlock: false };
    const status = { type: 'status', running: false };

    provider.loadEditor(editorCfg);
    provider.postControlsConfig(config);
    provider.postStatus(status as never);

    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    const calls = view.webview.postMessage.mock.calls.map((c: unknown[]) => (c[0] as Record<string, unknown>)['command']);
    expect(calls).toContain('editorLoad');
    expect(calls).toContain('controlsConfig');
    expect(calls).toContain('status');
  });

  it('flushes editorLoad before controlsConfig on resolve (FR-TWE-6)', () => {
    const editorCfg = { pots: [], buttons: [], leds: [], encoders: [], toggles: [], rgbleds: [], errors: [] };
    const config = { controls: [], placements: [], missingBlock: false };
    provider.loadEditor(editorCfg);
    provider.postControlsConfig(config);

    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    const calls = view.webview.postMessage.mock.calls.map((c: unknown[]) => (c[0] as Record<string, unknown>)['command']);
    const editorIdx = calls.indexOf('editorLoad');
    const configIdx = calls.indexOf('controlsConfig');
    expect(editorIdx).toBeGreaterThanOrEqual(0);
    expect(configIdx).toBeGreaterThan(editorIdx);
  });

  it('webviewReady message triggers flush of pending state', () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    const editorCfg = { pots: [], buttons: [], leds: [], encoders: [], toggles: [], rgbleds: [], errors: [] };
    provider.loadEditor(editorCfg);
    view.webview.postMessage.mockClear();

    const handler = (view.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0] as (msg: unknown) => void;
    handler({ command: 'webviewReady' });
    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'editorLoad' }),
    );
  });

  // FR-TWE-6 — state restored when visibility becomes true
  it('flushes state again when view becomes visible after being hidden (FR-TWE-6)', () => {
    const editorCfg = { pots: [], buttons: [], leds: [], encoders: [], toggles: [], rgbleds: [], errors: [] };
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    provider.loadEditor(editorCfg);

    view.webview.postMessage.mockClear();
    view._simulateVisibilityChange(true);
    const calls = view.webview.postMessage.mock.calls.map((c: unknown[]) => (c[0] as Record<string, unknown>)['command']);
    expect(calls).toContain('editorLoad');
  });

  it('does not flush state when visibility changes to false (FR-TWE-6)', () => {
    const editorCfg = { pots: [], buttons: [], leds: [], encoders: [], toggles: [], rgbleds: [], errors: [] };
    provider.loadEditor(editorCfg);
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    view.webview.postMessage.mockClear();
    view._simulateVisibilityChange(false);
    expect(view.webview.postMessage).not.toHaveBeenCalled();
  });

  it('HTML includes justify-content: center on ctrl-body', () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    expect(view.webview.html).toContain('justify-content: center');
  });

  it('HTML includes box-shadow on btn-ce', () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    expect(view.webview.html).toContain('box-shadow: 0 3px 0 var(--ds-border)');
  });

  // ── SD card content viewer (FR-SD-1) ──────────────────────────────────

  it('calls onSdRefresh when sdRefresh message received', () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    const handler = (view.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0] as (msg: unknown) => void;
    handler({ command: 'sdRefresh' });
    expect(onSdRefresh).toHaveBeenCalled();
  });

  it('calls onSdRefresh on webviewReady (initial load) and on regaining visibility', () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    const handler = (view.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0] as (msg: unknown) => void;
    onSdRefresh.mockClear();
    handler({ command: 'webviewReady' });
    expect(onSdRefresh).toHaveBeenCalledTimes(1);
    view._simulateVisibilityChange(true);
    expect(onSdRefresh).toHaveBeenCalledTimes(2);
  });

  it('does not call onSdRefresh when visibility changes to false', () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    onSdRefresh.mockClear();
    view._simulateVisibilityChange(false);
    expect(onSdRefresh).not.toHaveBeenCalled();
  });

  it('calls onSdPreview with the requested name when sdPreview message received', () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    const handler = (view.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0] as (msg: unknown) => void;
    handler({ command: 'sdPreview', name: 'LOG.TXT' });
    expect(onSdPreview).toHaveBeenCalledWith('LOG.TXT');
  });

  it('ignores an sdPreview message with a non-string name', () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    const handler = (view.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0] as (msg: unknown) => void;
    handler({ command: 'sdPreview', name: 42 });
    expect(onSdPreview).not.toHaveBeenCalled();
  });

  it('postSdCardEnabled sends sdCardEnabled message to webview', () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    view.webview.postMessage.mockClear();
    provider.postSdCardEnabled(true);
    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'sdCardEnabled', enabled: true }),
    );
  });

  it('postSdContents sends sdContents message to webview', () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    view.webview.postMessage.mockClear();
    const entries = [{ name: 'LOG.TXT', size: 96 }];
    provider.postSdContents(entries);
    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'sdContents', entries }),
    );
  });

  it('postSdPreview sends sdPreview message to webview', () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    view.webview.postMessage.mockClear();
    provider.postSdPreview('LOG.TXT', 'hello\n');
    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'sdPreview', name: 'LOG.TXT', content: 'hello\n' }),
    );
  });

  it('flushes sdCardEnabled and sdContents on resolve after being set pre-resolve', () => {
    provider.postSdCardEnabled(true);
    provider.postSdContents([{ name: 'LOG.TXT', size: 96 }]);
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    const calls = view.webview.postMessage.mock.calls.map((c: unknown[]) => (c[0] as Record<string, unknown>)['command']);
    expect(calls).toContain('sdCardEnabled');
    expect(calls).toContain('sdContents');
  });

  // ── OLED docked strip (FR-CE-2) ────────────────────────────────────────

  it('resolveWebviewView sets HTML containing the OLED strip markup', () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    expect(view.webview.html).toContain('id="oled-strip"');
    expect(view.webview.html).toContain('id="oled-popout-btn"');
  });

  it('postOledEnabled sends oledEnabled message with enabled and bus to webview', () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    view.webview.postMessage.mockClear();
    provider.postOledEnabled(true, 'SPI1');
    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'oledEnabled', enabled: true, bus: 'SPI1' }),
    );
  });

  it('postOledFrame sends oledFrame message with data to webview', () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    view.webview.postMessage.mockClear();
    provider.postOledFrame('AAECAw==');
    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'oledFrame', data: 'AAECAw==' }),
    );
  });

  it('calls onOledPopOut when oledPopOut message received', () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    const handler = (view.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0] as (msg: unknown) => void;
    handler({ command: 'oledPopOut' });
    expect(onOledPopOut).toHaveBeenCalled();
  });

  it('flushes oledEnabled and the last frame on resolve after being set pre-resolve', () => {
    provider.postOledEnabled(true, 'SPI1');
    provider.postOledFrame('AAECAw==');
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    const calls = view.webview.postMessage.mock.calls.map((c: unknown[]) => (c[0] as Record<string, unknown>)['command']);
    expect(calls).toContain('oledEnabled');
    expect(calls).toContain('oledFrame');
  });

  it('does not flush an oledFrame on resolve when no frame has been received yet', () => {
    provider.postOledEnabled(false, null);
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    const calls = view.webview.postMessage.mock.calls.map((c: unknown[]) => (c[0] as Record<string, unknown>)['command']);
    expect(calls).not.toContain('oledFrame');
  });
});

describe('truncId', () => {
  it('returns id unchanged when 15 chars or fewer', () => {
    expect(truncId('short')).toBe('short');
    expect(truncId('exactly15chars!')).toBe('exactly15chars!');
  });

  it('truncates to 14 chars + ellipsis when id exceeds 15 chars', () => {
    const result = truncId('tap_tempo_sync_btn');
    expect(result).toBe('tap_tempo_sync…');
    expect(result.length).toBe(15);
  });

  it('truncates id of exactly 16 chars', () => {
    const result = truncId('1234567890123456');
    expect(result).toBe('12345678901234…');
  });
});

// FR-UDM-2: the Controls Editor only lays out already-wired controls — its
// palette (which silently dropped toggle/rgbled/encoder) is gone, and the
// empty-canvas hint points to the Wiring Editor instead.
describe('Controls Editor palette removal (FR-UDM-2)', () => {
  const html = buildHtml('test-nonce', 'vscode-resource://x.js');

  it('renders no palette or draggable palette item', () => {
    expect(html).not.toContain('id="palette"');
    expect(html).not.toContain('palette-item');
    expect(html).not.toContain('draggable="true"');
  });

  it('empty-canvas hint points to the Wiring Editor', () => {
    expect(html).toContain('id="canvas-hint"');
    expect(html).not.toContain('Drag a control from the palette');
    expect(html).toMatch(/id="canvas-hint">[^<]*Wiring Editor/);
  });
});

describe('Controls Editor theming (FR-THM-1, FR-THM-3, FR-THM-4)', () => {
  const html = buildHtml('test-nonce', 'vscode-resource://x.js');
  const own = html.replace(themeCss({ surface: 'sidebar' }), '');

  it('includes the shared sidebar-surface theme block', () => {
    expect(html).toContain(themeCss({ surface: 'sidebar' }));
    expect(html).toContain('background: var(--ds-surface)');
  });

  it('has no hex / rgb() / hsl() colour literals of its own', () => {
    expect(own).not.toMatch(/(?<![&\w])#[0-9a-fA-F]{3,8}\b/);
    expect(own).not.toMatch(/\brgba?\(|\bhsla?\(/);
  });

  it('colours the lit virtual LED from the led accent', () => {
    expect(html).toMatch(/\.vled-lit\s*\{[^}]*var\(--ds-accent-led\)/);
  });

  it('keeps the docked OLED glass black inside a themed frame', () => {
    expect(html).toMatch(/#oled-strip-canvas\s*\{[^}]*background:\s*black/);
    expect(html).toMatch(/#oled-strip\s*\{[^}]*var\(--ds-surface-raised\)/);
  });
});
