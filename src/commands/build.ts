import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { EmulatorManager, BuildOptions } from '../emulator/manager';
import { parseBuildLine, applyDiagnostics, ParsedDiagnostic } from '../diagnostics/build-diagnostics';
import { detectNonPortableSymbol } from '../diagnostics/non-portable';
import { findEffectSource } from './find-effect-source';
import { resolveActiveFolder } from '../workspace/active-folder';

export async function buildForEmulator(
  manager: EmulatorManager,
  extensionPath: string,
  diagnostics: vscode.DiagnosticCollection | undefined,
  outputChannel: vscode.OutputChannel,
  workspaceState: vscode.Memento,
): Promise<boolean> {
  const folder = resolveActiveFolder(workspaceState);
  if (!folder) {
    void vscode.window.showErrorMessage('ds-ide: no workspace folder open');
    return false;
  }
  const projectRoot = folder.uri.fsPath;

  const effectSrc = await findEffectSource(projectRoot);
  if (!effectSrc) {
    void vscode.window.showErrorMessage(
      'ds-ide: no effect .cpp found at project root, src/, or source/. ' +
      'Add one or set ds-ide.effectSource in settings.',
    );
    return false;
  }

  const daisySpDir = await detectDaisySP(projectRoot);
  const emulatorSrc = path.join(extensionPath, 'emulator');

  const opts: BuildOptions = { projectRoot, effectSrc, emulatorSrc };
  if (daisySpDir) opts.daisySpDir = daisySpDir;

  const channel = outputChannel;
  channel.show();

  const parsed: ParsedDiagnostic[] = [];
  const rawLines: string[] = [];

  const onLine = (line: string): void => {
    channel.appendLine(line);
    rawLines.push(line);
    const d = parseBuildLine(line);
    if (d) parsed.push(d);
  };

  try {
    await manager.build(opts, onLine);
    if (diagnostics) applyDiagnostics(diagnostics, parsed, projectRoot);
    // Routine success relies on the status bar, not a toast — a toast per
    // successful build/deploy drowns out the genuinely actionable warnings
    // this milestone aggregates elsewhere (FR-UX-2).
    vscode.window.setStatusBarMessage('$(check) ds-ide: build succeeded', 3000);
    return true;
  } catch (err) {
    if (diagnostics) applyDiagnostics(diagnostics, parsed, projectRoot);
    const nonPortable = detectNonPortableSymbol(rawLines);
    if (nonPortable.length > 0) {
      void vscode.window.showErrorMessage(
        `ds-ide: build failed — symbol(s) not emulated: ${nonPortable.map(s => `'${s}'`).join(', ')}. ` +
        `Add stubs or remove these hardware-only API calls.`,
      );
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`ds-ide: build failed — ${msg}`);
    }
    return false;
  }
}

export async function detectDaisySP(projectRoot: string): Promise<string | undefined> {
  const candidates = [
    path.join(projectRoot, 'DaisySP', 'Source'),
    path.join(projectRoot, 'DaisySP', 'src'),
    path.join(projectRoot, 'daisysp', 'Source'),
    path.join(projectRoot, 'daisysp', 'src'),
  ];
  for (const p of candidates) {
    try {
      const stat = await fs.promises.stat(p);
      if (stat.isDirectory()) return p;
    } catch { /* ignore */ }
  }
  return undefined;
}
