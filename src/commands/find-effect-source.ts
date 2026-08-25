import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

const EXCLUDED = new Set(['libDaisy', 'DaisySP', 'libdaisy', 'daisysp', '.ds-ide']);

// A committed .vscode/settings.json can set ds-ide.effectSource to any path,
// absolute or relative-with-traversal — without this check that path would
// be trusted to redirect wiring edits outside the workspace entirely (FR-UX-3).
export class EffectSourceOutsideWorkspaceError extends Error {
  constructor(public readonly resolvedPath: string, public readonly workspaceRoot: string) {
    super(`ds-ide.effectSource ('${resolvedPath}') resolves outside the workspace folder ('${workspaceRoot}')`);
    this.name = 'EffectSourceOutsideWorkspaceError';
  }
}

function isWithinRoot(candidate: string, root: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(resolvedRoot + path.sep);
}

async function findCpp(dir: string): Promise<string | undefined> {
  try {
    const entries = (await fs.promises.readdir(dir)) as string[];
    const cpps = entries.filter(e => e.endsWith('.cpp') && !EXCLUDED.has(e));
    if (cpps.length === 1) return path.join(dir, cpps[0]!);
    if (cpps.length > 1) {
      const nonMain = cpps.filter(f => f !== 'main.cpp');
      if (nonMain.length === 1) return path.join(dir, nonMain[0]!);
    }
  } catch { /* ignore fs errors */ }
  return undefined;
}

export async function findEffectSource(
  projectRoot: string,
  configured?: string,
): Promise<string | undefined> {
  if (configured) {
    const p = path.isAbsolute(configured) ? configured : path.join(projectRoot, configured);
    if (!isWithinRoot(p, projectRoot)) {
      throw new EffectSourceOutsideWorkspaceError(path.resolve(p), path.resolve(projectRoot));
    }
    try { await fs.promises.access(p); return p; } catch { /* not accessible */ }
  }
  const r1 = await findCpp(projectRoot);
  if (r1) return r1;
  const r2 = await findCpp(path.join(projectRoot, 'src'));
  if (r2) return r2;
  return findCpp(path.join(projectRoot, 'source'));
}

// Shared resolution/error-handling wrapper: reads the ds-ide.effectSource
// setting and reports a misconfigured (outside-workspace) value via a user
// toast instead of throwing. Every call site that needs "the effect source
// for this folder, honoring the configured setting" — extension.ts's various
// webview/save handlers as well as the build command — routes through this
// one function so the setting can't be silently ignored by a call site that
// forgets to pass it through (FR-EXT-10).
export async function resolveConfiguredEffectSource(folder: string): Promise<string | undefined> {
  const configured = vscode.workspace.getConfiguration('ds-ide').get<string>('effectSource');
  try {
    return await findEffectSource(folder, configured);
  } catch (err) {
    if (err instanceof EffectSourceOutsideWorkspaceError) {
      void vscode.window.showErrorMessage(
        `ds-ide: ds-ide.effectSource points outside the workspace folder — refusing to use '${err.resolvedPath}'. Fix the setting to point inside '${err.workspaceRoot}'.`,
      );
      return undefined;
    }
    throw err;
  }
}
