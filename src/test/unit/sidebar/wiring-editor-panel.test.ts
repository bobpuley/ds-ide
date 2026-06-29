import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { WiringEditorPanel } from '../../../sidebar/wiring-editor-panel';

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
  };
}

describe('WiringEditorPanel', () => {
  let onWirePin: ReturnType<typeof vi.fn>;
  let onUnwirePin: ReturnType<typeof vi.fn>;
  let editorPanel: WiringEditorPanel;
  let createWebviewPanelMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    onWirePin   = vi.fn().mockResolvedValue(undefined);
    onUnwirePin = vi.fn().mockResolvedValue(undefined);
    editorPanel = new WiringEditorPanel(
      { fsPath: '/ext' } as unknown as vscode.Uri,
      onWirePin, onUnwirePin,
    );
    createWebviewPanelMock = vscode.window.createWebviewPanel as ReturnType<typeof vi.fn>;
  });

  it('createOrReveal creates a WebviewPanel with correct viewType and title (FR-TWE-2)', () => {
    editorPanel.createOrReveal();
    expect(createWebviewPanelMock).toHaveBeenCalledWith(
      'ds-ide.wiringEditor',
      'Wiring Editor',
      vscode.ViewColumn.Beside,
      expect.objectContaining({ enableScripts: true }),
    );
  });

  it('createOrReveal sets localResourceRoots (FR-ES-1)', () => {
    editorPanel.createOrReveal();
    expect(createWebviewPanelMock).toHaveBeenCalledWith(
      expect.any(String), expect.any(String), expect.anything(),
      expect.objectContaining({ localResourceRoots: [expect.anything()] }),
    );
  });

  it('webview HTML contains Daisy Seed Wiring', () => {
    editorPanel.createOrReveal();
    expect(getPanelMock().webview.html).toContain('Daisy Seed Wiring');
  });

  it('webview HTML includes CSP meta tag with nonce (FR-ES-1)', () => {
    editorPanel.createOrReveal();
    expect(getPanelMock().webview.html).toContain('<meta http-equiv="Content-Security-Policy"');
    expect(getPanelMock().webview.html).toContain('nonce-');
  });

  it('webview HTML script tag has nonce matching CSP (FR-ES-1)', () => {
    editorPanel.createOrReveal();
    const html = getPanelMock().webview.html;
    const nonceMatch = html.match(/nonce-([^'";]+)/);
    expect(nonceMatch).toBeTruthy();
    const nonce = nonceMatch![1];
    expect(html).toContain(`<script nonce="${nonce}" src=`);
  });

  it('reveal() called when createOrReveal() is called on already-open panel (FR-TWE-2)', () => {
    editorPanel.createOrReveal();
    const mock = getPanelMock();
    editorPanel.createOrReveal();
    expect(createWebviewPanelMock).toHaveBeenCalledTimes(1);
    expect(mock.reveal).toHaveBeenCalled();
  });

  it('isOpen is true after createOrReveal, false before', () => {
    expect(editorPanel.isOpen).toBe(false);
    editorPanel.createOrReveal();
    expect(editorPanel.isOpen).toBe(true);
  });

  it('isOpen becomes false after panel is disposed', () => {
    editorPanel.createOrReveal();
    const disposeCb = getPanelMock().onDidDispose.mock.calls[0]?.[0] as () => void;
    disposeCb?.();
    expect(editorPanel.isOpen).toBe(false);
  });

  it('calls onWirePin when wirePin message received', async () => {
    editorPanel.createOrReveal();
    const handler = getPanelMock().webview.onDidReceiveMessage.mock.calls[0]![0] as (msg: unknown) => Promise<void>;
    await handler({ command: 'wirePin', pinNumber: 15, deviceType: 'pot', id: 'filter' });
    expect(onWirePin).toHaveBeenCalledWith({ pinNumber: 15, deviceType: 'pot', id: 'filter' });
  });

  it('calls onUnwirePin when unwirePin message received', async () => {
    editorPanel.createOrReveal();
    const handler = getPanelMock().webview.onDidReceiveMessage.mock.calls[0]![0] as (msg: unknown) => Promise<void>;
    await handler({ command: 'unwirePin', pinNumber: 15, id: 'filter' });
    expect(onUnwirePin).toHaveBeenCalledWith(15, 'filter');
  });

  it('ignores unknown or malformed messages', async () => {
    editorPanel.createOrReveal();
    const handler = getPanelMock().webview.onDidReceiveMessage.mock.calls[0]![0] as (msg: unknown) => Promise<void>;
    await handler(null);
    await handler({ command: 'unknown' });
    expect(onWirePin).not.toHaveBeenCalled();
    expect(onUnwirePin).not.toHaveBeenCalled();
  });

  it('drops wirePin with pinNumber out of range 0–31 (FR-ES-2)', async () => {
    editorPanel.createOrReveal();
    const handler = getPanelMock().webview.onDidReceiveMessage.mock.calls[0]![0] as (msg: unknown) => Promise<void>;
    await handler({ command: 'wirePin', pinNumber: 999, deviceType: 'pot', id: 'vol' });
    expect(onWirePin).not.toHaveBeenCalled();
  });

  it('drops wirePin with invalid deviceType (FR-ES-2)', async () => {
    editorPanel.createOrReveal();
    const handler = getPanelMock().webview.onDidReceiveMessage.mock.calls[0]![0] as (msg: unknown) => Promise<void>;
    await handler({ command: 'wirePin', pinNumber: 15, deviceType: 'motor', id: 'vol' });
    expect(onWirePin).not.toHaveBeenCalled();
  });

  it('drops wirePin with invalid id (FR-ES-2)', async () => {
    editorPanel.createOrReveal();
    const handler = getPanelMock().webview.onDidReceiveMessage.mock.calls[0]![0] as (msg: unknown) => Promise<void>;
    await handler({ command: 'wirePin', pinNumber: 15, deviceType: 'pot', id: 'foo.bar' });
    expect(onWirePin).not.toHaveBeenCalled();
  });

  it('postWiredPins sends wiredPins message to live-update the panel webview', () => {
    editorPanel.createOrReveal();
    const mock = getPanelMock();
    mock.webview.postMessage.mockClear();
    const pins = [{ pinNumber: 15, deviceType: 'pot' as const, id: 'cutoff' }];
    editorPanel.postWiredPins(pins);
    expect(mock.webview.postMessage).toHaveBeenCalledWith({ command: 'wiredPins', pins });
  });

  it('postWiredPins stores last pins for state restoration (FR-TWE-6)', () => {
    const pins = [{ pinNumber: 15, deviceType: 'pot' as const, id: 'cutoff' }];
    editorPanel.postWiredPins(pins);

    // Open panel — should receive the stored pins
    editorPanel.createOrReveal();
    const mock = getPanelMock();
    expect(mock.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'wiredPins', pins }),
    );
  });

  it('restores last wired pins after panel close and reopen (FR-TWE-6)', () => {
    const pins = [{ pinNumber: 16, deviceType: 'button' as const, id: 'bypass' }];
    editorPanel.createOrReveal();
    editorPanel.postWiredPins(pins);

    // Simulate panel close
    const disposeCb = getPanelMock().onDidDispose.mock.calls[0]?.[0] as () => void;
    disposeCb?.();
    vi.clearAllMocks();

    // Reopen
    editorPanel.createOrReveal();
    const newMock = getPanelMock();
    expect(newMock.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'wiredPins', pins }),
    );
  });
});
