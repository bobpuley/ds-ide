import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WiringViewProvider } from '../../../sidebar/wiring-view-provider';

function makeView(visible = true) {
  const onMsgHandlers: ((msg: unknown) => Promise<void> | void)[] = [];
  const onVisHandlers: (() => void)[] = [];
  const view = {
    get visible() { return _visible; },
    webview: {
      options: {} as Record<string, unknown>,
      html: '',
      postMessage: vi.fn(),
      onDidReceiveMessage: vi.fn((cb: (msg: unknown) => void) => {
        onMsgHandlers.push(cb);
        return { dispose: vi.fn() };
      }),
    },
    onDidChangeVisibility: vi.fn((cb: () => void) => {
      onVisHandlers.push(cb);
      return { dispose: vi.fn() };
    }),
    _triggerMessage: async (msg: unknown) => {
      for (const h of onMsgHandlers) await h(msg);
    },
    _setVisible: (v: boolean) => {
      _visible = v;
      onVisHandlers.forEach(h => h());
    },
  };
  let _visible = visible;
  return view;
}

describe('WiringViewProvider', () => {
  let onWirePin: ReturnType<typeof vi.fn>;
  let onUnwirePin: ReturnType<typeof vi.fn>;
  let provider: WiringViewProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    onWirePin = vi.fn().mockResolvedValue(undefined);
    onUnwirePin = vi.fn().mockResolvedValue(undefined);
    provider = new WiringViewProvider(onWirePin, onUnwirePin);
  });

  it('resolveWebviewView sets html and enables scripts', () => {
    const view = makeView();
    provider.resolveWebviewView(view as never);
    expect(view.webview.options).toMatchObject({ enableScripts: true });
    expect(view.webview.html).toContain('Daisy Seed Wiring');
  });

  it('resolveWebviewView sets localResourceRoots: [] (FR-ES-1)', () => {
    const view = makeView();
    provider.resolveWebviewView(view as never);
    expect(view.webview.options).toMatchObject({ localResourceRoots: [] });
  });

  it('webview HTML includes CSP meta tag with nonce (FR-ES-1)', () => {
    const view = makeView();
    provider.resolveWebviewView(view as never);
    expect(view.webview.html).toContain('<meta http-equiv="Content-Security-Policy"');
    expect(view.webview.html).toContain('nonce-');
  });

  it('webview HTML script tag has nonce attribute matching CSP (FR-ES-1)', () => {
    const view = makeView();
    provider.resolveWebviewView(view as never);
    const html = view.webview.html;
    const nonceMatch = html.match(/nonce-([^'";]+)/);
    expect(nonceMatch).toBeTruthy();
    const nonce = nonceMatch![1];
    expect(html).toContain(`<script nonce="${nonce}">`);
  });

  it('calls onWirePin when wirePin message received', async () => {
    const view = makeView();
    provider.resolveWebviewView(view as never);
    await view._triggerMessage({ command: 'wirePin', pinNumber: 15, deviceType: 'pot', id: 'filter' });
    expect(onWirePin).toHaveBeenCalledWith({ pinNumber: 15, deviceType: 'pot', id: 'filter' });
  });

  it('calls onUnwirePin when unwirePin message received', async () => {
    const view = makeView();
    provider.resolveWebviewView(view as never);
    await view._triggerMessage({ command: 'unwirePin', pinNumber: 15, id: 'filter' });
    expect(onUnwirePin).toHaveBeenCalledWith(15, 'filter');
  });

  it('ignores unknown or malformed messages', async () => {
    const view = makeView();
    provider.resolveWebviewView(view as never);
    await view._triggerMessage(null);
    await view._triggerMessage({ command: 'unknown' });
    expect(onWirePin).not.toHaveBeenCalled();
    expect(onUnwirePin).not.toHaveBeenCalled();
  });

  // FR-ES-2 — message validation
  it('drops wirePin with pinNumber out of range 0–31 (FR-ES-2)', async () => {
    const view = makeView();
    provider.resolveWebviewView(view as never);
    await view._triggerMessage({ command: 'wirePin', pinNumber: 999, deviceType: 'pot', id: 'vol' });
    expect(onWirePin).not.toHaveBeenCalled();
  });

  it('drops wirePin with negative pinNumber (FR-ES-2)', async () => {
    const view = makeView();
    provider.resolveWebviewView(view as never);
    await view._triggerMessage({ command: 'wirePin', pinNumber: -1, deviceType: 'pot', id: 'vol' });
    expect(onWirePin).not.toHaveBeenCalled();
  });

  it('drops wirePin with invalid deviceType (FR-ES-2)', async () => {
    const view = makeView();
    provider.resolveWebviewView(view as never);
    await view._triggerMessage({ command: 'wirePin', pinNumber: 15, deviceType: 'motor', id: 'vol' });
    expect(onWirePin).not.toHaveBeenCalled();
  });

  it('drops wirePin with invalid id containing a dot (FR-ES-2)', async () => {
    const view = makeView();
    provider.resolveWebviewView(view as never);
    await view._triggerMessage({ command: 'wirePin', pinNumber: 15, deviceType: 'pot', id: 'foo.bar' });
    expect(onWirePin).not.toHaveBeenCalled();
  });

  it('accepts wirePin with pinNumber at boundary 0 (FR-ES-2)', async () => {
    const view = makeView();
    provider.resolveWebviewView(view as never);
    await view._triggerMessage({ command: 'wirePin', pinNumber: 0, deviceType: 'led', id: 'onboard' });
    expect(onWirePin).toHaveBeenCalledWith({ pinNumber: 0, deviceType: 'led', id: 'onboard' });
  });

  it('accepts wirePin with pinNumber at boundary 31 (FR-ES-2)', async () => {
    const view = makeView();
    provider.resolveWebviewView(view as never);
    await view._triggerMessage({ command: 'wirePin', pinNumber: 31, deviceType: 'button', id: 'bypass' });
    expect(onWirePin).toHaveBeenCalledWith({ pinNumber: 31, deviceType: 'button', id: 'bypass' });
  });

  it('postWiredPins sends postMessage with pins to live-update the webview', () => {
    const view = makeView(true);
    provider.resolveWebviewView(view as never);
    const pins = [{ pinNumber: 15, deviceType: 'pot' as const, id: 'cutoff' }];
    provider.postWiredPins(pins);
    expect(view.webview.postMessage).toHaveBeenCalledWith({ command: 'wiredPins', pins });
  });

  it('postWiredPins sends postMessage even when view is not yet visible', () => {
    const view = makeView(false);
    provider.resolveWebviewView(view as never);
    const pins = [{ pinNumber: 15, deviceType: 'pot' as const, id: 'cutoff' }];
    provider.postWiredPins(pins);
    expect(view.webview.postMessage).toHaveBeenCalledWith({ command: 'wiredPins', pins });
  });

  it('sends postMessage to re-hydrate wired pins on visibility change to visible', () => {
    const view = makeView(false);
    provider.resolveWebviewView(view as never);
    const pins = [{ pinNumber: 16, deviceType: 'button' as const, id: 'bypass' }];
    provider.postWiredPins(pins);
    view._setVisible(true);
    expect(view.webview.postMessage).toHaveBeenLastCalledWith({ command: 'wiredPins', pins });
  });

  it('calls onBecameVisible when view becomes visible', () => {
    const view = makeView(false);
    provider.resolveWebviewView(view as never);
    const cb = vi.fn();
    provider.setOnBecameVisible(cb);
    view._setVisible(true);
    expect(cb).toHaveBeenCalledOnce();
  });

  it('does not call onBecameVisible when view becomes hidden', () => {
    const view = makeView(true);
    provider.resolveWebviewView(view as never);
    const cb = vi.fn();
    provider.setOnBecameVisible(cb);
    view._setVisible(false);
    expect(cb).not.toHaveBeenCalled();
  });
});
