import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { EmulatorManager, BuildOptions } from '../emulator/manager';
import { parseBuildLine, applyDiagnostics, ParsedDiagnostic } from '../diagnostics/build-diagnostics';
import { detectNonPortableSymbol } from '../diagnostics/non-portable';

export async function buildForEmulator(
  manager: EmulatorManager,
  extensionPath: string,
  diagnostics: vscode.DiagnosticCollection | undefined,
  outputChannel: vscode.OutputChannel,
): Promise<boolean> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    void vscode.window.showErrorMessage('ds-ide: no workspace folder open');
    return false;
  }
  const projectRoot = folders[0]!.uri.fsPath;

  const effectSrc = await detectEffectSrc(projectRoot);
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
    void vscode.window.showInformationMessage('ds-ide: build succeeded');
    return true;
  } catch (err) {
    if (diagnostics) applyDiagnostics(diagnostics, parsed, projectRoot);
    const nonPortable = detectNonPortableSymbol(rawLines);
    if (nonPortable) {
      void vscode.window.showErrorMessage(
        `ds-ide: build failed — symbol '${nonPortable}' is not emulated. ` +
        `Add a stub or remove this hardware-only API call.`,
      );
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`ds-ide: build failed — ${msg}`);
    }
    return false;
  }
}

export async function detectEffectSrc(projectRoot: string): Promise<string | undefined> {
  const excluded = new Set(['libDaisy', 'DaisySP', 'libdaisy', 'daisysp', '.ds-ide']);

  async function findCpp(dir: string): Promise<string | undefined> {
    try {
      const entries = (await fs.promises.readdir(dir)) as string[];
      const cpps = entries.filter((e) => {
        if (!e.endsWith('.cpp')) return false;
        if (excluded.has(e)) return false;
        return true;
      });
      if (cpps.length === 1) return path.join(dir, cpps[0]!);
      if (cpps.length > 1) {
        const nonMain = cpps.filter((f) => f !== 'main.cpp');
        if (nonMain.length === 1) return path.join(dir, nonMain[0]!);
      }
    } catch { /* ignore fs errors */ }
    return undefined;
  }

  const r1 = await findCpp(projectRoot);
  if (r1) return r1;
  const r2 = await findCpp(path.join(projectRoot, 'src'));
  if (r2) return r2;
  return findCpp(path.join(projectRoot, 'source'));
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
