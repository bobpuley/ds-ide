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

  const effectSrc = detectEffectSrc(projectRoot);
  if (!effectSrc) {
    void vscode.window.showErrorMessage(
      'ds-ide: no effect .cpp found at project root, src/, or source/. ' +
      'Add one or set ds-ide.effectSource in settings.',
    );
    return false;
  }

  const daisySpDir = detectDaisySP(projectRoot);
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

export function detectEffectSrc(projectRoot: string): string | undefined {
  const excluded = new Set(['libDaisy', 'DaisySP', 'libdaisy', 'daisysp', '.ds-ide']);

  function findCpp(dir: string): string | undefined {
    try {
      const entries = fs.readdirSync(dir);
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

  return (
    findCpp(projectRoot) ??
    findCpp(path.join(projectRoot, 'src')) ??
    findCpp(path.join(projectRoot, 'source'))
  );
}

export function detectDaisySP(projectRoot: string): string | undefined {
  const candidates = [
    path.join(projectRoot, 'DaisySP', 'Source'),
    path.join(projectRoot, 'DaisySP', 'src'),
    path.join(projectRoot, 'daisysp', 'Source'),
    path.join(projectRoot, 'daisysp', 'src'),
  ];
  return candidates.find((p) => {
    try { return fs.statSync(p).isDirectory(); } catch { return false; }
  });
}
