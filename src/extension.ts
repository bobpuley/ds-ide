import * as vscode from 'vscode';
import { EmulatorManager } from './emulator/manager';
import { ScopePanel } from './webview/scope-panel';
import { buildForEmulator } from './commands/build';
import { deployToEmulator } from './commands/deploy';
import { startAudio, stopAudio } from './commands/transport';

let manager: EmulatorManager | undefined;
let scopePanel: ScopePanel | undefined;

export function activate(context: vscode.ExtensionContext): void {
  manager = new EmulatorManager();
  scopePanel = new ScopePanel(manager);

  context.subscriptions.push(
    vscode.commands.registerCommand('ds-ide.build', () =>
      buildForEmulator(manager!, context.extensionPath),
    ),
    vscode.commands.registerCommand('ds-ide.deploy', () => {
      scopePanel!.show();
      return deployToEmulator(manager!);
    }),
    vscode.commands.registerCommand('ds-ide.start', () => startAudio(manager!)),
    vscode.commands.registerCommand('ds-ide.stop', () => stopAudio(manager!)),
    { dispose: () => { manager?.dispose(); scopePanel?.dispose(); } },
  );
}

export function deactivate(): void {
  manager?.dispose();
  scopePanel?.dispose();
}
