import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import * as vscode from 'vscode';
import * as path from 'path';
import { flashToHardware, findHardwareBin, DfuFlashDeps } from '../../../commands/dfu-flash';

type ReaddirFn = typeof import('fs').promises.readdir;
type StatFn = typeof import('fs').promises.stat;

vi.mock('../../../hardware/toolchain', () => ({
  detectDfuUtil: vi.fn().mockResolvedValue('/opt/homebrew/bin/dfu-util'),
  dfuUtilInstallHint: (platform?: string) => (platform === 'win32' ? 'WIN-DFU-HINT' : 'brew install dfu-util'),
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
    const deps = { ...makeFlashDeps(0), platform: 'darwin' as const };
    const channel = makeChannel();

    await flashToHardware('/project', channel, deps);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringMatching(/dfu-util not found.*brew install dfu-util/),
    );
    expect(channel.appendLine).toHaveBeenCalledWith(expect.stringMatching(/dfu-util not found.*brew install dfu-util/));
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

  it('kills the dfu-util process when the cancellation token fires (FR-EXT-16)', async () => {
    let killed = false;
    let spawnedResolve!: () => void;
    const spawned = new Promise<void>((res) => { spawnedResolve = res; });
    const spawn = vi.fn(() => {
      const proc = new EventEmitter() as ReturnType<typeof import('child_process').spawn>;
      (proc as unknown as Record<string, unknown>)['stdout'] = new EventEmitter();
      (proc as unknown as Record<string, unknown>)['stderr'] = new EventEmitter();
      proc.kill = vi.fn(() => {
        killed = true;
        proc.emit('close', null);
        return true;
      });
      // Never closes on its own — simulates a hung dfu-util.
      spawnedResolve();
      return proc;
    }) as unknown as typeof import('child_process').spawn;

    const deps: DfuFlashDeps = {
      spawn,
      readdir: vi.fn(() => Promise.resolve(['effect.bin'])) as unknown as DfuFlashDeps['readdir'],
      stat: vi.fn(() => Promise.resolve({ mtimeMs: 1000 })) as unknown as DfuFlashDeps['stat'],
    };
    const source = new vscode.CancellationTokenSource();
    const resultPromise = flashToHardware('/project', makeChannel(), deps, source.token);
    await spawned;
    source.cancel();
    await resultPromise;

    expect(killed).toBe(true);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('flash failed'),
    );
  });

  it('still detects the success string when split across two stdout chunks (FR-EXT-12)', async () => {
    const spawn = vi.fn(() => {
      const proc = new EventEmitter() as ReturnType<typeof import('child_process').spawn>;
      const stdout = new EventEmitter();
      (proc as unknown as Record<string, unknown>)['stdout'] = stdout;
      (proc as unknown as Record<string, unknown>)['stderr'] = new EventEmitter();
      process.nextTick(() => {
        stdout.emit('data', Buffer.from('File downloaded success'));
        stdout.emit('data', Buffer.from('fully\n'));
        proc.emit('close', 74);
      });
      return proc;
    });
    const deps: DfuFlashDeps = {
      spawn: spawn as unknown as DfuFlashDeps['spawn'],
      readdir: vi.fn(() => Promise.resolve(['effect.bin'])) as unknown as DfuFlashDeps['readdir'],
      stat: vi.fn(() => Promise.resolve({ mtimeMs: 1000 })) as unknown as DfuFlashDeps['stat'],
    };
    await flashToHardware('/project', makeChannel(), deps);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('flash succeeded'),
    );
  });

  it('skips its own bootloader prompt when Build & Flash already confirmed a detected board (FR-TRN-7)', async () => {
    const deps = { ...makeFlashDeps(0), confirmBootloader: false };
    await flashToHardware('/project', makeChannel(), deps);
    const prompts = (vscode.window.showInformationMessage as ReturnType<typeof vi.fn>).mock.calls
      .filter((c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('bootloader'));
    expect(prompts).toHaveLength(0);
    expect(deps.spawn).toHaveBeenCalled();
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
    expect(result).toContain(path.join('/project', 'build') + path.sep);
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

// ── Windows: WinUSB driver missing (FR-WIN-TCH-3) ────────────────────────────

describe('flashToHardware() — WinUSB driver missing (FR-WIN-TCH-3)', () => {
  const CANNOT_OPEN = [
    'Cannot open DFU device 0483:df11 found on devnum 2 (LIBUSB_ERROR_NOT_SUPPORTED)',
    'No DFU capable USB device available',
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (detectDfuUtil as ReturnType<typeof vi.fn>).mockResolvedValue('C:\\dfu-util\\dfu-util.exe');
  });

  it('on Windows, names the missing WinUSB driver and Zadig instead of only the exit code', async () => {
    const deps = { ...makeFlashDeps(74, CANNOT_OPEN), confirmBootloader: false, platform: 'win32' as const };
    await flashToHardware('/project', makeChannel(), deps);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('WinUSB'));
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('Zadig'));
  });

  it('on macOS/Linux the same output keeps the generic failure message', async () => {
    const deps = { ...makeFlashDeps(74, CANNOT_OPEN), confirmBootloader: false, platform: 'darwin' as const };
    await flashToHardware('/project', makeChannel(), deps);
    const shown = (vscode.window.showErrorMessage as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0])).join('\n');
    expect(shown).toContain('dfu-util exited with code 74');
    expect(shown).not.toContain('WinUSB');
  });

  it('on Windows an ordinary failure is not blamed on the driver', async () => {
    const deps = { ...makeFlashDeps(2, ['Error during download']), confirmBootloader: false, platform: 'win32' as const };
    await flashToHardware('/project', makeChannel(), deps);
    const shown = (vscode.window.showErrorMessage as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0])).join('\n');
    expect(shown).toContain('dfu-util exited with code 2');
    expect(shown).not.toContain('WinUSB');
  });

  it('uses the install hint of the platform when dfu-util is missing', async () => {
    (detectDfuUtil as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    const channel = makeChannel();
    await flashToHardware('/project', channel, { ...makeFlashDeps(0), platform: 'win32' as const });
    expect(channel.appendLine).toHaveBeenCalledWith(expect.stringContaining('WIN-DFU-HINT'));
  });
});
