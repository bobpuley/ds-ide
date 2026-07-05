import * as vscode from 'vscode';

const ACTIVE_FOLDER_KEY = 'ds-ide.activeFolder';

// Centralizes "which workspace folder does ds-ide operate on" — every
// workspace-dependent command previously hardcoded workspaceFolders[0],
// silently ignoring any other folder in a multi-root workspace (FR-UX-4).
// With exactly one folder there's nothing to choose; with multiple, the
// user's persisted choice (set via promptSelectActiveFolder) wins, falling
// back to the first folder until they choose one explicitly.
export function resolveActiveFolder(workspaceState: vscode.Memento): vscode.WorkspaceFolder | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return undefined;
  if (folders.length === 1) return folders[0];
  const savedPath = workspaceState.get<string>(ACTIVE_FOLDER_KEY);
  const match = savedPath ? folders.find(f => f.uri.fsPath === savedPath) : undefined;
  return match ?? folders[0];
}

// Quick-pick prompt letting the user choose among multiple workspace
// folders; persists the choice in workspaceState so future ds-ide commands
// operate on it instead of always folder 0 (FR-UX-4).
export async function promptSelectActiveFolder(
  workspaceState: vscode.Memento,
): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return undefined;
  if (folders.length === 1) return folders[0];

  const picked = await vscode.window.showQuickPick(
    folders.map(f => ({ label: f.name, description: f.uri.fsPath, folder: f })),
    { placeHolder: 'Select the workspace folder ds-ide should operate on' },
  );
  if (!picked) return undefined;

  await workspaceState.update(ACTIVE_FOLDER_KEY, picked.folder.uri.fsPath);
  return picked.folder;
}
