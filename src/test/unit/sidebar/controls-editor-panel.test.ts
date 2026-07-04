import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { ControlsViewProvider, truncId } from '../../../sidebar/controls-editor-panel';

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
  let provider: ControlsViewProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    onEditorSave  = vi.fn();
    onPotChange   = vi.fn();
    onButtonChange = vi.fn();
    provider = new ControlsViewProvider(
      { fsPath: '/ext' } as unknown as vscode.Uri,
      onEditorSave, onPotChange, onButtonChange,
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

  it('calls onEditorSave with valid cfg when editorSave message received', () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    const handler = (view.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0] as (msg: unknown) => void;
    const cfg = { pots: [], buttons: [], leds: [], errors: [] };
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
    const cfg = { pots: [], buttons: [], leds: [], errors: [] };
    provider.loadEditor(cfg);
    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'editorLoad', cfg }),
    );
  });

  // FR-TWE-6 — state restoration on initial resolve
  it('flushes last-known state to webview on resolveWebviewView (FR-TWE-6)', () => {
    const editorCfg = { pots: [], buttons: [], leds: [], errors: [] };
    const config = { controls: [], placements: [], missingBlock: false };
    const status = { type: 'status', running: false };

    provider.loadEditor(editorCfg);
    provider.postControlsConfig(config);
    provider.postStatus(status as never);

    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    const calls = view.webview.postMessage.mock.calls.map((c: unknown[]) => (c[0] as Record<string, unknown>).command);
    expect(calls).toContain('editorLoad');
    expect(calls).toContain('controlsConfig');
    expect(calls).toContain('status');
  });

  it('flushes editorLoad before controlsConfig on resolve (FR-TWE-6)', () => {
    const editorCfg = { pots: [], buttons: [], leds: [], errors: [] };
    const config = { controls: [], placements: [], missingBlock: false };
    provider.loadEditor(editorCfg);
    provider.postControlsConfig(config);

    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    const calls = view.webview.postMessage.mock.calls.map((c: unknown[]) => (c[0] as Record<string, unknown>).command);
    const editorIdx = calls.indexOf('editorLoad');
    const configIdx = calls.indexOf('controlsConfig');
    expect(editorIdx).toBeGreaterThanOrEqual(0);
    expect(configIdx).toBeGreaterThan(editorIdx);
  });

  it('webviewReady message triggers flush of pending state', () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    const editorCfg = { pots: [], buttons: [], leds: [], errors: [] };
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
    const editorCfg = { pots: [], buttons: [], leds: [], errors: [] };
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    provider.loadEditor(editorCfg);

    view.webview.postMessage.mockClear();
    view._simulateVisibilityChange(true);
    const calls = view.webview.postMessage.mock.calls.map((c: unknown[]) => (c[0] as Record<string, unknown>).command);
    expect(calls).toContain('editorLoad');
  });

  it('does not flush state when visibility changes to false (FR-TWE-6)', () => {
    const editorCfg = { pots: [], buttons: [], leds: [], errors: [] };
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
    expect(view.webview.html).toContain('box-shadow: 0 3px 0 #111');
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
