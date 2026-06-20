import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ControlsViewProvider } from '../../../sidebar/controls-view-provider';

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

  it('calls onEditorSave with cfg when editorSave message received', () => {
    const view = makeView();
    provider.resolveWebviewView(view as never);
    const cfg = { pots: [], buttons: [], leds: [], errors: [] };
    view._triggerMessage({ command: 'editorSave', cfg });
    expect(onEditorSave).toHaveBeenCalledWith(cfg);
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
});
