import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ControlsViewProvider, truncId } from '../../../sidebar/controls-view-provider';

function makeView(initiallyVisible = true) {
  let _visible = initiallyVisible;
  const onMsgHandlers: ((msg: unknown) => void)[] = [];
  const onVisHandlers: (() => void)[] = [];
  return {
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
    _triggerMessage: (msg: unknown) => onMsgHandlers.forEach(h => h(msg)),
    _setVisible: (v: boolean) => {
      _visible = v;
      onVisHandlers.forEach(h => h());
    },
  };
}

describe('ControlsViewProvider', () => {
  let onEditorSave: ReturnType<typeof vi.fn>;
  let onPotChange: ReturnType<typeof vi.fn>;
  let onButtonChange: ReturnType<typeof vi.fn>;
  let provider: ControlsViewProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    onEditorSave = vi.fn();
    onPotChange = vi.fn();
    onButtonChange = vi.fn();
    provider = new ControlsViewProvider(onEditorSave, onPotChange, onButtonChange);
  });

  it('resolveWebviewView sets html and enables scripts', () => {
    const view = makeView();
    provider.resolveWebviewView(view as never);
    expect(view.webview.options).toMatchObject({ enableScripts: true });
    expect(view.webview.html).toContain('DS-IDE Controls');
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

  it('calls onEditorSave with valid cfg when editorSave message received', () => {
    const view = makeView();
    provider.resolveWebviewView(view as never);
    const cfg = { pots: [], buttons: [], leds: [], errors: [] };
    view._triggerMessage({ command: 'editorSave', cfg });
    expect(onEditorSave).toHaveBeenCalledWith(expect.objectContaining({ pots: [], buttons: [], leds: [] }));
  });

  it('drops editorSave with malformed cfg (FR-ES-2)', () => {
    const view = makeView();
    provider.resolveWebviewView(view as never);
    const cfg = { pots: [{ id: '', label: '', adcChannel: -99, range: [0, 1], taper: 'linear', default: 0.5, errors: [] }], buttons: [], leds: [], errors: [] };
    view._triggerMessage({ command: 'editorSave', cfg });
    expect(onEditorSave).not.toHaveBeenCalled();
  });

  it('round-trips a valid pot cfg through serialize/parse before saving (FR-ES-2)', () => {
    const view = makeView();
    provider.resolveWebviewView(view as never);
    const cfg = {
      pots: [{ id: 'vol', label: 'Volume', adcChannel: 0, range: [0, 1] as [number, number], taper: 'linear' as const, default: 0.5, errors: [] }],
      buttons: [],
      leds: [],
      errors: [],
    };
    view._triggerMessage({ command: 'editorSave', cfg });
    expect(onEditorSave).toHaveBeenCalledOnce();
    const saved = onEditorSave.mock.calls[0]![0] as typeof cfg;
    expect(saved.pots[0]!.id).toBe('vol');
  });

  it('calls onPotChange when pot message received', () => {
    const view = makeView();
    provider.resolveWebviewView(view as never);
    view._triggerMessage({ command: 'pot', channel: 2, value: 0.75 });
    expect(onPotChange).toHaveBeenCalledWith(2, 0.75);
  });

  it('calls onButtonChange when button message received', () => {
    const view = makeView();
    provider.resolveWebviewView(view as never);
    view._triggerMessage({ command: 'button', gpioPin: 28, pressed: true });
    expect(onButtonChange).toHaveBeenCalledWith(28, true);
  });

  it('ignores malformed messages', () => {
    const view = makeView();
    provider.resolveWebviewView(view as never);
    view._triggerMessage(null);
    view._triggerMessage({ command: 'pot' }); // missing channel/value
    view._triggerMessage({ command: 'button', gpioPin: 28 }); // missing pressed
    expect(onPotChange).not.toHaveBeenCalled();
    expect(onButtonChange).not.toHaveBeenCalled();
  });

  it('postControlsConfig sends controlsConfig message to webview', () => {
    const view = makeView();
    provider.resolveWebviewView(view as never);
    const config = { controls: [], placements: [], missingBlock: false };
    provider.postControlsConfig(config);
    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'controlsConfig' }),
    );
  });

  it('postStatus sends status message to webview', () => {
    const view = makeView();
    provider.resolveWebviewView(view as never);
    provider.postStatus({ type: 'status', running: true, sampleRate: 48000, blockSize: 256 });
    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'status', running: true }),
    );
  });

  it('postLed forwards gpioPin and lit to webview', () => {
    const view = makeView();
    provider.resolveWebviewView(view as never);
    provider.postLed({ type: 'led', gpioPin: 23, lit: true });
    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'led', gpioPin: 23, lit: true }),
    );
  });

  it('loadEditor sends editorLoad message to webview', () => {
    const view = makeView();
    provider.resolveWebviewView(view as never);
    const cfg = { pots: [], buttons: [], leds: [], errors: [] };
    provider.loadEditor(cfg);
    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'editorLoad', cfg }),
    );
  });

  it('flushes pending config and status when visibility changes to true', () => {
    const view = makeView(false);
    provider.resolveWebviewView(view as never);
    const config = { controls: [], placements: [], missingBlock: false };
    provider.postControlsConfig(config);
    provider.postStatus({ type: 'status', running: false });
    view._setVisible(true);
    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'controlsConfig' }),
    );
    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'status' }),
    );
  });

  it('flushes pending state on webviewReady', () => {
    const view = makeView();
    provider.resolveWebviewView(view as never);
    const config = { controls: [], placements: [], missingBlock: false };
    const editorCfg = { pots: [], buttons: [], leds: [], errors: [] };
    provider.loadEditor(editorCfg);
    provider.postControlsConfig(config);
    provider.postStatus({ type: 'status', running: true });
    view.webview.postMessage.mockClear();
    view._triggerMessage({ command: 'webviewReady' });
    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'editorLoad', cfg: editorCfg }),
    );
    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'controlsConfig' }),
    );
    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'status' }),
    );
  });

  it('flushes editorLoad before controlsConfig so _yamlCfg is set before canvas renders', () => {
    const view = makeView(false);
    provider.resolveWebviewView(view as never);
    const editorCfg = { pots: [{ id: 'vol', label: 'Vol', adcChannel: 0, range: [0,1] as [number,number], taper: 'linear' as const, default: 0.5, errors: [] }], buttons: [], leds: [], errors: [] };
    provider.loadEditor(editorCfg);
    provider.postControlsConfig({ controls: [], placements: [], missingBlock: false });
    view._setVisible(true);
    const calls = view.webview.postMessage.mock.calls.map((c: unknown[]) => (c[0] as Record<string,unknown>).command);
    const editorIdx = calls.indexOf('editorLoad');
    const configIdx = calls.indexOf('controlsConfig');
    expect(editorIdx).toBeGreaterThanOrEqual(0);
    expect(configIdx).toBeGreaterThan(editorIdx);
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

  it('generates HTML with title tooltip on ctrl-handle (compact convention header)', () => {
    const view = makeView();
    provider.resolveWebviewView(view as never);
    // Convention handle now carries a title attribute instead of card-kind / card-pin-label spans
    expect(view.webview.html).toContain('"ctrl-handle" title=');
    expect(view.webview.html).not.toContain('"card-pin-label"');
  });

  it('generates HTML with justify-content: center on ctrl-body', () => {
    const view = makeView();
    provider.resolveWebviewView(view as never);
    expect(view.webview.html).toContain('justify-content: center');
  });

  it('generates HTML with box-shadow on btn-ce (square pad)', () => {
    const view = makeView();
    provider.resolveWebviewView(view as never);
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
    expect(result.length).toBe(15); // 14 chars + 1 ellipsis char
  });

  it('truncates id of exactly 16 chars', () => {
    const result = truncId('1234567890123456');
    expect(result).toBe('12345678901234…');
  });
});
