import * as vscode from 'vscode';
import { buildForEmulator } from './commands/build';
import { deployToEmulator } from './commands/deploy';
import { startAudio, stopAudio } from './commands/transport';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('ds-ide.build', buildForEmulator),
    vscode.commands.registerCommand('ds-ide.deploy', deployToEmulator),
    vscode.commands.registerCommand('ds-ide.start', startAudio),
    vscode.commands.registerCommand('ds-ide.stop', stopAudio),
  );
}

export function deactivate(): void {
  // nothing to tear down yet
}
