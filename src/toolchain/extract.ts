import * as cp from 'child_process';
import * as path from 'path';
import type { CancelToken } from './download';

// FR-WIN-TCH-4: zip extraction through the system bsdtar. tar.exe ships with
// Windows 10 1803+ and reads zip archives, so no archive library is bundled. It
// also refuses entries that climb out of the destination ("Path contains '..'"),
// which is the zip-slip case. The Windows binary is addressed by absolute path:
// the first `tar` on PATH may be the GNU tar of Git for Windows or MSYS2, which
// cannot read zip files.

export type SpawnTar = typeof cp.spawn;

export interface ExtractDeps {
  spawn?: SpawnTar;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}

export function tarCommand(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string {
  return platform === 'win32'
    ? path.win32.join(env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tar.exe')
    : 'tar';
}

const DISK_FULL_RE = /no space left|not enough space|ENOSPC|disk full/i;
const STDERR_LIMIT = 4096;

/** Extracts `archive` into the existing directory `dest`. Disk-full is reported with `code: 'ENOSPC'`. */
export function tarExtract(
  archive: string,
  dest: string,
  token?: CancelToken,
  deps: ExtractDeps = {},
): Promise<void> {
  const spawn = deps.spawn ?? cp.spawn;
  const command = tarCommand(deps.platform ?? process.platform, deps.env ?? process.env);
  return new Promise<void>((resolve, reject) => {
    const proc = spawn(command, ['-xf', archive, '-C', dest], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let stderr = '';
    let settled = false;
    const finish = (err?: Error): void => {
      if (settled) return;
      settled = true;
      sub?.dispose();
      if (err) reject(err); else resolve();
    };
    const sub = token?.onCancellationRequested(() => { proc.kill(); finish(new Error('extraction cancelled')); });

    proc.stderr?.on('data', (d: Buffer) => { stderr = (stderr + d.toString('utf8')).slice(-STDERR_LIMIT); });
    proc.on('error', (err) => finish(new Error(`cannot run tar to extract the toolchain (${command}): ${err.message}`)));
    proc.on('close', (code) => {
      if (code === 0) { finish(); return; }
      const detail = stderr.trim() || 'no output';
      const err = new Error(`tar exited with code ${code ?? 'null'}: ${detail}`) as NodeJS.ErrnoException;
      if (DISK_FULL_RE.test(stderr)) err.code = 'ENOSPC';
      finish(err);
    });
  });
}
