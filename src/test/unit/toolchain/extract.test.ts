import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { tarCommand, tarExtract, type SpawnTar } from '../../../toolchain/extract';

// FR-WIN-TCH-4: zip extraction through the system bsdtar (tar.exe ships with
// Windows 10 1803+ and reads zip archives); no archive library is bundled.

function fakeTar(opts: { code?: number | null; stderr?: string; spawnError?: NodeJS.ErrnoException; hold?: boolean } = {}) {
  const kill = vi.fn();
  const calls: Array<{ command: string; args: string[] }> = [];
  const spawn = ((command: string, args: string[]) => {
    calls.push({ command, args });
    const proc = Object.assign(new EventEmitter(), { stderr: new PassThrough(), stdout: new PassThrough(), kill });
    process.nextTick(() => {
      if (opts.spawnError) { proc.emit('error', opts.spawnError); return; }
      if (opts.stderr) proc.stderr.write(opts.stderr);
      if (!opts.hold) proc.emit('close', opts.code ?? 0);
    });
    return proc;
  }) as unknown as SpawnTar;
  return { spawn, calls, kill };
}

describe('tarCommand()', () => {
  it('on Windows is the system tar.exe by absolute path, never whatever tar is first on PATH', () => {
    // Git for Windows / MSYS2 ship a GNU tar that cannot read zip files.
    expect(tarCommand('win32', { SystemRoot: 'C:\\Windows' })).toBe('C:\\Windows\\System32\\tar.exe');
  });

  it('on Windows falls back to C:\\Windows when SystemRoot is not set', () => {
    expect(tarCommand('win32', {})).toBe('C:\\Windows\\System32\\tar.exe');
  });

  it('elsewhere is plain tar', () => {
    expect(tarCommand('darwin', {})).toBe('tar');
    expect(tarCommand('linux', {})).toBe('tar');
  });
});

describe('tarExtract()', () => {
  it('runs tar -xf <archive> -C <dest>', async () => {
    const { spawn, calls } = fakeTar();
    await tarExtract('C:\\a\\x.zip', 'C:\\out', undefined, { spawn, platform: 'win32', env: { SystemRoot: 'C:\\Windows' } });
    expect(calls).toEqual([{ command: 'C:\\Windows\\System32\\tar.exe', args: ['-xf', 'C:\\a\\x.zip', '-C', 'C:\\out'] }]);
  });

  it('rejects with tar\'s own message on a non-zero exit', async () => {
    const { spawn } = fakeTar({ code: 1, stderr: 'tar.exe: ../escaped.txt: Path contains \'..\'\n' });
    await expect(tarExtract('x.zip', 'out', undefined, { spawn })).rejects.toThrow(/Path contains/);
  });

  it.each(['No space left on device', 'There is not enough space on the disk', 'ENOSPC'])(
    'maps "%s" to a disk-full error code', async (text) => {
      const { spawn } = fakeTar({ code: 1, stderr: `tar: write error: ${text}\n` });
      const err = await tarExtract('x.zip', 'out', undefined, { spawn }).catch((e: unknown) => e);
      expect((err as NodeJS.ErrnoException).code).toBe('ENOSPC');
    });

  it('explains a missing tar', async () => {
    const { spawn } = fakeTar({ spawnError: Object.assign(new Error('spawn tar ENOENT'), { code: 'ENOENT' }) });
    await expect(tarExtract('x.zip', 'out', undefined, { spawn })).rejects.toThrow(/tar/i);
  });

  it('kills tar and rejects when cancelled', async () => {
    const { spawn, kill } = fakeTar({ hold: true });
    let fire: () => void = () => undefined;
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: (cb: () => void) => { fire = () => { token.isCancellationRequested = true; cb(); }; return { dispose: () => undefined }; },
    };
    const p = tarExtract('x.zip', 'out', token, { spawn });
    await new Promise((r) => setTimeout(r, 10));
    fire();
    await expect(p).rejects.toThrow(/cancel/i);
    expect(kill).toHaveBeenCalled();
  });
});

describe('tarExtract() with the real tar', () => {
  const hasTar = ((): boolean => {
    const r = cp.spawnSync(tarCommand(process.platform, process.env), ['--version'], { encoding: 'utf8' });
    return r.status === 0 && /bsdtar|libarchive/i.test(r.stdout);
  })();

  it.skipIf(!hasTar)('extracts a real zip archive', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-ide-tar-'));
    try {
      fs.mkdirSync(path.join(dir, 'src', 'root', 'bin'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'src', 'root', 'bin', 'tool.exe'), 'binary');
      const zip = path.join(dir, 'a.zip');
      const made = cp.spawnSync(tarCommand(process.platform, process.env), ['-a', '-cf', zip, '-C', path.join(dir, 'src'), 'root']);
      expect(made.status).toBe(0);
      const out = path.join(dir, 'out');
      fs.mkdirSync(out);
      await tarExtract(zip, out);
      expect(fs.readFileSync(path.join(out, 'root', 'bin', 'tool.exe'), 'utf8')).toBe('binary');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(!hasTar)('fails on a missing archive', async () => {
    await expect(tarExtract(path.join(os.tmpdir(), 'definitely-missing.zip'), os.tmpdir())).rejects.toThrow();
  });
});
