import * as vscode from 'vscode';
import { EmulatorManager } from '../emulator/manager';

export async function deployToEmulator(
  manager: EmulatorManager,
  outputChannel: vscode.OutputChannel,
): Promise<boolean> {
  outputChannel.show();

  try {
    await manager.deploy((line) => outputChannel.appendLine(line));
    // Routine success relies on the status bar (which already transitions to
    // "running" once the emulator's first status event arrives) — an
    // additional toast here would just duplicate that signal (FR-UX-2).
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`ds-ide: deploy failed — ${msg}`);
    return false;
  }
}
