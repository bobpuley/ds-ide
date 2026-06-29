import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { WiredPin, WirePinHandler, UnwirePinHandler, buildHtml } from '../wiring/wiring-panel';

export class WiringEditorPanel {
  private panel: vscode.WebviewPanel | undefined;
  private lastWiredPins: WiredPin[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly onWirePin: WirePinHandler,
    private readonly onUnwirePin: UnwirePinHandler,
  ) {}

  createOrReveal(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }

    const nonce = randomBytes(16).toString('base64');
    this.panel = vscode.window.createWebviewPanel(
      'ds-ide.wiringEditor',
      'Wiring Editor',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')],
      },
    );

    this.panel.iconPath = {
      light: vscode.Uri.joinPath(this.extensionUri, 'media', 'wiring-editor-icon-light.svg'),
      dark:  vscode.Uri.joinPath(this.extensionUri, 'media', 'wiring-editor-icon-dark.svg'),
    };

    const scriptUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'wiring-webview.js'),
    ).toString();
    this.panel.webview.html = buildHtml(this.lastWiredPins, nonce, scriptUri);

    const msgDisposable = this.panel.webview.onDidReceiveMessage(async (msg: unknown) => {
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

    void this.panel.webview.postMessage({ command: 'wiredPins', pins: this.lastWiredPins });

    this.panel.onDidDispose(() => {
      msgDisposable.dispose();
      this.panel = undefined;
    });
  }

  get isOpen(): boolean { return this.panel !== undefined; }

  postWiredPins(pins: WiredPin[]): void {
    this.lastWiredPins = pins;
    if (this.panel) {
      void this.panel.webview.postMessage({ command: 'wiredPins', pins });
    }
  }
}
