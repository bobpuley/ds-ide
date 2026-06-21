import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { WiredPin, WirePinHandler, UnwirePinHandler, buildHtml } from '../wiring/wiring-panel';

export const WIRING_VIEW_ID = 'ds-ide.wiringEditor';

export class WiringViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private wiredPins: WiredPin[] = [];
  private onBecameVisible: (() => void) | undefined;
  private readonly nonce: string = randomBytes(16).toString('base64');

  constructor(
    private readonly onWirePin: WirePinHandler,
    private readonly onUnwirePin: UnwirePinHandler,
  ) {}

  get isVisible(): boolean { return this.view?.visible ?? false; }

  setOnBecameVisible(fn: () => void): void {
    this.onBecameVisible = fn;
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.html = buildHtml(this.wiredPins, this.nonce);

    view.webview.onDidReceiveMessage(async (msg: unknown) => {
      if (!msg || typeof msg !== 'object') return;
      const m = msg as Record<string, unknown>;
      if (m['command'] === 'wirePin') {
        const pinNumber  = m['pinNumber'];
        const deviceType = m['deviceType'];
        const id         = m['id'];
        if (
          !Number.isFinite(pinNumber) || !Number.isInteger(pinNumber) ||
          (pinNumber as number) < 0 || (pinNumber as number) > 31 ||
          deviceType !== 'pot' && deviceType !== 'button' && deviceType !== 'led' ||
          typeof id !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(id)
        ) return;
        await this.onWirePin({
          pinNumber:  pinNumber  as number,
          deviceType: deviceType as WiredPin['deviceType'],
          id:         id,
        });
      } else if (m['command'] === 'unwirePin') {
        const pinNumber = m['pinNumber'];
        const id        = m['id'];
        if (
          !Number.isFinite(pinNumber) || !Number.isInteger(pinNumber) ||
          (pinNumber as number) < 0 || (pinNumber as number) > 31 ||
          typeof id !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(id)
        ) return;
        await this.onUnwirePin(pinNumber as number, id);
      }
    });

    view.onDidChangeVisibility(() => {
      if (view.visible) {
        // Re-hydrate the webview with current state. postMessage is preferred
        // when retainContextWhenHidden keeps the JS alive; rebuilding HTML
        // covers the case where the context was discarded.
        void view.webview.postMessage({ command: 'wiredPins', pins: this.wiredPins });
        this.onBecameVisible?.();
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
