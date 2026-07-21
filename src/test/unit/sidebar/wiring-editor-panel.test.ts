import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { WiringViewProvider } from '../../../sidebar/wiring-editor-panel';
import type { WirePinHandler, UnwirePinHandler } from '../../../wiring/wiring-panel';

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

describe('WiringViewProvider', () => {
  let onWirePin: ReturnType<typeof vi.fn>;
  let onUnwirePin: ReturnType<typeof vi.fn>;
  let provider: WiringViewProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    onWirePin   = vi.fn().mockResolvedValue(undefined);
    onUnwirePin = vi.fn().mockResolvedValue(undefined);
    provider = new WiringViewProvider(
      { fsPath: '/ext' } as unknown as vscode.Uri,
      onWirePin as unknown as WirePinHandler,
      onUnwirePin as unknown as UnwirePinHandler,
    );
  });

  it('resolveWebviewView sets enableScripts and localResourceRoots on webview options (FR-TWE-2)', () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    expect(view.webview.options).toMatchObject({
      enableScripts: true,
      localResourceRoots: [expect.anything()],
    });
  });

  it('resolveWebviewView sets HTML containing Daisy Seed Wiring', () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    expect(view.webview.html).toContain('Daisy Seed Wiring');
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

  it('resolveWebviewView registers onDidChangeVisibility on the view (FR-TWE-6)', () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    expect(view.onDidChangeVisibility).toHaveBeenCalled();
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

  it('calls onWirePin when wirePin message received', async () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    const handler = (view.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0] as (msg: unknown) => Promise<void>;
    await handler({ command: 'wirePin', pinNumber: 15, deviceType: 'pot', id: 'filter' });
    expect(onWirePin).toHaveBeenCalledWith({ pinNumber: 15, deviceType: 'pot', id: 'filter' });
  });

  // Regression test: this deviceType check used to be a hardcoded
  // 'pot'|'button'|'led' whitelist that silently dropped every M44 device
  // (toggle/rgbled/encoder never reached onWirePin, with no error shown —
  // FR-DEV-2 requires enumerating the registry instead).
  it.each(['toggle', 'rgbled', 'encoder'] as const)(
    'calls onWirePin for the M44 device kind %s (FR-DEV-2 regression)',
    async (deviceType) => {
      const view = makeWebviewViewMock();
      provider.resolveWebviewView(view as unknown as vscode.WebviewView);
      const handler = (view.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0] as (msg: unknown) => Promise<void>;
      await handler({ command: 'wirePin', pinNumber: 15, deviceType, id: 'x1' });
      expect(onWirePin).toHaveBeenCalledWith({ pinNumber: 15, deviceType, id: 'x1' });
    },
  );

  it('calls onUnwirePin when unwirePin message received', async () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    const handler = (view.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0] as (msg: unknown) => Promise<void>;
    await handler({ command: 'unwirePin', pinNumber: 15, id: 'filter' });
    expect(onUnwirePin).toHaveBeenCalledWith(15, 'filter');
  });

  it('ignores unknown or malformed messages', async () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    const handler = (view.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0] as (msg: unknown) => Promise<void>;
    await handler(null);
    await handler({ command: 'unknown' });
    expect(onWirePin).not.toHaveBeenCalled();
    expect(onUnwirePin).not.toHaveBeenCalled();
  });

  it('drops wirePin with pinNumber out of range 0–31 (FR-ES-2)', async () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    const handler = (view.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0] as (msg: unknown) => Promise<void>;
    await handler({ command: 'wirePin', pinNumber: 999, deviceType: 'pot', id: 'vol' });
    expect(onWirePin).not.toHaveBeenCalled();
  });

  it('drops wirePin with invalid deviceType (FR-ES-2)', async () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    const handler = (view.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0] as (msg: unknown) => Promise<void>;
    await handler({ command: 'wirePin', pinNumber: 15, deviceType: 'motor', id: 'vol' });
    expect(onWirePin).not.toHaveBeenCalled();
  });

  it('drops wirePin with invalid id (FR-ES-2)', async () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    const handler = (view.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0] as (msg: unknown) => Promise<void>;
    await handler({ command: 'wirePin', pinNumber: 15, deviceType: 'pot', id: 'foo.bar' });
    expect(onWirePin).not.toHaveBeenCalled();
  });

  it('postWiredPins sends wiredPins message to live-update the webview', () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    view.webview.postMessage.mockClear();
    const pins = [{ pinNumber: 15, deviceType: 'pot' as const, id: 'cutoff' }];
    provider.postWiredPins(pins);
    expect(view.webview.postMessage).toHaveBeenCalledWith({ command: 'wiredPins', pins });
  });

  it('postWiredPins before resolve stores pins for initial flush on resolve (FR-TWE-6)', () => {
    const pins = [{ pinNumber: 15, deviceType: 'pot' as const, id: 'cutoff' }];
    provider.postWiredPins(pins);

    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'wiredPins', pins }),
    );
  });

  // FR-TWE-6 — state restored when visibility becomes true
  it('re-sends wiredPins when view becomes visible after being hidden (FR-TWE-6)', () => {
    const pins = [{ pinNumber: 16, deviceType: 'button' as const, id: 'bypass' }];
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    provider.postWiredPins(pins);

    view.webview.postMessage.mockClear();
    view._simulateVisibilityChange(true);
    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'wiredPins', pins }),
    );
  });

  it('does not re-send wiredPins when visibility changes to false', () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    view.webview.postMessage.mockClear();
    view._simulateVisibilityChange(false);
    expect(view.webview.postMessage).not.toHaveBeenCalled();
  });
});
