import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { EmulatorManager, BuildOptions } from '../emulator/manager';

export async function buildForEmulator(
  manager: EmulatorManager,
  extensionPath: string,
): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    void vscode.window.showErrorMessage('ds-ide: no workspace folder open');
    return;
  }
  const projectRoot = folders[0]!.uri.fsPath;

  const effectSrc = detectEffectSrc(projectRoot);
  if (!effectSrc) {
    void vscode.window.showErrorMessage(
      'ds-ide: no effect .cpp found at workspace root. Add one or configure EFFECT_SRC.',
    );
    return;
  }

  const daisySpDir = detectDaisySP(projectRoot);
  const emulatorSrc = path.join(extensionPath, 'emulator');

  const opts: BuildOptions = { projectRoot, effectSrc, emulatorSrc };
  if (daisySpDir) opts.daisySpDir = daisySpDir;

  const channel = vscode.window.createOutputChannel('Daisy IDE Build');
  channel.show();

  try {
    await manager.build(opts, (line) => channel.appendLine(line));
    void vscode.window.showInformationMessage('ds-ide: build succeeded');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`ds-ide: build failed — ${msg}`);
  }
}

export function detectEffectSrc(projectRoot: string): string | undefined {
  const excluded = new Set(['libDaisy', 'DaisySP', 'libdaisy', 'daisysp', '.ds-ide']);
  try {
    const entries = fs.readdirSync(projectRoot);
    const cpps = entries.filter((e) => {
      if (!e.endsWith('.cpp')) return false;
      if (excluded.has(e)) return false;
      return true;
    });
    if (cpps.length === 1) return path.join(projectRoot, cpps[0]!);
    if (cpps.length > 1) {
      // prefer a file not named 'main.cpp' if there are several
      const nonMain = cpps.filter((f) => f !== 'main.cpp');
      if (nonMain.length === 1) return path.join(projectRoot, nonMain[0]!);
    }
  } catch {
    // ignore fs errors
  }
  return undefined;
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
