import * as vscode from 'vscode';
import { DAISY_DEBUG_TYPE } from '../commands/debug-deploy';

export const DS_IDE_DEBUG_TYPE = 'ds-ide';

export class DaisyRunConfigurationProvider implements vscode.DebugConfigurationProvider {
  constructor(
    private readonly onBuildAndDeploy: () => Promise<boolean>,
    private readonly getEmulatorPid: () => number | undefined,
  ) {}

  provideDebugConfigurations(): vscode.DebugConfiguration[] {
    return [{
      type: DS_IDE_DEBUG_TYPE,
      request: 'launch',
      name: 'DS-IDE: Build, Deploy & Debug',
    }];
  }

  async resolveDebugConfiguration(
    _folder: vscode.WorkspaceFolder | undefined,
    config: vscode.DebugConfiguration,
  ): Promise<vscode.DebugConfiguration | undefined> {
    const ok = await this.onBuildAndDeploy();
    if (!ok) return undefined;

    if (config['noDebug']) return undefined;

    const pid = this.getEmulatorPid();
    if (pid === undefined) {
      void vscode.window.showErrorMessage(
        'ds-ide: could not determine emulator PID for debug attach',
      );
      return undefined;
    }

    const folder = vscode.workspace.workspaceFolders?.[0];
    const started = await vscode.debug.startDebugging(folder, {
      type: DAISY_DEBUG_TYPE,
      request: 'attach',
      name: 'Daisy Debug',
      pid,
    });
    if (!started) {
      void vscode.window.showErrorMessage('ds-ide: failed to start debug session');
    }
    // Return undefined to abort the ds-ide wrapper session; the daisy-debug
    // session started above owns the Debug toolbar and lldb attachment.
    return undefined;
  }
}

// Minimal DAP adapter that responds to every request with success and sends
// a 'terminated' event after the launch/attach handshake. Used by
// DsIdeDebugAdapterDescriptorFactory so VS Code has a valid descriptor for
// the 'ds-ide' type. The adapter terminates immediately because the actual
// debugging is handled by a separate 'daisy-debug' session started in
// resolveDebugConfiguration above.
// DebugProtocolMessage is an opaque VS Code type; valid DAP payloads are narrowed here once.
function makeDap(msg: { type: string; seq: number; [k: string]: unknown }): vscode.DebugProtocolMessage {
  return msg as vscode.DebugProtocolMessage;
}

class DsIdeTerminatingAdapter implements vscode.DebugAdapter {
  private readonly _emitter = new vscode.EventEmitter<vscode.DebugProtocolMessage>();
  readonly onDidSendMessage: vscode.Event<vscode.DebugProtocolMessage> = this._emitter.event;
  private _seq = 0;
  private _terminateTimer: ReturnType<typeof setTimeout> | undefined;

  private static readonly DAP_TERMINATE_DELAY_MS = 50;

  handleMessage(message: vscode.DebugProtocolMessage): void {
    const req = message as { type: string; command: string; seq: number };
    if (req.type !== 'request') return;
    this._emitter.fire(makeDap({
      type: 'response',
      command: req.command,
      request_seq: req.seq,
      seq: ++this._seq,
      success: true,
      body: {},
    }));
    if (req.command === 'initialize') {
      this._emitter.fire(makeDap({
        type: 'event',
        event: 'initialized',
        seq: ++this._seq,
        body: {},
      }));
    } else if (req.command === 'launch' || req.command === 'attach') {
      // Give VS Code a tick to process the response before sending terminated.
      this._terminateTimer = setTimeout(() => {
        this._terminateTimer = undefined;
        this._emitter.fire(makeDap({
          type: 'event',
          event: 'terminated',
          seq: ++this._seq,
          body: {},
        }));
      }, DsIdeTerminatingAdapter.DAP_TERMINATE_DELAY_MS);
    }
  }

  dispose(): void {
    clearTimeout(this._terminateTimer);
    this._terminateTimer = undefined;
    this._emitter.dispose();
  }
}

// Registers a valid descriptor for the 'ds-ide' debug type so VS Code's
// pre-check passes. resolveDebugConfiguration returns undefined (aborting the
// ds-ide session) before VS Code reaches this factory in the normal flow; the
// terminating adapter is a safety net for any timing edge cases.
export class DsIdeDebugAdapterDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {
  createDebugAdapterDescriptor(): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
    return new vscode.DebugAdapterInlineImplementation(new DsIdeTerminatingAdapter());
  }
}
