import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import {
  WiredPin, WirePinHandler, UnwirePinHandler, SetPeripheralEnabledHandler,
  PeripheralDisplayState, buildHtml,
} from '../wiring/wiring-panel';
import { isDeviceType } from '../devices/registry';
import { peripheralIds } from '../wiring/peripheral-state';

export class WiringViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private lastWiredPins: WiredPin[] = [];
  private lastPeripherals: PeripheralDisplayState[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly onWirePin: WirePinHandler,
    private readonly onUnwirePin: UnwirePinHandler,
    private readonly onSetPeripheralEnabled: SetPeripheralEnabledHandler,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;

    const nonce = randomBytes(16).toString('base64');
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')],
    };

    const scriptUri = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'wiring-webview.js'),
    ).toString();
    webviewView.webview.html = buildHtml(this.lastWiredPins, this.lastPeripherals, nonce, scriptUri);

    const msgDisposable = webviewView.webview.onDidReceiveMessage(async (msg: unknown) => {
      if (!msg || typeof msg !== 'object') return;
      const m = msg as Record<string, unknown>;
      if (m['command'] === 'wirePin') {
        const pinNumber  = m['pinNumber'];
        const deviceType = m['deviceType'];
        const id         = m['id'];
        if (
          !Number.isFinite(pinNumber) || !Number.isInteger(pinNumber) ||
          (pinNumber as number) < 0 || (pinNumber as number) > 31 ||
          typeof deviceType !== 'string' || !isDeviceType(deviceType) ||
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
      } else if (m['command'] === 'setPeripheralEnabled') {
        const peripheralId = m['peripheralId'];
        const enabled      = m['enabled'];
        if (
          typeof peripheralId !== 'string' || !peripheralIds().includes(peripheralId) ||
          typeof enabled !== 'boolean'
        ) return;
        await this.onSetPeripheralEnabled(peripheralId, enabled);
      }
    });

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        void webviewView.webview.postMessage({ command: 'wiredPins', pins: this.lastWiredPins });
        void webviewView.webview.postMessage({ command: 'peripherals', peripherals: this.lastPeripherals });
      }
    });

    webviewView.onDidDispose(() => {
      msgDisposable.dispose();
      this.view = undefined;
    });

    void webviewView.webview.postMessage({ command: 'wiredPins', pins: this.lastWiredPins });
    void webviewView.webview.postMessage({ command: 'peripherals', peripherals: this.lastPeripherals });
  }

  get isVisible(): boolean { return this.view?.visible ?? false; }

  postWiredPins(pins: WiredPin[]): void {
    this.lastWiredPins = pins;
    if (this.view) {
      void this.view.webview.postMessage({ command: 'wiredPins', pins });
    }
  }

  postPeripherals(peripherals: PeripheralDisplayState[]): void {
    this.lastPeripherals = peripherals;
    if (this.view) {
      void this.view.webview.postMessage({ command: 'peripherals', peripherals });
    }
  }
}
