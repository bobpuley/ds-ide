import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { EmulatorManager, BuildOptions, CMakeNotFoundError, CompilerNotFoundError } from '../emulator/manager';
import { parseBuildLine, applyDiagnostics, ParsedDiagnostic } from '../diagnostics/build-diagnostics';
import { detectNonPortableSymbol } from '../diagnostics/non-portable';
import { resolveConfiguredEffectSource } from './find-effect-source';
import { resolveActiveFolder } from '../workspace/active-folder';

export async function buildForEmulator(
  manager: EmulatorManager,
  extensionPath: string,
  diagnostics: vscode.DiagnosticCollection | undefined,
  outputChannel: vscode.OutputChannel,
  workspaceState: vscode.Memento,
  token?: vscode.CancellationToken,
  // FR-TRN-6: the run / debug / restart path reports a failed build through
  // its own "Build failed with N problems" notification, so it turns off the
  // generic toast here. The specific non-portable-symbol diagnosis stays.
  // FR-REL-2: `onFailureReason` receives a specific, user-actionable cause
  // (e.g. CMake not found) so the transport's notification can show it
  // instead of the generic "Build failed" and an empty Problems list.
  toasts: { genericFailureToast?: boolean; onFailureReason?: (reason: string) => void } = {},
): Promise<boolean> {
  const folder = resolveActiveFolder(workspaceState);
  if (!folder) {
    void vscode.window.showErrorMessage('ds-ide: no workspace folder open');
    return false;
  }
  const projectRoot = folder.uri.fsPath;

  // FR-EXT-10: shares the same ds-ide.effectSource resolution/error-handling
  // wrapper extension.ts uses for the wiring-editor code paths, instead of
  // calling findEffectSource() directly (which would silently skip the
  // configured-path branch).
  const effectSrc = await resolveConfiguredEffectSource(projectRoot);
  if (!effectSrc) {
    void vscode.window.showErrorMessage(
      'ds-ide: no effect .cpp found at project root, src/, or source/. ' +
      'Add one or set ds-ide.effectSource in settings.',
    );
    return false;
  }

  const daisySpDir = await detectDaisySP(projectRoot, extensionPath);
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
    await manager.build(opts, onLine, token);
    if (diagnostics) applyDiagnostics(diagnostics, parsed, projectRoot);
    // Routine success relies on the status bar, not a toast — a toast per
    // successful build/deploy drowns out the genuinely actionable warnings
    // this milestone aggregates elsewhere (FR-UX-2).
    vscode.window.setStatusBarMessage('$(check) ds-ide: build succeeded', 3000);
    return true;
  } catch (err) {
    if (diagnostics) applyDiagnostics(diagnostics, parsed, projectRoot);
    if (err instanceof CMakeNotFoundError || err instanceof CompilerNotFoundError) {
      // No compiler output exists for this failure, so the channel would
      // otherwise stay empty.
      channel.appendLine(err.message);
      toasts.onFailureReason?.(err.message);
      if (toasts.genericFailureToast !== false) {
        void vscode.window.showErrorMessage(`ds-ide: build failed — ${err.message}`);
      }
      return false;
    }
    const nonPortable = detectNonPortableSymbol(rawLines);
    if (nonPortable.length > 0) {
      void vscode.window.showErrorMessage(
        `ds-ide: build failed — symbol(s) not emulated: ${nonPortable.map(s => `'${s}'`).join(', ')}. ` +
        `Add stubs or remove these hardware-only API calls.`,
      );
    } else if (toasts.genericFailureToast !== false) {
      const msg = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`ds-ide: build failed — ${msg}`);
    }
    return false;
  }
}

/**
 * Resolves the DaisySP include directory (FR-EXM-1): the project's own copy
 * first, then the extension's bundled `vendor/DaisySP/Source` (it ships in the
 * package for the New Effect wizard), so a plain copy of an example — or any
 * hand-made project — builds without DaisySP being copied in by hand.
 */
export async function detectDaisySP(projectRoot: string, extensionPath?: string): Promise<string | undefined> {
  const candidates = [
    path.join(projectRoot, 'DaisySP', 'Source'),
    path.join(projectRoot, 'DaisySP', 'src'),
    path.join(projectRoot, 'daisysp', 'Source'),
    path.join(projectRoot, 'daisysp', 'src'),
  ];
  if (extensionPath) candidates.push(path.join(extensionPath, 'vendor', 'DaisySP', 'Source'));
  for (const p of candidates) {
    try {
      const stat = await fs.promises.stat(p);
      if (stat.isDirectory()) return p;
    } catch { /* ignore */ }
  }
  return undefined;
}
