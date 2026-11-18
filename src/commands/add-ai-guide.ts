import * as vscode from 'vscode';
import * as path from 'path';
import { promptSelectActiveFolder } from '../workspace/active-folder';

// FR-AIG-3/4: the AI agent guide (ai/DAISY_IDE_AI_GUIDE.md in the package) and
// the helpers that put it into a project and point the project's coding-agent
// instruction files at it.

export const GUIDE_FILE = 'DAISY_IDE_AI_GUIDE.md';

/** Marks a pointer line this extension wrote, so a second run recognises it. */
export const POINTER_MARKER = '<!-- ds-ide:ai-guide -->';
export const POINTER_LINE =
  `${POINTER_MARKER} Read ${GUIDE_FILE} before editing the effect source (Daisy IDE conventions).`;

/**
 * Agent instruction files the command recognises, relative to the project root.
 * The one place to add a new agent's convention (FR-AIG-4).
 */
export const AGENT_FILES: readonly string[] = [
  'AGENTS.md',
  'CLAUDE.md',
  'GEMINI.md',
  '.github/copilot-instructions.md',
  '.cursorrules',
  '.windsurfrules',
  '.clinerules',
];

const CREATE_AGENTS_MD = 'Create AGENTS.md';
const REPLACE = 'Replace';

/** The AGENTS.md written into new projects, and offered when a project has no agent file. */
export function agentsMdTemplate(): string {
  return [
    '# Agent instructions',
    '',
    'This is a Daisy Seed effect project developed with Daisy IDE (VS Code extension).',
    '',
    `${POINTER_MARKER} Read ${GUIDE_FILE} before changing the effect source.`,
    'It lists the code conventions the IDE depends on (the `ds-ide:` blocks, `controllers.yaml`) and what the emulator supports.',
    '',
  ].join('\n');
}

/**
 * Append the pointer line to an agent file's text. Existing content is kept
 * byte for byte; text that already carries the marker is returned unchanged.
 */
export function appendPointer(text: string): string {
  if (text.includes(POINTER_MARKER)) return text;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  if (text === '') return POINTER_LINE + eol;
  const closed = text.endsWith('\n') ? text : text + eol;
  return `${closed}${eol}${POINTER_LINE}${eol}`;
}

const enc = (s: string): Uint8Array => Buffer.from(s, 'utf8');
const dec = (b: Uint8Array): string => Buffer.from(b).toString('utf8');

async function readShippedGuide(extensionPath: string): Promise<string> {
  return dec(await vscode.workspace.fs.readFile(vscode.Uri.file(path.join(extensionPath, 'ai', GUIDE_FILE))));
}

/** The file's text, or undefined when it does not exist. Other failures propagate. */
async function readIfExists(uri: vscode.Uri): Promise<string | undefined> {
  try {
    return dec(await vscode.workspace.fs.readFile(uri));
  } catch (err) {
    const code = (err as { code?: unknown } | undefined)?.code;
    if (code === 'FileNotFound' || code === 'ENOENT') return undefined;
    throw err;
  }
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch (err) {
    const code = (err as { code?: unknown } | undefined)?.code;
    if (code === 'FileNotFound' || code === 'ENOENT') return false;
    throw err;
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * New projects (FR-AIG-3): a real copy of the guide plus an AGENTS.md pointing
 * at it. A failure only warns — the project itself is already scaffolded.
 */
export async function scaffoldAiFiles(extensionPath: string, projectUri: vscode.Uri): Promise<void> {
  try {
    const guide = await readShippedGuide(extensionPath);
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(projectUri, GUIDE_FILE), enc(guide));
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(projectUri, 'AGENTS.md'), enc(agentsMdTemplate()));
  } catch (err) {
    void vscode.window.showWarningMessage(
      `ds-ide: the project was created, but the AI guide could not be added — ${errText(err)}. ` +
        'Use "Daisy IDE: Add AI Guide to Project" to add it later.',
    );
  }
}

/** Copy the guide into `folder`; asks before replacing a different copy. */
async function copyGuideInto(guide: string, folder: vscode.Uri): Promise<'written' | 'unchanged' | 'kept'> {
  const target = vscode.Uri.joinPath(folder, GUIDE_FILE);
  const current = await readIfExists(target);
  if (current === guide) return 'unchanged';
  if (current !== undefined) {
    const choice = await vscode.window.showWarningMessage(
      `${GUIDE_FILE} already exists and differs from the version shipped with this extension. Replace it?`,
      { modal: true },
      REPLACE,
    );
    if (choice !== REPLACE) return 'kept';
  }
  await vscode.workspace.fs.writeFile(target, enc(guide));
  return 'written';
}

interface AgentFileItem extends vscode.QuickPickItem {
  rel: string;
}

/** **Daisy IDE: Add AI Guide to Project** (FR-AIG-4). */
export async function addAiGuideToProject(extensionPath: string, workspaceState: vscode.Memento): Promise<void> {
  const folder = await promptSelectActiveFolder(workspaceState);
  if (!folder) {
    void vscode.window.showInformationMessage('ds-ide: Open a folder first, then add the AI guide to it.');
    return;
  }

  let guide: string;
  try {
    guide = await readShippedGuide(extensionPath);
  } catch (err) {
    void vscode.window.showErrorMessage(`ds-ide: the AI guide shipped with the extension could not be read — ${errText(err)}`);
    return;
  }

  const summary: string[] = [];
  try {
    const result = await copyGuideInto(guide, folder.uri);
    if (result === 'written') summary.push(`copied ${GUIDE_FILE}`);
    else if (result === 'unchanged') summary.push(`${GUIDE_FILE} was already up to date`);
    else summary.push(`kept your ${GUIDE_FILE}`);
  } catch (err) {
    void vscode.window.showErrorMessage(`ds-ide: could not write ${GUIDE_FILE} — ${errText(err)}`);
    return;
  }

  const found: AgentFileItem[] = [];
  for (const rel of AGENT_FILES) {
    if (await exists(vscode.Uri.joinPath(folder.uri, ...rel.split('/')))) {
      found.push({ label: rel, picked: true, rel });
    }
  }

  if (found.length > 0) {
    const chosen = await vscode.window.showQuickPick(found, {
      canPickMany: true,
      placeHolder: `Add a line pointing to ${GUIDE_FILE} to these agent files (existing content is kept)`,
    });
    for (const item of chosen ?? []) {
      const uri = vscode.Uri.joinPath(folder.uri, ...item.rel.split('/'));
      try {
        const before = (await readIfExists(uri)) ?? '';
        const after = appendPointer(before);
        if (after === before) {
          summary.push(`${item.rel} already points to the guide`);
        } else {
          await vscode.workspace.fs.writeFile(uri, enc(after));
          summary.push(`added the pointer to ${item.rel}`);
        }
      } catch (err) {
        void vscode.window.showErrorMessage(`ds-ide: could not update ${item.rel} — ${errText(err)}`);
      }
    }
  } else {
    const choice = await vscode.window.showInformationMessage(
      'No coding-agent instruction file found in this folder. Create AGENTS.md so agents find the guide?',
      CREATE_AGENTS_MD,
    );
    if (choice === CREATE_AGENTS_MD) {
      try {
        await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder.uri, 'AGENTS.md'), enc(agentsMdTemplate()));
        summary.push('created AGENTS.md');
      } catch (err) {
        void vscode.window.showErrorMessage(`ds-ide: could not create AGENTS.md — ${errText(err)}`);
      }
    }
  }

  void vscode.window.showInformationMessage(`ds-ide: ${summary.join('; ')}.`);
}
