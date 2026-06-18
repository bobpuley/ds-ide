import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import * as vscode from 'vscode';
import { flashToHardware, findHardwareBin } from '../../../commands/dfu-flash';

vi.mock('../../../hardware/toolchain', () => ({
  detectDfuUtil: vi.fn(() => '/opt/homebrew/bin/dfu-util'),
  DFU_UTIL_INSTALL_HINT: 'brew install dfu-util',
}));

import { detectDfuUtil } from '../../../hardware/toolchain';

function makeSpawn(exitCode = 0) {
  return vi.fn(() => {
    const proc = new EventEmitter() as ReturnType<typeof import('child_process').spawn>;
    (proc as unknown as Record<string, unknown>).stdout = new EventEmitter();
    (proc as unknown as Record<string, unknown>).stderr = new EventEmitter();
    process.nextTick(() => proc.emit('close', exitCode));
    return proc;
  });
}

function makeFlashDeps(exitCode = 0) {
  return {
    spawn: makeSpawn(exitCode),
    existsSync: vi.fn(() => true),
    execSync: vi.fn(() => { throw new Error(); }),
    readdirSync: vi.fn(() => ['effect.bin']),
    statSync: vi.fn(() => ({ mtimeMs: 1000 })),
  };
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
    await flashToHardware('/project', deps);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('flash succeeded'),
    );
  });

  it('shows error message when dfu-util exits with non-zero code', async () => {
    const deps = makeFlashDeps(1);
    await flashToHardware('/project', deps);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('flash failed'),
    );
  });

  it('shows error and skips flash when dfu-util is not found', async () => {
    (detectDfuUtil as ReturnType<typeof vi.fn>).mockReturnValueOnce(undefined);
    const deps = makeFlashDeps(0);

    await flashToHardware('/project', deps);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('dfu-util not found'),
    );
    expect(deps.spawn).not.toHaveBeenCalled();
  });

  it('shows error and skips flash when no .bin file is found', async () => {
    const deps = { ...makeFlashDeps(0), readdirSync: vi.fn(() => []) };
    await flashToHardware('/project', deps);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('no .bin file found'),
    );
    expect(deps.spawn).not.toHaveBeenCalled();
  });

  it('does not flash when the user cancels the bootloader prompt', async () => {
    (vscode.window.showInformationMessage as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('Cancel');
    const deps = makeFlashDeps(0);

    await flashToHardware('/project', deps);

    expect(deps.spawn).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalledWith(
      expect.stringContaining('flash succeeded'),
    );
  });

  it('invokes dfu-util with correct Daisy flash arguments', async () => {
    const deps = makeFlashDeps(0);
    await flashToHardware('/project', deps);
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
    await flashToHardware('/project', deps);
    const calls = (vscode.window.showInformationMessage as ReturnType<typeof vi.fn>).mock.calls;
    const promptCall = calls.find((c: unknown[]) =>
      typeof c[0] === 'string' && (c[0] as string).includes('bootloader'),
    );
    expect(promptCall).toBeDefined();
  });
});

// ── findHardwareBin ───────────────────────────────────────────────────────────

describe('findHardwareBin()', () => {
  it('returns undefined when build/ does not exist', () => {
    const readdirSync = vi.fn(() => { throw new Error('ENOENT'); });
    expect(findHardwareBin('/project', readdirSync, vi.fn())).toBeUndefined();
  });

  it('returns undefined when build/ contains no .bin files', () => {
    const readdirSync = vi.fn(() => ['effect.elf', 'effect.map']);
    const statSync = vi.fn(() => ({ mtimeMs: 0 }));
    expect(findHardwareBin('/project', readdirSync, statSync)).toBeUndefined();
  });

  it('returns the single .bin file path', () => {
    const readdirSync = vi.fn(() => ['effect.bin']);
    const statSync = vi.fn(() => ({ mtimeMs: 1000 }));
    const result = findHardwareBin('/project', readdirSync, statSync);
    expect(result).toMatch(/effect\.bin$/);
    expect(result).toContain('/project/build/');
  });

  it('returns the most recently modified .bin when multiple exist', () => {
    const readdirSync = vi.fn(() => ['old.bin', 'new.bin']);
    const statSync = vi.fn((p: string) => ({
      mtimeMs: (p as string).includes('new.bin') ? 2000 : 500,
    }));
    const result = findHardwareBin('/project', readdirSync, statSync);
    expect(result).toMatch(/new\.bin$/);
  });
});
