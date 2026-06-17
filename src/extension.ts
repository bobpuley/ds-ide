import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { EmulatorManager } from './emulator/manager';
import { IpcMessage } from './emulator/ipc-client';
import { ScopePanel } from './webview/scope-panel';
import { buildForEmulator } from './commands/build';
import { deployToEmulator } from './commands/deploy';
import { startAudio, stopAudio } from './commands/transport';
import { debugDeploy, DAISY_DEBUG_TYPE } from './commands/debug-deploy';
import { parseControllerYaml } from './controllers/controller-config';
import { PotStore } from './controllers/pot-store';
import { DaisyDebugAdapterFactory } from './debug/debug-adapter';

const FIDELITY_CAVEAT =
  'Emulator approximates the Seed — not bit-exact, does not validate hardware CPU/RAM budget.';

let manager: EmulatorManager | undefined;
let scopePanel: ScopePanel | undefined;
let potStore: PotStore | undefined;

export function activate(context: vscode.ExtensionContext): void {
  potStore = new PotStore(context.workspaceState);
  manager = new EmulatorManager();

  // T4.1/T4.2 — diagnostics collection shown in VS Code Problems panel
  const diagnostics = vscode.languages.createDiagnosticCollection('ds-ide');

  // T4.4 / T4.5 — status bar item: shows emulator state + fidelity caveat in tooltip
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.text = '$(circuit-board) Daisy';
  statusBar.tooltip = FIDELITY_CAVEAT;
  statusBar.show();

  scopePanel = new ScopePanel(manager, (channel, value) => {
    potStore?.set(channel, value);
  });

  // T4.3 — forward NaN/Inf audio events as VS Code notifications
  // T4.4 — handle emulator crash/disconnect without crashing ds-ide
  manager.on('message', (msg: IpcMessage) => {
    if (msg['type'] === 'event') {
      const kind = msg['kind'] as string;
      if (kind === 'nan' || kind === 'inf') {
        void vscode.window.showWarningMessage(
          `ds-ide: audio ${kind.toUpperCase()} detected — effect may misbehave`,
        );
      }
    }
    if (msg['type'] === 'status') {
      const running = msg['running'] as boolean;
      statusBar.text = running ? '$(play) Daisy: running' : '$(debug-stop) Daisy: stopped';
      statusBar.tooltip = FIDELITY_CAVEAT;
    }
  });

  manager.on('disconnect', () => {
    statusBar.text = '$(warning) Daisy: crashed';
    statusBar.tooltip = FIDELITY_CAVEAT;
    void vscode.window.showErrorMessage(
      'ds-ide: emulator disconnected unexpectedly — redeploy to restart.',
    );
  });

  // C6: register the daisy-debug adapter (lldb-dap wrapper)
  const debugAdapterFactory = new DaisyDebugAdapterFactory();

  // Update status bar on debug session lifecycle
  vscode.debug.onDidStartDebugSession((session) => {
    if (session.type === DAISY_DEBUG_TYPE) {
      statusBar.text = '$(bug) Daisy: debugging';
      statusBar.tooltip = FIDELITY_CAVEAT;
    }
  });
  vscode.debug.onDidTerminateDebugSession((session) => {
    if (session.type === DAISY_DEBUG_TYPE) {
      statusBar.text = '$(debug-stop) Daisy: stopped';
      statusBar.tooltip = FIDELITY_CAVEAT;
    }
  });

  context.subscriptions.push(
    diagnostics,
    statusBar,
    vscode.debug.registerDebugAdapterDescriptorFactory(DAISY_DEBUG_TYPE, debugAdapterFactory),
    vscode.commands.registerCommand('ds-ide.build', () =>
      buildForEmulator(manager!, context.extensionPath, diagnostics),
    ),
    vscode.commands.registerCommand('ds-ide.deploy', async () => {
      statusBar.text = '$(loading~spin) Daisy: deploying…';
      statusBar.tooltip = FIDELITY_CAVEAT;
      const defs = loadControllerDefs();
      potStore!.setDefaults(defs);
      scopePanel!.show(defs, potStore!.getSnapshot());
      await deployToEmulator(manager!);
      manager!.sendPotSnapshot(potStore!.getSnapshot());
    }),
    vscode.commands.registerCommand('ds-ide.start', () => startAudio(manager!)),
    vscode.commands.registerCommand('ds-ide.stop', () => stopAudio(manager!)),
    vscode.commands.registerCommand('ds-ide.debug', () => {
      statusBar.text = '$(loading~spin) Daisy: deploying…';
      statusBar.tooltip = FIDELITY_CAVEAT;
      const defs = loadControllerDefs();
      potStore!.setDefaults(defs);
      return debugDeploy(
        manager!,
        () => defs,
        (d, snap) => scopePanel!.show(d, snap),
        () => potStore!.getSnapshot(),
      );
    }),
    { dispose: () => { manager?.dispose(); scopePanel?.dispose(); } },
  );
}

export function deactivate(): void {
  manager?.dispose();
  scopePanel?.dispose();
}

function loadControllerDefs() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.[0]) return [];
  const yamlPath = path.join(folders[0].uri.fsPath, 'controllers.yaml');
  try {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const { defs, errors } = parseControllerYaml(text);
    for (const e of errors) {
      void vscode.window.showWarningMessage(`controllers.yaml: ${e}`);
    }
    return defs;
  } catch {
    return [];
  }
}
