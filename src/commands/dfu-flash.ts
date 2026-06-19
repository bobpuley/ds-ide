import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { detectDfuUtil, DFU_UTIL_INSTALL_HINT } from '../hardware/toolchain';

export interface DfuFlashDeps {
  spawn?: typeof cp.spawn;
  existsSync?: (p: string) => boolean;
  execSync?: (cmd: string) => Buffer;
  readdirSync?: typeof fs.readdirSync;
  statSync?: typeof fs.statSync;
}

// Daisy Seed DFU flash address (internal flash start).
const DAISY_DFU_ADDRESS = '0x08000000:leave';

export async function flashToHardware(
  projectRoot: string,
  deps: DfuFlashDeps = {},
): Promise<void> {
  const spawnFn = deps.spawn ?? cp.spawn;
  const existsSync = deps.existsSync ?? fs.existsSync;
  const execSync = deps.execSync ?? cp.execSync;
  const readdirSync = deps.readdirSync ?? fs.readdirSync;
  const statSync = deps.statSync ?? fs.statSync;

  const dfuUtil = detectDfuUtil(existsSync, execSync);
  if (!dfuUtil) {
    void vscode.window.showErrorMessage(
      `ds-ide: dfu-util not found. ${DFU_UTIL_INSTALL_HINT}`,
    );
    return;
  }

  const binPath = findHardwareBin(projectRoot, readdirSync, statSync);
  if (!binPath) {
    void vscode.window.showErrorMessage(
      'ds-ide: no .bin file found in build/. Run "Build for Hardware" first.',
    );
    return;
  }

  const ok = await vscode.window.showInformationMessage(
    'ds-ide: Put Daisy Seed in bootloader mode (hold BOOT, press RESET), then click Flash.',
    'Flash',
    'Cancel',
  );
  if (ok !== 'Flash') return;

  const channel = vscode.window.createOutputChannel('Daisy IDE Flash');
  channel.show();
  channel.appendLine(`Flashing ${path.basename(binPath)} …`);

  try {
    await runDfuUtil(dfuUtil, binPath, spawnFn, (line) => channel.appendLine(line));
    void vscode.window.showInformationMessage('ds-ide: flash succeeded — Daisy Seed is running your effect');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`ds-ide: flash failed — ${msg}`);
  }
}

// Find the most recently modified .bin in <projectRoot>/build/.
export function findHardwareBin(
  projectRoot: string,
  readdirSync: typeof fs.readdirSync = fs.readdirSync,
  statSync: typeof fs.statSync = fs.statSync,
): string | undefined {
  const buildDir = path.join(projectRoot, 'build');
  let entries: string[];
  try {
    entries = readdirSync(buildDir) as string[];
  } catch {
    return undefined;
  }

  const bins = entries
    .filter((e) => e.endsWith('.bin'))
    .map((e) => {
      const full = path.join(buildDir, e);
      try {
        return { full, mtime: statSync(full).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((x): x is { full: string; mtime: number } => x !== null)
    .sort((a, b) => b.mtime - a.mtime);

  return bins[0]?.full;
}

function runDfuUtil(
  dfuUtil: string,
  binPath: string,
  spawnFn: typeof cp.spawn,
  onOutput: (line: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ['-a', '0', '-s', DAISY_DFU_ADDRESS, '-D', binPath];
    const proc = spawnFn(dfuUtil, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let downloadSucceeded = false;

    const handleData = (data: Buffer): void => {
      for (const line of data.toString('utf8').split('\n')) {
        if (line.trim()) {
          onOutput(line);
          if (line.includes('File downloaded successfully')) {
            downloadSucceeded = true;
          }
        }
      }
    };

    proc.stdout?.on('data', handleData);
    proc.stderr?.on('data', handleData);
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0 || downloadSucceeded) resolve();
      else reject(new Error(`dfu-util exited with code ${code ?? 'null'}`));
    });
  });
}
