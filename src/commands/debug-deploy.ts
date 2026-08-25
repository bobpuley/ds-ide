import * as vscode from 'vscode';
import { EmulatorManager } from '../emulator/manager';
import { ControllerDef } from '../controllers/controller-config';
import { resolveActiveFolder } from '../workspace/active-folder';

export const DAISY_DEBUG_TYPE = 'daisy-debug';

export async function debugDeploy(
  manager: EmulatorManager,
  loadDefs: () => ControllerDef[],
  showPanel: (defs: ControllerDef[], snapshot: Record<number, number>) => void,
  getPotSnapshot: () => Record<number, number>,
  sendSine: (() => void) | undefined,
  outputChannel: vscode.OutputChannel,
  workspaceState: vscode.Memento,
): Promise<void> {
  const channel = outputChannel;
  channel.show();

  try {
    const defs = loadDefs();
    showPanel(defs, getPotSnapshot());
    await manager.deploy((line) => channel.appendLine(line));
    // Debug-attach path only ever replayed pot state (button snapshot was
    // never sent here even before FR-DEV-1) — preserved as-is by passing an
    // empty button-values map into the now-unified controlSnapshot.
    manager.sendControlSnapshot(getPotSnapshot(), {});
    sendSine?.();
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

  const folder = resolveActiveFolder(workspaceState);
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
