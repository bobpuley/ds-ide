import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as vscode from 'vscode';
import { resolveActiveFolder, promptSelectActiveFolder } from '../../../workspace/active-folder';

function makeWorkspaceState(initial: Record<string, unknown> = {}): vscode.Memento {
  const store = { ...initial };
  return {
    get: vi.fn((key: string, defaultValue?: unknown) => (key in store ? store[key] : defaultValue)),
    update: vi.fn((key: string, value: unknown) => { store[key] = value; return Promise.resolve(); }),
    keys: () => Object.keys(store),
  } as unknown as vscode.Memento;
}

function folder(fsPath: string, name: string): vscode.WorkspaceFolder {
  return { uri: { fsPath }, name, index: 0 } as unknown as vscode.WorkspaceFolder;
}

describe('resolveActiveFolder (FR-UX-4)', () => {
  afterEach(() => {
    (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = undefined;
  });

  it('returns undefined when there are no workspace folders', () => {
    (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = undefined;
    expect(resolveActiveFolder(makeWorkspaceState())).toBeUndefined();
  });

  it('returns the single folder without consulting workspaceState', () => {
    const f = folder('/proj', 'proj');
    (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = [f];
    const ws = makeWorkspaceState();
    expect(resolveActiveFolder(ws)).toBe(f);
    expect(ws.get).not.toHaveBeenCalled();
  });

  it('falls back to the first folder when multiple exist and none is persisted', () => {
    const a = folder('/a', 'a');
    const b = folder('/b', 'b');
    (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = [a, b];
    expect(resolveActiveFolder(makeWorkspaceState())).toBe(a);
  });

  it('returns the persisted folder when it matches one of the current folders', () => {
    const a = folder('/a', 'a');
    const b = folder('/b', 'b');
    (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = [a, b];
    const ws = makeWorkspaceState({ 'ds-ide.activeFolder': '/b' });
    expect(resolveActiveFolder(ws)).toBe(b);
  });

  it('falls back to the first folder when the persisted path no longer matches any folder', () => {
    const a = folder('/a', 'a');
    const b = folder('/b', 'b');
    (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = [a, b];
    const ws = makeWorkspaceState({ 'ds-ide.activeFolder': '/stale' });
    expect(resolveActiveFolder(ws)).toBe(a);
  });
});

describe('promptSelectActiveFolder (FR-UX-4)', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => {
    (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = undefined;
  });

  it('returns the single folder without prompting', async () => {
    const f = folder('/proj', 'proj');
    (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = [f];
    const result = await promptSelectActiveFolder(makeWorkspaceState());
    expect(result).toBe(f);
    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
  });

  it('returns undefined when there are no workspace folders', async () => {
    (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = undefined;
    expect(await promptSelectActiveFolder(makeWorkspaceState())).toBeUndefined();
  });

  it('prompts with a quick pick and persists the chosen folder', async () => {
    const a = folder('/a', 'a');
    const b = folder('/b', 'b');
    (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = [a, b];
    (vscode.window.showQuickPick as ReturnType<typeof vi.fn>).mockImplementation(
      async (items: Array<{ folder: vscode.WorkspaceFolder }>) => items[1],
    );
    const ws = makeWorkspaceState();
    const result = await promptSelectActiveFolder(ws);
    expect(result).toBe(b);
    expect(ws.update).toHaveBeenCalledWith('ds-ide.activeFolder', '/b');
  });

  it('returns undefined and does not persist anything when the user cancels the quick pick', async () => {
    const a = folder('/a', 'a');
    const b = folder('/b', 'b');
    (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = [a, b];
    (vscode.window.showQuickPick as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const ws = makeWorkspaceState();
    const result = await promptSelectActiveFolder(ws);
    expect(result).toBeUndefined();
    expect(ws.update).not.toHaveBeenCalled();
  });
});
