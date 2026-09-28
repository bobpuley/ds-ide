import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import {
  WiredPin, WirePinHandler, UnwirePinHandler, SetPeripheralEnabledHandler, ViewPeripheralHandler,
  RevealInCodeHandler, PeripheralDisplayState, buildHtml,
} from '../wiring/wiring-panel';
import { isDeviceType } from '../devices/registry';
import { peripheralIds } from '../wiring/peripheral-state';
import { WiringWebviewMessage } from '../webview/messages';
import { hasKnownCommand, assertNever } from '../webview/message-guard';

// FR-EXT-33: see controls-editor-panel.ts's identical comment — the
// switch's `default: assertNever(...)` is the actual drift-detector; this
// Set only drives the runtime hasKnownCommand narrow.
const WIRING_WEBVIEW_COMMANDS = new Set<WiringWebviewMessage['command']>([
  'wirePin', 'unwirePin', 'setPeripheralEnabled', 'viewPeripheral', 'revealInCode',
]);

export class WiringViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private lastWiredPins: WiredPin[] = [];
  private lastPeripherals: PeripheralDisplayState[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly onWirePin: WirePinHandler,
    private readonly onUnwirePin: UnwirePinHandler,
    private readonly onSetPeripheralEnabled: SetPeripheralEnabledHandler,
    private readonly onViewPeripheral: ViewPeripheralHandler,
    private readonly onRevealInCode: RevealInCodeHandler,
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

    const msgDisposable = webviewView.webview.onDidReceiveMessage(async (raw: unknown) => {
      if (!hasKnownCommand<WiringWebviewMessage>(raw, WIRING_WEBVIEW_COMMANDS)) return;
      const msg = raw;
      switch (msg.command) {
        case 'wirePin': {
          const pinNumber  = msg.pinNumber;
          const deviceType = msg.deviceType;
          const id         = msg.id;
          if (
            !Number.isFinite(pinNumber) || !Number.isInteger(pinNumber) ||
            pinNumber < 0 || pinNumber > 31 ||
            typeof deviceType !== 'string' || !isDeviceType(deviceType) ||
            typeof id !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(id)
          ) return;
          // FR-EXT-8: onWirePin performs file I/O (workspace edit + save) that
          // can throw (e.g. a permission error) — left unguarded, that would
          // reject this async onDidReceiveMessage callback with no listener,
          // producing an unhandled promise rejection instead of user feedback.
          try {
            await this.onWirePin({
              pinNumber:  pinNumber,
              deviceType: deviceType as WiredPin['deviceType'],
              id:         id,
            });
          } catch (err) {
            void vscode.window.showErrorMessage(`ds-ide: could not wire pin: ${String(err)}`);
          }
          break;
        }
        case 'unwirePin': {
          const pinNumber = msg.pinNumber;
          const id        = msg.id;
          if (
            !Number.isFinite(pinNumber) || !Number.isInteger(pinNumber) ||
            pinNumber < 0 || pinNumber > 31 ||
            typeof id !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(id)
          ) return;
          try {
            await this.onUnwirePin(pinNumber, id);
          } catch (err) {
            void vscode.window.showErrorMessage(`ds-ide: could not unwire pin: ${String(err)}`);
          }
          break;
        }
        case 'setPeripheralEnabled': {
          const peripheralId = msg.peripheralId;
          const enabled      = msg.enabled;
          if (
            typeof peripheralId !== 'string' || !peripheralIds().includes(peripheralId) ||
            typeof enabled !== 'boolean'
          ) return;
          try {
            await this.onSetPeripheralEnabled(peripheralId, enabled);
          } catch (err) {
            void vscode.window.showErrorMessage(`ds-ide: could not update peripheral: ${String(err)}`);
          }
          break;
        }
        case 'viewPeripheral': {
          const peripheralId = msg.peripheralId;
          if (typeof peripheralId !== 'string' || !peripheralIds().includes(peripheralId)) return;
          this.onViewPeripheral(peripheralId);
          break;
        }
        case 'revealInCode': {
          const id = msg.id;
          if (typeof id !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(id)) return;
          try {
            await this.onRevealInCode(id);
          } catch (err) {
            void vscode.window.showErrorMessage(`ds-ide: could not reveal ${id} in code: ${String(err)}`);
          }
          break;
        }
        default:
          assertNever(msg, 'WiringViewProvider');
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
