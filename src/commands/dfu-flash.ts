import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { detectDfuUtil, DFU_UTIL_INSTALL_HINT } from '../hardware/toolchain';
import { createLineSplitter } from '../hardware/line-buffer';

export interface DfuFlashDeps {
  spawn?: typeof cp.spawn;
  readdir?: typeof fs.promises.readdir;
  stat?: typeof fs.promises.stat;
  // FR-TRN-7: Build & Flash has already detected the board in DFU mode and
  // had the user confirm, so it turns off this command's own BOOT/RESET prompt.
  confirmBootloader?: boolean;
}

// Daisy Seed DFU flash address (internal flash start).
const DAISY_DFU_ADDRESS = '0x08000000:leave';

// dfu-util 0.9–0.11 (macOS Homebrew, Debian/Ubuntu apt) exit with this code
// after a successful ":leave" download because the Daisy Seed resets and
// disconnects before dfu-util can read back the final USB status — not a
// real failure. Confirmed against those versions; re-verify if this trips
// on a dfu-util release outside that range.
const DFU_LEAVE_QUIRK_EXIT_CODE = 74;

export async function flashToHardware(
  projectRoot: string,
  outputChannel: vscode.OutputChannel,
  deps: DfuFlashDeps = {},
  token?: vscode.CancellationToken,
): Promise<void> {
  const spawnFn = deps.spawn ?? cp.spawn;
  const readdir = deps.readdir ?? fs.promises.readdir;
  const stat = deps.stat ?? fs.promises.stat;

  const dfuUtil = await detectDfuUtil();
  if (!dfuUtil) {
    // FR-PRE-2: the cause also goes to the output channel, not only a toast.
    const msg = `dfu-util not found. ${DFU_UTIL_INSTALL_HINT}`;
    outputChannel.show();
    outputChannel.appendLine(msg);
    void vscode.window.showErrorMessage(`ds-ide: ${msg}`);
    return;
  }

  const binPath = await findHardwareBin(projectRoot, readdir, stat);
  if (!binPath) {
    void vscode.window.showErrorMessage(
      'ds-ide: no .bin file found in build/. Run "Build for Hardware" first.',
    );
    return;
  }

  if (deps.confirmBootloader !== false) {
    const ok = await vscode.window.showInformationMessage(
      'ds-ide: Put Daisy Seed in bootloader mode (hold BOOT, press RESET), then click Flash.',
      'Flash',
      'Cancel',
    );
    if (ok !== 'Flash') return;
  }

  const channel = outputChannel;
  channel.show();
  channel.appendLine(`Flashing ${path.basename(binPath)} …`);

  try {
    await runDfuUtil(dfuUtil, binPath, spawnFn, (line) => channel.appendLine(line), token);
    void vscode.window.showInformationMessage('ds-ide: flash succeeded — Daisy Seed is running your effect');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`ds-ide: flash failed — ${msg}`);
  }
}

// Find the most recently modified .bin in <projectRoot>/build/.
export async function findHardwareBin(
  projectRoot: string,
  readdir: typeof fs.promises.readdir = fs.promises.readdir,
  stat: typeof fs.promises.stat = fs.promises.stat,
): Promise<string | undefined> {
  const buildDir = path.join(projectRoot, 'build');
  let entries: string[];
  try {
    entries = (await readdir(buildDir)) as string[];
  } catch {
    return undefined;
  }

  const candidates = await Promise.all(
    entries
      .filter((e) => e.endsWith('.bin'))
      .map(async (e) => {
        const full = path.join(buildDir, e);
        try {
          return { full, mtime: (await stat(full)).mtimeMs };
        } catch {
          return null;
        }
      }),
  );
  const bins = candidates
    .filter((x): x is { full: string; mtime: number } => x !== null)
    .sort((a, b) => b.mtime - a.mtime);

  return bins[0]?.full;
}

function runDfuUtil(
  dfuUtil: string,
  binPath: string,
  spawnFn: typeof cp.spawn,
  onOutput: (line: string) => void,
  token?: vscode.CancellationToken,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ['-a', '0', '-s', DAISY_DFU_ADDRESS, '-D', binPath];
    const proc = spawnFn(dfuUtil, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let downloadSucceeded = false;

    const handleLine = (line: string): void => {
      onOutput(line);
      if (line.includes('File downloaded successfully')) {
        downloadSucceeded = true;
      }
    };
    const stdoutSplitter = createLineSplitter(handleLine);
    const stderrSplitter = createLineSplitter(handleLine);

    // FR-EXT-16: a hung dfu-util invocation otherwise leaves the flash
    // command's promise pending forever with no way to abort it.
    const cancelSub = token?.onCancellationRequested(() => proc.kill());

    proc.stdout?.on('data', (data: Buffer) => stdoutSplitter.push(data));
    proc.stderr?.on('data', (data: Buffer) => stderrSplitter.push(data));
    proc.on('error', (err) => { cancelSub?.dispose(); reject(err); });
    proc.on('close', (code) => {
      cancelSub?.dispose();
      stdoutSplitter.flush();
      stderrSplitter.flush();
      if (token?.isCancellationRequested) {
        reject(new Error('dfu-util cancelled'));
        return;
      }
      // The success string is a secondary confirmation only — it never
      // overrides an unrecognized exit code on its own.
      if (code === 0 || (code === DFU_LEAVE_QUIRK_EXIT_CODE && downloadSucceeded)) {
        resolve();
      } else {
        reject(new Error(`dfu-util exited with code ${code ?? 'null'}`));
      }
    });
  });
}
