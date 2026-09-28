import * as vscode from 'vscode';
import { DAISY_DEBUG_TYPE } from '../commands/debug-deploy';
import { resolveActiveFolder } from '../workspace/active-folder';
import { RunSessionAdapter, type RunSessionHost } from './run-session-adapter';

export const DS_IDE_DEBUG_TYPE = 'ds-ide';

export class DaisyRunConfigurationProvider implements vscode.DebugConfigurationProvider {
  constructor(
    private readonly onBuildAndDeploy: (token: vscode.CancellationToken) => Promise<boolean>,
    private readonly getEmulatorPid: () => number | undefined,
    private readonly workspaceState: vscode.Memento,
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
    // F5 otherwise sits silent for however long the cmake build + deploy
    // takes, with no indication anything is happening (FR-QA-EXT-9).
    // cancellable: true lets the user abort a hung build/deploy instead of
    // reloading the extension host window (FR-EXT-16).
    const ok = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'ds-ide: building and deploying…', cancellable: true },
      (_progress, token) => this.onBuildAndDeploy(token),
    );
    if (!ok) return undefined;

    // FR-TRN-1: Ctrl+F5 — returning the config starts a live `ds-ide`
    // session (RunSessionAdapter) that lasts as long as the emulator does,
    // so VS Code shows Restart / Stop for the run.
    if (config['noDebug']) return config;

    const pid = this.getEmulatorPid();
    if (pid === undefined) {
      void vscode.window.showErrorMessage(
        'ds-ide: could not determine emulator PID for debug attach',
      );
      return undefined;
    }

    const folder = resolveActiveFolder(this.workspaceState);
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

// A noDebug (Ctrl+F5) session gets the live RunSessionAdapter (FR-TRN-1).
// For F5, resolveDebugConfiguration returns undefined (aborting the ds-ide
// wrapper) before VS Code reaches this factory in the normal flow; the
// terminating adapter is a safety net for any timing edge cases.
export class DsIdeDebugAdapterDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {
  constructor(private readonly runHost: RunSessionHost) {}

  createDebugAdapterDescriptor(session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
    const adapter = session.configuration['noDebug']
      ? new RunSessionAdapter(this.runHost)
      : new DsIdeTerminatingAdapter();
    return new vscode.DebugAdapterInlineImplementation(adapter);
  }
}
