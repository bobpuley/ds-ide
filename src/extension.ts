import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { EmulatorManager } from './emulator/manager';
import { ScopePanel } from './webview/scope-panel';
import { buildForEmulator } from './commands/build';
import { deployToEmulator } from './commands/deploy';
import { startAudio, stopAudio } from './commands/transport';
import { parseControllerYaml } from './controllers/controller-config';
import { PotStore } from './controllers/pot-store';

let manager: EmulatorManager | undefined;
let scopePanel: ScopePanel | undefined;
let potStore: PotStore | undefined;

export function activate(context: vscode.ExtensionContext): void {
  potStore = new PotStore(context.workspaceState);
  manager = new EmulatorManager();
  scopePanel = new ScopePanel(manager, (channel, value) => {
    potStore?.set(channel, value);
  });

  context.subscriptions.push(
    vscode.commands.registerCommand('ds-ide.build', () =>
      buildForEmulator(manager!, context.extensionPath),
    ),
    vscode.commands.registerCommand('ds-ide.deploy', async () => {
      const defs = loadControllerDefs();
      potStore!.setDefaults(defs);
      scopePanel!.show(defs, potStore!.getSnapshot());
      await deployToEmulator(manager!);
      manager!.sendPotSnapshot(potStore!.getSnapshot());
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
