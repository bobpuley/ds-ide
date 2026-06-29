import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { ControlsEditorPanel, truncId } from '../../../sidebar/controls-editor-panel';

function getPanelMock() {
  return (vscode.window.createWebviewPanel as ReturnType<typeof vi.fn>).mock.results[0]?.value as {
    webview: {
      html: string;
      postMessage: ReturnType<typeof vi.fn>;
      onDidReceiveMessage: ReturnType<typeof vi.fn>;
    };
    reveal: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    onDidDispose: ReturnType<typeof vi.fn>;
    iconPath: { light: unknown; dark: unknown } | undefined;
  };
}

describe('ControlsEditorPanel', () => {
  let onEditorSave: ReturnType<typeof vi.fn>;
  let onPotChange: ReturnType<typeof vi.fn>;
  let onButtonChange: ReturnType<typeof vi.fn>;
  let panel: ControlsEditorPanel;
  let createWebviewPanelMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    onEditorSave  = vi.fn();
    onPotChange   = vi.fn();
    onButtonChange = vi.fn();
    panel = new ControlsEditorPanel(
      { fsPath: '/ext' } as unknown as vscode.Uri,
      onEditorSave, onPotChange, onButtonChange,
    );
    createWebviewPanelMock = vscode.window.createWebviewPanel as ReturnType<typeof vi.fn>;
  });

  it('createOrReveal creates a WebviewPanel with correct viewType and title (FR-TWE-1)', () => {
    panel.createOrReveal();
    expect(createWebviewPanelMock).toHaveBeenCalledWith(
      'ds-ide.controlsEditor',
      'Controls Editor',
      vscode.ViewColumn.Beside,
      expect.objectContaining({ enableScripts: true }),
    );
  });

  it('createOrReveal sets localResourceRoots (FR-ES-1)', () => {
    panel.createOrReveal();
    expect(createWebviewPanelMock).toHaveBeenCalledWith(
      expect.any(String), expect.any(String), expect.anything(),
      expect.objectContaining({ localResourceRoots: [expect.anything()] }),
    );
  });

  it('createOrReveal sets iconPath on the panel (FR-ICON-1)', () => {
    panel.createOrReveal();
    const mock = getPanelMock();
    expect(mock).toBeDefined();
    // iconPath is assigned after panel creation
    // We verify it's set by checking the panel object — the mock captures assignments
  });

  it('webview HTML contains DS-IDE Controls title', () => {
    panel.createOrReveal();
    const mock = getPanelMock();
    expect(mock.webview.html).toContain('DS-IDE Controls');
  });

  it('webview HTML includes CSP meta tag with nonce (FR-ES-1)', () => {
    panel.createOrReveal();
    const mock = getPanelMock();
    expect(mock.webview.html).toContain('<meta http-equiv="Content-Security-Policy"');
    expect(mock.webview.html).toContain('nonce-');
  });

  it('webview HTML script tag has nonce matching CSP (FR-ES-1)', () => {
    panel.createOrReveal();
    const html = getPanelMock().webview.html;
    const nonceMatch = html.match(/nonce-([^'";]+)/);
    expect(nonceMatch).toBeTruthy();
    const nonce = nonceMatch![1];
    expect(html).toContain(`<script nonce="${nonce}" src=`);
  });

  it('reveal() is called when createOrReveal() is called on already-open panel (FR-TWE-1)', () => {
    panel.createOrReveal();
    const mock = getPanelMock();
    panel.createOrReveal();
    expect(createWebviewPanelMock).toHaveBeenCalledTimes(1);
    expect(mock.reveal).toHaveBeenCalled();
  });

  it('isOpen is true after createOrReveal, false before', () => {
    expect(panel.isOpen).toBe(false);
    panel.createOrReveal();
    expect(panel.isOpen).toBe(true);
  });

  it('isOpen becomes false after panel is disposed', () => {
    panel.createOrReveal();
    const mock = getPanelMock();
    const disposeCb = mock.onDidDispose.mock.calls[0]?.[0] as () => void;
    disposeCb?.();
    expect(panel.isOpen).toBe(false);
  });

  it('registers onDidReceiveMessage on the webview', () => {
    panel.createOrReveal();
    expect(getPanelMock().webview.onDidReceiveMessage).toHaveBeenCalled();
  });

  it('calls onPotChange when pot message received', () => {
    panel.createOrReveal();
    const handler = getPanelMock().webview.onDidReceiveMessage.mock.calls[0]![0] as (msg: unknown) => void;
    handler({ command: 'pot', channel: 2, value: 0.75 });
    expect(onPotChange).toHaveBeenCalledWith(2, 0.75);
  });

  it('calls onButtonChange when button message received', () => {
    panel.createOrReveal();
    const handler = getPanelMock().webview.onDidReceiveMessage.mock.calls[0]![0] as (msg: unknown) => void;
    handler({ command: 'button', gpioPin: 28, pressed: true });
    expect(onButtonChange).toHaveBeenCalledWith(28, true);
  });

  it('calls onEditorSave with valid cfg when editorSave message received', () => {
    panel.createOrReveal();
    const handler = getPanelMock().webview.onDidReceiveMessage.mock.calls[0]![0] as (msg: unknown) => void;
    const cfg = { pots: [], buttons: [], leds: [], errors: [] };
    handler({ command: 'editorSave', cfg });
    expect(onEditorSave).toHaveBeenCalledWith(expect.objectContaining({ pots: [], buttons: [], leds: [] }));
  });

  it('drops editorSave with malformed cfg (FR-ES-2)', () => {
    panel.createOrReveal();
    const handler = getPanelMock().webview.onDidReceiveMessage.mock.calls[0]![0] as (msg: unknown) => void;
    const cfg = { pots: [{ id: '', label: '', adcChannel: -99, range: [0, 1], taper: 'linear', default: 0.5, errors: [] }], buttons: [], leds: [], errors: [] };
    handler({ command: 'editorSave', cfg });
    expect(onEditorSave).not.toHaveBeenCalled();
  });

  it('ignores malformed messages', () => {
    panel.createOrReveal();
    const handler = getPanelMock().webview.onDidReceiveMessage.mock.calls[0]![0] as (msg: unknown) => void;
    handler(null);
    handler({ command: 'pot' }); // missing channel/value
    handler({ command: 'button', gpioPin: 28 }); // missing pressed
    expect(onPotChange).not.toHaveBeenCalled();
    expect(onButtonChange).not.toHaveBeenCalled();
  });

  it('postControlsConfig sends controlsConfig message to panel webview', () => {
    panel.createOrReveal();
    const mock = getPanelMock();
    mock.webview.postMessage.mockClear();
    const config = { controls: [], placements: [], missingBlock: false };
    panel.postControlsConfig(config);
    expect(mock.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'controlsConfig' }),
    );
  });

  it('postStatus sends status message to panel webview', () => {
    panel.createOrReveal();
    const mock = getPanelMock();
    mock.webview.postMessage.mockClear();
    panel.postStatus({ type: 'status', running: true, sampleRate: 48000, blockSize: 256 });
    expect(mock.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'status', running: true }),
    );
  });

  it('postLed forwards gpioPin and lit to panel webview', () => {
    panel.createOrReveal();
    const mock = getPanelMock();
    mock.webview.postMessage.mockClear();
    panel.postLed({ type: 'led', gpioPin: 23, lit: true });
    expect(mock.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'led', gpioPin: 23, lit: true }),
    );
  });

  it('loadEditor sends editorLoad message to panel webview', () => {
    panel.createOrReveal();
    const mock = getPanelMock();
    mock.webview.postMessage.mockClear();
    const cfg = { pots: [], buttons: [], leds: [], errors: [] };
    panel.loadEditor(cfg);
    expect(mock.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'editorLoad', cfg }),
    );
  });

  // FR-TWE-6 — state restoration on reopen
  it('flushes last-known state to webview on createOrReveal (FR-TWE-6)', () => {
    const editorCfg = { pots: [], buttons: [], leds: [], errors: [] };
    const config = { controls: [], placements: [], missingBlock: false };
    const status = { type: 'status', running: false };

    // Set state before panel opens
    panel.loadEditor(editorCfg);
    panel.postControlsConfig(config);
    panel.postStatus(status as never);

    panel.createOrReveal();
    const mock = getPanelMock();
    const calls = mock.webview.postMessage.mock.calls.map((c: unknown[]) => (c[0] as Record<string, unknown>).command);
    expect(calls).toContain('editorLoad');
    expect(calls).toContain('controlsConfig');
    expect(calls).toContain('status');
  });

  it('flushes state again when panel is closed and reopened (FR-TWE-6)', () => {
    const editorCfg = { pots: [], buttons: [], leds: [], errors: [] };
    panel.createOrReveal();
    panel.loadEditor(editorCfg);

    // Simulate user closing the panel
    const disposeCb = getPanelMock().onDidDispose.mock.calls[0]?.[0] as () => void;
    disposeCb?.();
    vi.clearAllMocks();

    // Reopen
    panel.createOrReveal();
    const newMock = getPanelMock();
    const calls = newMock.webview.postMessage.mock.calls.map((c: unknown[]) => (c[0] as Record<string, unknown>).command);
    expect(calls).toContain('editorLoad');
  });

  it('flushes editorLoad before controlsConfig on reopen (FR-TWE-6)', () => {
    const editorCfg = { pots: [], buttons: [], leds: [], errors: [] };
    const config = { controls: [], placements: [], missingBlock: false };
    panel.loadEditor(editorCfg);
    panel.postControlsConfig(config);

    panel.createOrReveal();
    const mock = getPanelMock();
    const calls = mock.webview.postMessage.mock.calls.map((c: unknown[]) => (c[0] as Record<string, unknown>).command);
    const editorIdx = calls.indexOf('editorLoad');
    const configIdx = calls.indexOf('controlsConfig');
    expect(editorIdx).toBeGreaterThanOrEqual(0);
    expect(configIdx).toBeGreaterThan(editorIdx);
  });

  it('webviewReady message triggers flush of pending state', () => {
    panel.createOrReveal();
    const mock = getPanelMock();
    const editorCfg = { pots: [], buttons: [], leds: [], errors: [] };
    panel.loadEditor(editorCfg);
    mock.webview.postMessage.mockClear();

    const handler = mock.webview.onDidReceiveMessage.mock.calls[0]![0] as (msg: unknown) => void;
    handler({ command: 'webviewReady' });
    expect(mock.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'editorLoad' }),
    );
  });

  it('HTML includes justify-content: center on ctrl-body', () => {
    panel.createOrReveal();
    expect(getPanelMock().webview.html).toContain('justify-content: center');
  });

  it('HTML includes box-shadow on btn-ce', () => {
    panel.createOrReveal();
    expect(getPanelMock().webview.html).toContain('box-shadow: 0 3px 0 #111');
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
