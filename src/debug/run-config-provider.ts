import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { DAISY_DEBUG_TYPE } from '../commands/debug-deploy';
import { resolveActiveFolder } from '../workspace/active-folder';
import { RunSessionAdapter, type RunSessionHost } from './run-session-adapter';

export const DS_IDE_DEBUG_TYPE = 'ds-ide';

// FR-TRN-2: marks a resolved config as "just built and deployed". VS Code's
// Restart relaunches the session with the config it already resolved and
// (unless launch.json changed) does not call resolveDebugConfiguration
// again, so the session adapter consumes this id on launch: a fresh id means
// the emulator is already up; a consumed or missing one means a Restart,
// and the adapter rebuilds + redeploys itself.
export const LAUNCH_ID_KEY = '__dsIdeLaunchId';

export class DaisyRunConfigurationProvider implements vscode.DebugConfigurationProvider {
  private readonly freshLaunchIds = new Set<string>();

  constructor(
    private readonly onBuildAndDeploy: (token: vscode.CancellationToken) => Promise<boolean>,
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
    const ok = await this.buildAndDeployWithProgress();
    if (!ok) return undefined;
    // FR-TRN-1/2: both Ctrl+F5 and F5 start a live ds-ide session
    // (RunSessionAdapter) that lasts as long as the emulator does. For F5,
    // the adapter attaches daisy-debug as its child session.
    const launchId = crypto.randomUUID();
    this.freshLaunchIds.add(launchId);
    return { ...config, [LAUNCH_ID_KEY]: launchId };
  }

  consumeLaunch(config: Record<string, unknown>): boolean {
    const id = config[LAUNCH_ID_KEY];
    return typeof id === 'string' && this.freshLaunchIds.delete(id);
  }

  // F5 otherwise sits silent for however long the cmake build + deploy
  // takes, with no indication anything is happening (FR-QA-EXT-9).
  // cancellable: true lets the user abort a hung build/deploy instead of
  // reloading the extension host window (FR-EXT-16). `token` lets a session
  // Stop cancel a Restart's rebuild too (FR-TRN-2).
  async buildAndDeployWithProgress(token?: vscode.CancellationToken): Promise<boolean> {
    if (token?.isCancellationRequested) return false;
    return vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'ds-ide: building and deploying…', cancellable: true },
      async (_progress, progressToken) => {
        const linked = new vscode.CancellationTokenSource();
        const subs = [
          progressToken.onCancellationRequested(() => linked.cancel()),
          token?.onCancellationRequested(() => linked.cancel()),
        ];
        try {
          return await this.onBuildAndDeploy(linked.token);
        } finally {
          for (const sub of subs) sub?.dispose();
          linked.dispose();
        }
      },
    );
  }

  // The daisy-debug (lldb-dap) session is a child of the live ds-ide
  // session: with lifecycleManagedByParent, the debug toolbar's Restart and
  // Stop go to the ds-ide session, which rebuilds / stops the emulator.
  async attachDebugger(parent: vscode.DebugSession, pid: number): Promise<boolean> {
    const folder = resolveActiveFolder(this.workspaceState);
    const started = await vscode.debug.startDebugging(
      folder,
      { type: DAISY_DEBUG_TYPE, request: 'attach', name: 'Daisy Debug', pid },
      { parentSession: parent, lifecycleManagedByParent: true, compact: true },
    );
    if (!started) {
      void vscode.window.showErrorMessage('ds-ide: failed to start debug session');
    }
    return started;
  }
}

export class DsIdeDebugAdapterDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {
  constructor(private readonly makeHost: (session: vscode.DebugSession) => RunSessionHost) {}

  createDebugAdapterDescriptor(session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
    return new vscode.DebugAdapterInlineImplementation(new RunSessionAdapter(this.makeHost(session)));
  }
}
