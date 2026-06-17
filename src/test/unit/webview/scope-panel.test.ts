import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import * as vscode from 'vscode';
import { ScopePanel } from '../../../webview/scope-panel';
import { EmulatorManager } from '../../../emulator/manager';
import type { ControllerDef } from '../../../controllers/controller-config';

function makeManager() {
  const em = new EventEmitter();
  return Object.assign(em, {
    sendPot: vi.fn(),
    sendPotSnapshot: vi.fn(),
    sendTransport: vi.fn(),
  }) as unknown as EmulatorManager;
}

const DEFS: ControllerDef[] = [
  { id: 'pitch', label: 'Pitch', adcChannel: 0, range: [0, 1], taper: 'linear', default: 0.5 },
  { id: 'volume', label: 'Volume', adcChannel: 1, range: [0, 1], taper: 'linear', default: 0.8 },
];

describe('ScopePanel', () => {
  let manager: EmulatorManager;
  let potChangeSpy: ReturnType<typeof vi.fn>;
  let panel: ScopePanel;
  let webviewMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = makeManager();
    potChangeSpy = vi.fn();
    panel = new ScopePanel(manager, potChangeSpy);
    webviewMock = vscode.window.createWebviewPanel as ReturnType<typeof vi.fn>;
  });

  it('show() creates a webview panel', () => {
    panel.show();
    expect(webviewMock).toHaveBeenCalledWith(
      'daisy-scope',
      'Daisy Scope',
      vscode.ViewColumn.Two,
      expect.objectContaining({ enableScripts: true }),
    );
  });

  it('show() sets webview HTML', () => {
    panel.show(DEFS, { 0: 0.5 });
    const created = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(created.webview.html).toContain('Daisy Scope');
  });

  it('show() embeds pot slider HTML for each def', () => {
    panel.show(DEFS, {});
    const created = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(created.webview.html).toContain('data-channel="0"');
    expect(created.webview.html).toContain('data-channel="1"');
    expect(created.webview.html).toContain('Pitch');
    expect(created.webview.html).toContain('Volume');
  });

  it('show() uses initialValues to set slider values', () => {
    panel.show(DEFS, { 0: 0.25, 1: 0.75 });
    const created = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(created.webview.html).toContain('value="0.25"');
    expect(created.webview.html).toContain('value="0.75"');
  });

  it('show() falls back to def.default when no initial value provided', () => {
    panel.show(DEFS, {});
    const created = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    // DEFS[0].default = 0.5, DEFS[1].default = 0.8
    expect(created.webview.html).toContain('value="0.5"');
    expect(created.webview.html).toContain('value="0.8"');
  });

  it('show() does not render controller HTML when defs is empty', () => {
    panel.show([], {});
    const created = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(created.webview.html).not.toContain('id="controllers"');
  });

  it('registers onDidReceiveMessage on the webview', () => {
    panel.show(DEFS, {});
    const created = webviewMock.mock.results[0]?.value as {
      webview: { onDidReceiveMessage: ReturnType<typeof vi.fn> };
    };
    expect(created.webview.onDidReceiveMessage).toHaveBeenCalled();
  });

  it('forwards pot message from webview to manager.sendPot()', () => {
    panel.show(DEFS, {});
    const created = webviewMock.mock.results[0]?.value as {
      webview: { onDidReceiveMessage: ReturnType<typeof vi.fn> };
    };
    // Extract the handler registered with onDidReceiveMessage
    const handler = created.webview.onDidReceiveMessage.mock.calls[0]![0] as (
      msg: unknown,
    ) => void;
    handler({ command: 'pot', channel: 0, value: 0.7 });
    expect(manager.sendPot).toHaveBeenCalledWith(0, 0.7);
  });

  it('calls onPotChange callback when pot message received', () => {
    panel.show(DEFS, {});
    const created = webviewMock.mock.results[0]?.value as {
      webview: { onDidReceiveMessage: ReturnType<typeof vi.fn> };
    };
    const handler = created.webview.onDidReceiveMessage.mock.calls[0]![0] as (
      msg: unknown,
    ) => void;
    handler({ command: 'pot', channel: 1, value: 0.4 });
    expect(potChangeSpy).toHaveBeenCalledWith(1, 0.4);
  });

  it('ignores non-pot messages from webview', () => {
    panel.show(DEFS, {});
    const created = webviewMock.mock.results[0]?.value as {
      webview: { onDidReceiveMessage: ReturnType<typeof vi.fn> };
    };
    const handler = created.webview.onDidReceiveMessage.mock.calls[0]![0] as (
      msg: unknown,
    ) => void;
    handler({ command: 'unknown' });
    expect(manager.sendPot).not.toHaveBeenCalled();
    expect(potChangeSpy).not.toHaveBeenCalled();
  });

  it('forwards scope messages from manager to webview', () => {
    panel.show(DEFS, {});
    const created = webviewMock.mock.results[0]?.value as {
      webview: { postMessage: ReturnType<typeof vi.fn> };
    };
    (manager as unknown as EventEmitter).emit('message', {
      type: 'scope',
      in: [0.1, 0.2],
      out: [0.3, 0.4],
    });
    expect(created.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'scope' }),
    );
  });

  it('dispose() cleans up the panel', () => {
    panel.show(DEFS, {});
    const created = webviewMock.mock.results[0]?.value as { dispose: ReturnType<typeof vi.fn> };
    panel.dispose();
    expect(created.dispose).toHaveBeenCalled();
  });

  it('reveal() is called when show() is called on an already-open panel', () => {
    panel.show(DEFS, {});
    const created = webviewMock.mock.results[0]?.value as { reveal: ReturnType<typeof vi.fn> };
    panel.show(DEFS, {});
    // Only one panel should be created
    expect(webviewMock).toHaveBeenCalledTimes(1);
    expect(created.reveal).toHaveBeenCalled();
  });

  it('includes fidelity caveat notice in webview HTML (T4.5)', () => {
    panel.show(DEFS, {});
    const created = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(created.webview.html).toContain('fidelity-caveat');
    expect(created.webview.html).toContain('Approx. Seed');
  });

  it('webview HTML uses sticky event accumulation (T4.3)', () => {
    panel.show(DEFS, {});
    const created = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(created.webview.html).toContain('activeEvents');
  });
});
