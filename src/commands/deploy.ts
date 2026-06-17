import * as vscode from 'vscode';
import { EmulatorManager } from '../emulator/manager';

export async function deployToEmulator(manager: EmulatorManager): Promise<void> {
  const channel = vscode.window.createOutputChannel('Daisy IDE Emulator');
  channel.show();

  try {
    await manager.deploy((line) => channel.appendLine(line));
    void vscode.window.showInformationMessage('ds-ide: emulator running');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`ds-ide: deploy failed — ${msg}`);
  }
}
