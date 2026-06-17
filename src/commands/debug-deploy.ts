import * as vscode from 'vscode';
import { EmulatorManager } from '../emulator/manager';
import { ControllerDef } from '../controllers/controller-config';

export const DAISY_DEBUG_TYPE = 'daisy-debug';

export async function debugDeploy(
  manager: EmulatorManager,
  loadDefs: () => ControllerDef[],
  showPanel: (defs: ControllerDef[], snapshot: Record<number, number>) => void,
  getPotSnapshot: () => Record<number, number>,
): Promise<void> {
  const channel = vscode.window.createOutputChannel('Daisy IDE Emulator');
  channel.show();

  try {
    const defs = loadDefs();
    showPanel(defs, getPotSnapshot());
    await manager.deploy((line) => channel.appendLine(line));
    manager.sendPotSnapshot(getPotSnapshot());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`ds-ide: deploy failed — ${msg}`);
    return;
  }

  const pid = manager.childPid;
  if (pid === undefined) {
    void vscode.window.showErrorMessage('ds-ide: could not determine emulator PID for debug attach');
    return;
  }

  const folder = vscode.workspace.workspaceFolders?.[0];
  const started = await vscode.debug.startDebugging(folder, {
    type: DAISY_DEBUG_TYPE,
    name: 'Daisy Debug',
    request: 'attach',
    pid,
  });

  if (!started) {
    void vscode.window.showErrorMessage('ds-ide: failed to start debug session');
  }
}
