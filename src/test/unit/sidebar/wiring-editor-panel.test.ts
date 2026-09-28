import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { WiringViewProvider } from '../../../sidebar/wiring-editor-panel';
import type { WirePinHandler, UnwirePinHandler, SetPeripheralEnabledHandler, ViewPeripheralHandler, RevealInCodeHandler } from '../../../wiring/wiring-panel';

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
  let onSetPeripheralEnabled: ReturnType<typeof vi.fn>;
  let onViewPeripheral: ReturnType<typeof vi.fn>;
  let onRevealInCode: ReturnType<typeof vi.fn>;
  let provider: WiringViewProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    onWirePin   = vi.fn().mockResolvedValue(undefined);
    onUnwirePin = vi.fn().mockResolvedValue(undefined);
    onSetPeripheralEnabled = vi.fn().mockResolvedValue(undefined);
    onViewPeripheral = vi.fn();
    onRevealInCode = vi.fn().mockResolvedValue(undefined);
    provider = new WiringViewProvider(
      { fsPath: '/ext' } as unknown as vscode.Uri,
      onWirePin as unknown as WirePinHandler,
      onUnwirePin as unknown as UnwirePinHandler,
      onSetPeripheralEnabled as unknown as SetPeripheralEnabledHandler,
      onViewPeripheral as unknown as ViewPeripheralHandler,
      onRevealInCode as unknown as RevealInCodeHandler,
    );
  });

  // ── FR-UDM-4: Reveal in code ────────────────────────────────────────────
  it('calls onRevealInCode for a revealInCode message (FR-UDM-4)', async () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    const handler = (view.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0] as (msg: unknown) => Promise<void>;
    await handler({ command: 'revealInCode', id: 'vol' });
    await handler({ command: 'revealInCode', id: 'oled' });
    expect(onRevealInCode).toHaveBeenNthCalledWith(1, 'vol');
    expect(onRevealInCode).toHaveBeenNthCalledWith(2, 'oled');
  });

  it('drops revealInCode with a missing or non-identifier id (FR-UDM-4)', async () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    const handler = (view.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0] as (msg: unknown) => Promise<void>;
    await handler({ command: 'revealInCode' });
    await handler({ command: 'revealInCode', id: 42 });
    await handler({ command: 'revealInCode', id: 'x; rm -rf' });
    expect(onRevealInCode).not.toHaveBeenCalled();
  });

  it('surfaces a thrown revealInCode error via showErrorMessage (FR-UDM-4)', async () => {
    onRevealInCode.mockRejectedValue(new Error('boom'));
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    const handler = (view.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0] as (msg: unknown) => Promise<void>;
    await expect(handler({ command: 'revealInCode', id: 'vol' })).resolves.toBeUndefined();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('boom'));
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
    expect(onWirePin).toHaveBeenCalledWith({ pinNumber: 15, deviceType: 'pot', id: 'filter' }, undefined);
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
      expect(onWirePin).toHaveBeenCalledWith({ pinNumber: 15, deviceType, id: 'x1' }, undefined);
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

  // ── Peripherals (FR-DEV-11) ────────────────────────────────────────────────

  it('calls onSetPeripheralEnabled when setPeripheralEnabled message received', async () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    const handler = (view.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0] as (msg: unknown) => Promise<void>;
    await handler({ command: 'setPeripheralEnabled', peripheralId: 'sdcard', enabled: true });
    expect(onSetPeripheralEnabled).toHaveBeenCalledWith('sdcard', true, undefined, undefined);
  });

  it('passes a dropped lane\'s bus through to onSetPeripheralEnabled (FR-UDM-7)', async () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    const handler = (view.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0] as (msg: unknown) => Promise<void>;
    await handler({ command: 'setPeripheralEnabled', peripheralId: 'oled', enabled: true, bus: 'I2C1' });
    expect(onSetPeripheralEnabled).toHaveBeenCalledWith('oled', true, 'I2C1', undefined);
  });

  it('passes a replace list through, and drops a malformed one (FR-UDM-8)', async () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    const handler = (view.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0] as (msg: unknown) => Promise<void>;
    await handler({ command: 'wirePin', pinNumber: 15, deviceType: 'button', id: 'b1', replace: ['vol'] });
    expect(onWirePin).toHaveBeenCalledWith({ pinNumber: 15, deviceType: 'button', id: 'b1' }, ['vol']);
    await handler({ command: 'setPeripheralEnabled', peripheralId: 'oled', enabled: true, bus: 'I2C1', replace: ['b1', 'l1'] });
    expect(onSetPeripheralEnabled).toHaveBeenCalledWith('oled', true, 'I2C1', ['b1', 'l1']);
    onWirePin.mockClear();
    await handler({ command: 'wirePin', pinNumber: 15, deviceType: 'button', id: 'b1', replace: ['a b'] });
    await handler({ command: 'wirePin', pinNumber: 15, deviceType: 'button', id: 'b1', replace: Array(17).fill('x') });
    expect(onWirePin).not.toHaveBeenCalled();
  });

  it('drops setPeripheralEnabled with a bus outside the peripheral\'s candidates (FR-UDM-7)', async () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    const handler = (view.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0] as (msg: unknown) => Promise<void>;
    await handler({ command: 'setPeripheralEnabled', peripheralId: 'sdcard', enabled: true, bus: 'SPI1' });
    await handler({ command: 'setPeripheralEnabled', peripheralId: 'oled', enabled: true, bus: 7 });
    expect(onSetPeripheralEnabled).not.toHaveBeenCalled();
  });

  it('drops setPeripheralEnabled for an unknown peripheral id', async () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    const handler = (view.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0] as (msg: unknown) => Promise<void>;
    await handler({ command: 'setPeripheralEnabled', peripheralId: 'pot', enabled: true });
    expect(onSetPeripheralEnabled).not.toHaveBeenCalled();
  });

  it('drops setPeripheralEnabled with a non-boolean enabled value', async () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    const handler = (view.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0] as (msg: unknown) => Promise<void>;
    await handler({ command: 'setPeripheralEnabled', peripheralId: 'sdcard', enabled: 'yes' });
    expect(onSetPeripheralEnabled).not.toHaveBeenCalled();
  });

  it('postPeripherals sends a peripherals message to live-update the webview', () => {
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    view.webview.postMessage.mockClear();
    const peripherals = [{ id: 'sdcard', label: 'SD Card', enabled: true, bus: 'SDMMC1', pins: [1, 2, 3, 4, 5, 6].map(pin => ({ pin, signal: null })) }];
    provider.postPeripherals(peripherals);
    expect(view.webview.postMessage).toHaveBeenCalledWith({ command: 'peripherals', peripherals });
  });

  it('re-sends peripherals when view becomes visible after being hidden', () => {
    const peripherals = [{ id: 'sdcard', label: 'SD Card', enabled: true, bus: 'SDMMC1', pins: [1, 2, 3, 4, 5, 6].map(pin => ({ pin, signal: null })) }];
    const view = makeWebviewViewMock();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    provider.postPeripherals(peripherals);

    view.webview.postMessage.mockClear();
    view._simulateVisibilityChange(true);
    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'peripherals', peripherals }),
    );
  });

  // ── FR-EXT-8: the async message handler must not produce an unhandled
  // rejection when a file-I/O-performing handler throws ─────────────────────

  describe('message handler error guarding (FR-EXT-8)', () => {
    it('surfaces a thrown wirePin error via showErrorMessage instead of rejecting', async () => {
      onWirePin.mockRejectedValue(new Error('EACCES: permission denied'));
      const view = makeWebviewViewMock();
      provider.resolveWebviewView(view as unknown as vscode.WebviewView);
      const handler = (view.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0] as (msg: unknown) => Promise<void>;
      await expect(handler({ command: 'wirePin', pinNumber: 15, deviceType: 'pot', id: 'vol' })).resolves.toBeUndefined();
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('EACCES: permission denied'),
      );
    });

    it('surfaces a thrown unwirePin error via showErrorMessage instead of rejecting', async () => {
      onUnwirePin.mockRejectedValue(new Error('EACCES: permission denied'));
      const view = makeWebviewViewMock();
      provider.resolveWebviewView(view as unknown as vscode.WebviewView);
      const handler = (view.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0] as (msg: unknown) => Promise<void>;
      await expect(handler({ command: 'unwirePin', pinNumber: 15, id: 'vol' })).resolves.toBeUndefined();
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('EACCES: permission denied'),
      );
    });

    it('surfaces a thrown setPeripheralEnabled error via showErrorMessage instead of rejecting', async () => {
      onSetPeripheralEnabled.mockRejectedValue(new Error('EACCES: permission denied'));
      const view = makeWebviewViewMock();
      provider.resolveWebviewView(view as unknown as vscode.WebviewView);
      const handler = (view.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0] as (msg: unknown) => Promise<void>;
      await expect(handler({ command: 'setPeripheralEnabled', peripheralId: 'sdcard', enabled: true })).resolves.toBeUndefined();
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('EACCES: permission denied'),
      );
    });
  });
});
