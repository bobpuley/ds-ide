import * as vscode from 'vscode';
import { WiredPin, WirePinHandler, UnwirePinHandler, buildHtml } from '../wiring/wiring-panel';

export const WIRING_VIEW_ID = 'ds-ide.wiringEditor';

export class WiringViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private wiredPins: WiredPin[] = [];

  constructor(
    private readonly onWirePin: WirePinHandler,
    private readonly onUnwirePin: UnwirePinHandler,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = buildHtml(this.wiredPins);

    view.webview.onDidReceiveMessage(async (msg: unknown) => {
      if (!msg || typeof msg !== 'object') return;
      const m = msg as Record<string, unknown>;
      if (m['command'] === 'wirePin') {
        await this.onWirePin({
          pinNumber:  m['pinNumber']  as number,
          deviceType: m['deviceType'] as WiredPin['deviceType'],
          id:         m['id']         as string,
        });
      } else if (m['command'] === 'unwirePin') {
        await this.onUnwirePin(m['pinNumber'] as number, m['id'] as string);
      }
    });

    view.onDidChangeVisibility(() => {
      if (view.visible) {
        // Re-hydrate the webview with current state. postMessage is preferred
        // when retainContextWhenHidden keeps the JS alive; rebuilding HTML
        // covers the case where the context was discarded.
        void view.webview.postMessage({ command: 'wiredPins', pins: this.wiredPins });
      }
    });
  }

  postWiredPins(pins: WiredPin[]): void {
    this.wiredPins = pins;
    if (this.view) {
      // Send a live update message; the JS receives it and calls applyWiredPins
      // without a full page reload — avoids visible state timing issues.
      void this.view.webview.postMessage({ command: 'wiredPins', pins });
    }
  }
}
