import * as vscode from 'vscode';
import { EmulatorManager } from '../emulator/manager';

export async function deployToEmulator(
  manager: EmulatorManager,
  outputChannel: vscode.OutputChannel,
): Promise<boolean> {
  outputChannel.show();

  try {
    await manager.deploy((line) => outputChannel.appendLine(line));
    void vscode.window.showInformationMessage('ds-ide: emulator running');
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`ds-ide: deploy failed — ${msg}`);
    return false;
  }
}
