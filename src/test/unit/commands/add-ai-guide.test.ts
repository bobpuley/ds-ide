import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
  AGENT_FILES,
  GUIDE_FILE,
  POINTER_LINE,
  POINTER_MARKER,
  addAiGuideToProject,
  agentsMdTemplate,
  appendPointer,
  scaffoldAiFiles,
} from '../../../commands/add-ai-guide';

const fsMock = vscode.workspace.fs as unknown as {
  readFile: ReturnType<typeof vi.fn>;
  writeFile: ReturnType<typeof vi.fn>;
  stat: ReturnType<typeof vi.fn>;
  createDirectory: ReturnType<typeof vi.fn>;
};
const showQuickPick = vscode.window.showQuickPick as ReturnType<typeof vi.fn>;
const showInfo = vscode.window.showInformationMessage as ReturnType<typeof vi.fn>;
const showWarn = vscode.window.showWarningMessage as ReturnType<typeof vi.fn>;
const showError = vscode.window.showErrorMessage as ReturnType<typeof vi.fn>;

const EXT = '/ext';
const ROOT = '/proj';
const SHIPPED = '# Daisy IDE guide for AI coding agents\nshipped text\n';
const enc = (s: string) => Buffer.from(s, 'utf8');
const dec = (b: Uint8Array) => Buffer.from(b).toString('utf8');

/** In-memory file system behind the vscode.workspace.fs mock. */
let files: Map<string, string>;

function notFound(): Error {
  return Object.assign(new Error('FileNotFound'), { code: 'FileNotFound' });
}

const workspaceState = { get: vi.fn(), update: vi.fn(async () => undefined) } as unknown as vscode.Memento;

beforeEach(() => {
  vi.clearAllMocks();
  files = new Map([[`${EXT}/ai/${GUIDE_FILE}`, SHIPPED]]);
  fsMock.readFile.mockReset();
  fsMock.readFile.mockImplementation(async (uri: { fsPath: string }) => {
    const t = files.get(uri.fsPath);
    if (t === undefined) throw notFound();
    return enc(t);
  });
  fsMock.writeFile.mockReset();
  fsMock.writeFile.mockImplementation(async (uri: { fsPath: string }, data: Uint8Array) => {
    files.set(uri.fsPath, dec(data));
  });
  fsMock.stat.mockReset();
  fsMock.stat.mockImplementation(async (uri: { fsPath: string }) => {
    if (!files.has(uri.fsPath)) throw notFound();
    return { type: 1 };
  });
  fsMock.createDirectory.mockReset();
  fsMock.createDirectory.mockResolvedValue(undefined);
  (vscode.Uri.joinPath as ReturnType<typeof vi.fn>).mockReset();
  (vscode.Uri.joinPath as ReturnType<typeof vi.fn>).mockImplementation(
    (base: { fsPath: string }, ...parts: string[]) => {
      const joined = [base.fsPath, ...parts].join('/');
      return { fsPath: joined, toString: () => joined };
    },
  );
  (vscode.workspace as { workspaceFolders: unknown }).workspaceFolders = [
    { uri: { fsPath: ROOT, toString: () => ROOT }, name: 'proj', index: 0 },
  ];
  showQuickPick.mockReset();
  showInfo.mockReset();
  showWarn.mockReset();
  showError.mockReset();
  // The agent-file QuickPick: keep everything that is pre-selected.
  showQuickPick.mockImplementation(async (items: { picked?: boolean }[]) => items.filter((i) => i.picked));
});

describe('appendPointer', () => {
  it('adds the marked line after a blank line', () => {
    expect(appendPointer('# Rules\nBe nice.\n')).toBe(`# Rules\nBe nice.\n\n${POINTER_LINE}\n`);
  });

  it('adds a missing final newline first', () => {
    expect(appendPointer('# Rules')).toBe(`# Rules\n\n${POINTER_LINE}\n`);
  });

  it('writes only the line into an empty file', () => {
    expect(appendPointer('')).toBe(`${POINTER_LINE}\n`);
  });

  it('keeps CRLF line endings', () => {
    expect(appendPointer('a\r\nb\r\n')).toBe(`a\r\nb\r\n\r\n${POINTER_LINE}\r\n`);
  });

  it('is idempotent: text that already has the marker is returned unchanged', () => {
    const once = appendPointer('# Rules\n');
    expect(appendPointer(once)).toBe(once);
    expect(appendPointer(`x\n${POINTER_MARKER} custom wording\n`)).toBe(`x\n${POINTER_MARKER} custom wording\n`);
  });

  it('never rewrites the existing content', () => {
    const existing = '# Mine\n\n  indented\ttab\n\n\n';
    expect(appendPointer(existing).startsWith(existing)).toBe(true);
  });
});

describe('agent file list and AGENTS.md template', () => {
  it('lists the agent files named in FR-AIG-4', () => {
    expect([...AGENT_FILES]).toEqual([
      'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.github/copilot-instructions.md',
      '.cursorrules', '.windsurfrules', '.clinerules',
    ]);
  });

  it('AGENTS.md names the guide, carries the marker, and is short', () => {
    const t = agentsMdTemplate();
    expect(t).toContain(GUIDE_FILE);
    expect(t).toContain(POINTER_MARKER);
    expect(t.split('\n').length).toBeLessThan(15);
  });
});

describe('scaffoldAiFiles (new projects, FR-AIG-3)', () => {
  const project = { fsPath: '/dest/myEffect', toString: () => '/dest/myEffect' } as vscode.Uri;

  it('writes the guide as a real copy and an AGENTS.md that names it', async () => {
    await scaffoldAiFiles(EXT, project);
    expect(files.get(`/dest/myEffect/${GUIDE_FILE}`)).toBe(SHIPPED);
    expect(files.get('/dest/myEffect/AGENTS.md')).toBe(agentsMdTemplate());
  });

  it('warns and does not throw when a write fails', async () => {
    fsMock.writeFile.mockRejectedValue(new Error('disk full'));
    await expect(scaffoldAiFiles(EXT, project)).resolves.toBeUndefined();
    expect(showWarn).toHaveBeenCalledWith(expect.stringContaining('AI guide'));
  });

  it('warns when the shipped guide cannot be read', async () => {
    files.delete(`${EXT}/ai/${GUIDE_FILE}`);
    await expect(scaffoldAiFiles(EXT, project)).resolves.toBeUndefined();
    expect(showWarn).toHaveBeenCalledWith(expect.stringContaining('AI guide'));
  });
});

describe('addAiGuideToProject (FR-AIG-4)', () => {
  it('tells the user to open a folder when there is none', async () => {
    (vscode.workspace as { workspaceFolders: unknown }).workspaceFolders = undefined;
    await addAiGuideToProject(EXT, workspaceState);
    expect(showInfo).toHaveBeenCalledWith(expect.stringContaining('Open a folder'));
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });

  it('copies the guide and appends the marked line to the agent files the user keeps selected', async () => {
    files.set(`${ROOT}/CLAUDE.md`, '# Claude rules\n');
    files.set(`${ROOT}/.github/copilot-instructions.md`, 'Be brief.\n');
    await addAiGuideToProject(EXT, workspaceState);

    expect(files.get(`${ROOT}/${GUIDE_FILE}`)).toBe(SHIPPED);
    expect(files.get(`${ROOT}/CLAUDE.md`)).toBe(`# Claude rules\n\n${POINTER_LINE}\n`);
    expect(files.get(`${ROOT}/.github/copilot-instructions.md`)).toBe(`Be brief.\n\n${POINTER_LINE}\n`);
    // Offered both, all pre-selected.
    const items = showQuickPick.mock.calls[0]![0] as { label: string; picked: boolean }[];
    expect(items.map((i) => i.label)).toEqual(['CLAUDE.md', '.github/copilot-instructions.md']);
    expect(items.every((i) => i.picked)).toBe(true);
    expect(showQuickPick.mock.calls[0]![1]).toMatchObject({ canPickMany: true });
  });

  it('only touches the files the user ticks', async () => {
    files.set(`${ROOT}/CLAUDE.md`, 'c\n');
    files.set(`${ROOT}/GEMINI.md`, 'g\n');
    showQuickPick.mockImplementation(async (items: { label: string }[]) => items.filter((i) => i.label === 'GEMINI.md'));
    await addAiGuideToProject(EXT, workspaceState);
    expect(files.get(`${ROOT}/CLAUDE.md`)).toBe('c\n');
    expect(files.get(`${ROOT}/GEMINI.md`)).toContain(POINTER_MARKER);
  });

  it('a second run changes nothing', async () => {
    files.set(`${ROOT}/CLAUDE.md`, '# Claude rules\n');
    await addAiGuideToProject(EXT, workspaceState);
    const snapshot = new Map(files);
    fsMock.writeFile.mockClear();
    await addAiGuideToProject(EXT, workspaceState);
    expect(files).toEqual(snapshot);
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });

  it('with no agent file, offers to create AGENTS.md and creates it on accept', async () => {
    showInfo.mockResolvedValueOnce('Create AGENTS.md');
    await addAiGuideToProject(EXT, workspaceState);
    expect(files.get(`${ROOT}/AGENTS.md`)).toBe(agentsMdTemplate());
    expect(showQuickPick).not.toHaveBeenCalled();
  });

  it('with no agent file, declining leaves only the guide copied', async () => {
    showInfo.mockResolvedValue(undefined);
    await addAiGuideToProject(EXT, workspaceState);
    expect(files.has(`${ROOT}/${GUIDE_FILE}`)).toBe(true);
    expect(files.has(`${ROOT}/AGENTS.md`)).toBe(false);
  });

  it('writes nothing to the guide when the project copy is identical', async () => {
    files.set(`${ROOT}/${GUIDE_FILE}`, SHIPPED);
    showInfo.mockResolvedValue(undefined);
    await addAiGuideToProject(EXT, workspaceState);
    const guideWrites = (fsMock.writeFile.mock.calls as [{ fsPath: string }, unknown][]).filter((c) =>
      c[0].fsPath.endsWith(GUIDE_FILE));
    expect(guideWrites).toHaveLength(0);
  });

  it('asks before replacing a different guide, and replaces it on confirm', async () => {
    files.set(`${ROOT}/${GUIDE_FILE}`, 'old guide\n');
    showWarn.mockResolvedValue('Replace');
    showInfo.mockResolvedValue(undefined);
    await addAiGuideToProject(EXT, workspaceState);
    expect(showWarn).toHaveBeenCalledWith(expect.stringContaining(GUIDE_FILE), { modal: true }, 'Replace');
    expect(files.get(`${ROOT}/${GUIDE_FILE}`)).toBe(SHIPPED);
  });

  it('keeps a different guide when the user does not confirm, and still offers the pointer step', async () => {
    files.set(`${ROOT}/${GUIDE_FILE}`, 'my edited guide\n');
    files.set(`${ROOT}/AGENTS.md`, '# Team\n');
    showWarn.mockResolvedValue(undefined);
    await addAiGuideToProject(EXT, workspaceState);
    expect(files.get(`${ROOT}/${GUIDE_FILE}`)).toBe('my edited guide\n');
    expect(files.get(`${ROOT}/AGENTS.md`)).toContain(POINTER_MARKER);
  });

  it('cancelling the file picker appends nothing', async () => {
    files.set(`${ROOT}/CLAUDE.md`, 'c\n');
    showQuickPick.mockResolvedValue(undefined);
    await addAiGuideToProject(EXT, workspaceState);
    expect(files.get(`${ROOT}/CLAUDE.md`)).toBe('c\n');
  });

  it('asks which folder to use in a multi-root workspace', async () => {
    const folders = [
      { uri: { fsPath: '/a', toString: () => '/a' }, name: 'a', index: 0 },
      { uri: { fsPath: '/b', toString: () => '/b' }, name: 'b', index: 1 },
    ];
    (vscode.workspace as { workspaceFolders: unknown }).workspaceFolders = folders;
    showQuickPick.mockResolvedValueOnce({ label: 'b', folder: folders[1] });
    showInfo.mockResolvedValue(undefined);
    await addAiGuideToProject(EXT, workspaceState);
    expect(files.has(`/b/${GUIDE_FILE}`)).toBe(true);
    expect(files.has(`/a/${GUIDE_FILE}`)).toBe(false);
  });

  it('reports a failed append and keeps going with the other files', async () => {
    files.set(`${ROOT}/CLAUDE.md`, 'c\n');
    files.set(`${ROOT}/GEMINI.md`, 'g\n');
    fsMock.writeFile.mockImplementation(async (uri: { fsPath: string }, data: Uint8Array) => {
      if (uri.fsPath.endsWith('CLAUDE.md')) throw new Error('read-only');
      files.set(uri.fsPath, dec(data));
    });
    await addAiGuideToProject(EXT, workspaceState);
    expect(files.get(`${ROOT}/GEMINI.md`)).toContain(POINTER_MARKER);
    expect(showError).toHaveBeenCalledWith(expect.stringContaining('CLAUDE.md'));
  });

  it('shows an error and writes nothing when the shipped guide is missing', async () => {
    files.delete(`${EXT}/ai/${GUIDE_FILE}`);
    await addAiGuideToProject(EXT, workspaceState);
    expect(showError).toHaveBeenCalledWith(expect.stringContaining('AI guide'));
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });

  it('summarises what it did', async () => {
    files.set(`${ROOT}/CLAUDE.md`, 'c\n');
    await addAiGuideToProject(EXT, workspaceState);
    const msg = showInfo.mock.calls.map((c) => String(c[0])).join('\n');
    expect(msg).toContain(GUIDE_FILE);
    expect(msg).toContain('CLAUDE.md');
  });
});

describe('the command is contributed and registered (FR-AIG-4)', () => {
  const root = path.join(__dirname, '../../../..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

  it('is declared with a title the README names', () => {
    const cmd = pkg.contributes.commands.find((c: { command: string }) => c.command === 'ds-ide.addAiGuide');
    expect(cmd).toBeDefined();
    expect(cmd.title).toBe('Add AI Guide to Project');
    expect(cmd.category).toBe('Daisy IDE');
  });

  it('is reachable from the Daisy view menu and not hidden from the Command Palette', () => {
    const inView = pkg.contributes.menus['view/title'].some(
      (m: { command: string; when: string }) => m.command === 'ds-ide.addAiGuide' && m.when.includes('ds-ide.daisyView'),
    );
    expect(inView).toBe(true);
    const palette: { command: string; when?: string }[] = pkg.contributes.menus.commandPalette ?? [];
    expect(palette.find(m => m.command === 'ds-ide.addAiGuide')).toBeUndefined();
  });

  it('is registered by the extension', () => {
    const src = fs.readFileSync(path.join(root, 'src/extension.ts'), 'utf8');
    expect(src).toContain("registerCommand('ds-ide.addAiGuide'");
    expect(src).toContain('addAiGuideToProject(extensionPath, workspaceState)');
  });
});
