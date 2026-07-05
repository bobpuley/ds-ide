import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import * as vscode from 'vscode';
import { flashToHardware, findHardwareBin, DfuFlashDeps } from '../../../commands/dfu-flash';

type ReaddirFn = typeof import('fs').promises.readdir;
type StatFn = typeof import('fs').promises.stat;

vi.mock('../../../hardware/toolchain', () => ({
  detectDfuUtil: vi.fn().mockResolvedValue('/opt/homebrew/bin/dfu-util'),
  DFU_UTIL_INSTALL_HINT: 'brew install dfu-util',
}));

import { detectDfuUtil } from '../../../hardware/toolchain';

function makeSpawn(exitCode = 0, stdoutLines: string[] = []) {
  return vi.fn(() => {
    const proc = new EventEmitter() as ReturnType<typeof import('child_process').spawn>;
    const stdout = new EventEmitter();
    (proc as unknown as Record<string, unknown>)['stdout'] = stdout;
    (proc as unknown as Record<string, unknown>)['stderr'] = new EventEmitter();
    process.nextTick(() => {
      for (const line of stdoutLines) stdout.emit('data', Buffer.from(`${line}\n`));
      proc.emit('close', exitCode);
    });
    return proc;
  });
}

function makeFlashDeps(exitCode = 0, stdoutLines: string[] = []): DfuFlashDeps {
  return {
    spawn: makeSpawn(exitCode, stdoutLines),
    readdir: vi.fn(() => Promise.resolve(['effect.bin'])),
    stat: vi.fn(() => Promise.resolve({ mtimeMs: 1000 })),
  } as unknown as DfuFlashDeps;
}

function makeChannel(): vscode.OutputChannel {
  return {
    appendLine: vi.fn(),
    show: vi.fn(),
    dispose: vi.fn(),
  } as unknown as vscode.OutputChannel;
}

describe('flashToHardware()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: user clicks Flash
    (vscode.window.showInformationMessage as ReturnType<typeof vi.fn>)
      .mockResolvedValue('Flash');
  });

  it('shows success message when dfu-util exits with code 0', async () => {
    const deps = makeFlashDeps(0);
    await flashToHardware('/project', makeChannel(), deps);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('flash succeeded'),
    );
  });

  it('shows error message when dfu-util exits with non-zero code', async () => {
    const deps = makeFlashDeps(1);
    await flashToHardware('/project', makeChannel(), deps);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('flash failed'),
    );
  });

  it('shows success when dfu-util exits 74 with the known "leave DFU mode" output (FR-QA-EXT-3)', async () => {
    const deps = makeFlashDeps(74, ['File downloaded successfully']);
    await flashToHardware('/project', makeChannel(), deps);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('flash succeeded'),
    );
  });

  it('shows error when dfu-util exits 74 without the success output (FR-QA-EXT-3)', async () => {
    const deps = makeFlashDeps(74, []);
    await flashToHardware('/project', makeChannel(), deps);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('flash failed'),
    );
  });

  it('shows error on an unrecognized non-zero exit code even if the success string appears (FR-QA-EXT-3)', async () => {
    const deps = makeFlashDeps(1, ['File downloaded successfully']);
    await flashToHardware('/project', makeChannel(), deps);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('flash failed'),
    );
  });

  it('shows error and skips flash when dfu-util is not found', async () => {
    (detectDfuUtil as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    const deps = makeFlashDeps(0);

    await flashToHardware('/project', makeChannel(), deps);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('dfu-util not found'),
    );
    expect(deps.spawn).not.toHaveBeenCalled();
  });

  it('shows error and skips flash when no .bin file is found', async () => {
    const deps = { ...makeFlashDeps(0), readdir: vi.fn(() => Promise.resolve([])) } as unknown as DfuFlashDeps;
    await flashToHardware('/project', makeChannel(), deps);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('no .bin file found'),
    );
    expect(deps.spawn).not.toHaveBeenCalled();
  });

  it('does not flash when the user cancels the bootloader prompt', async () => {
    (vscode.window.showInformationMessage as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('Cancel');
    const deps = makeFlashDeps(0);

    await flashToHardware('/project', makeChannel(), deps);

    expect(deps.spawn).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalledWith(
      expect.stringContaining('flash succeeded'),
    );
  });

  it('invokes dfu-util with correct Daisy flash arguments', async () => {
    const deps = makeFlashDeps(0);
    await flashToHardware('/project', makeChannel(), deps);
    const call = (deps.spawn as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const args = call[1] as string[];
    expect(call[0]).toBe('/opt/homebrew/bin/dfu-util');
    expect(args).toContain('-a');
    expect(args).toContain('0');
    expect(args).toContain('-s');
    expect(args).toContain('0x08000000:leave');
    expect(args).toContain('-D');
    expect(args[args.indexOf('-D') + 1]).toContain('effect.bin');
  });

  it('shows the bootloader prompt before flashing', async () => {
    const deps = makeFlashDeps(0);
    await flashToHardware('/project', makeChannel(), deps);
    const calls = (vscode.window.showInformationMessage as ReturnType<typeof vi.fn>).mock.calls;
    const promptCall = calls.find((c: unknown[]) =>
      typeof c[0] === 'string' && (c[0] as string).includes('bootloader'),
    );
    expect(promptCall).toBeDefined();
  });

  it('reuses the passed-in channel across multiple invocations instead of creating a new one', async () => {
    const channel = makeChannel();
    const deps = makeFlashDeps(0);
    await flashToHardware('/project', channel, deps);
    await flashToHardware('/project', channel, deps);
    await flashToHardware('/project', channel, deps);
    expect(vscode.window.createOutputChannel).not.toHaveBeenCalled();
    expect(channel.show).toHaveBeenCalledTimes(3);
  });
});

// ── findHardwareBin ───────────────────────────────────────────────────────────

describe('findHardwareBin()', () => {
  it('returns undefined when build/ does not exist', async () => {
    const readdir = vi.fn(() => Promise.reject(new Error('ENOENT')));
    await expect(findHardwareBin('/project', readdir as unknown as ReaddirFn, vi.fn() as unknown as StatFn)).resolves.toBeUndefined();
  });

  it('returns undefined when build/ contains no .bin files', async () => {
    const readdir = vi.fn(() => Promise.resolve(['effect.elf', 'effect.map']));
    const stat = vi.fn(() => Promise.resolve({ mtimeMs: 0 }));
    await expect(findHardwareBin('/project', readdir as unknown as ReaddirFn, stat as unknown as StatFn)).resolves.toBeUndefined();
  });

  it('returns the single .bin file path', async () => {
    const readdir = vi.fn(() => Promise.resolve(['effect.bin']));
    const stat = vi.fn(() => Promise.resolve({ mtimeMs: 1000 }));
    const result = await findHardwareBin('/project', readdir as unknown as ReaddirFn, stat as unknown as StatFn);
    expect(result).toMatch(/effect\.bin$/);
    expect(result).toContain('/project/build/');
  });

  it('returns the most recently modified .bin when multiple exist', async () => {
    const readdir = vi.fn(() => Promise.resolve(['old.bin', 'new.bin']));
    const stat = vi.fn((p: string) => Promise.resolve({
      mtimeMs: (p as string).includes('new.bin') ? 2000 : 500,
    }));
    const result = await findHardwareBin('/project', readdir as unknown as ReaddirFn, stat as unknown as StatFn);
    expect(result).toMatch(/new\.bin$/);
  });
});
