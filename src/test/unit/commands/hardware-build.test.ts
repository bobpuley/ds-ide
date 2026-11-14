import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import * as vscode from 'vscode';
import { buildForHardware } from '../../../commands/hardware-build';

// Mock toolchain module so tests don't depend on actual fs/execSync.
vi.mock('../../../hardware/toolchain', () => ({
  detectArmToolchain: vi.fn().mockResolvedValue('/opt/homebrew/bin/arm-none-eabi-gcc'),
  ARM_GCC_INSTALL_HINT: 'brew install arm-none-eabi-gcc',
  NO_MAKEFILE_MESSAGE: 'No Makefile in this project. Build for Hardware needs a libDaisy-style project; see Limitations in the README.',
}));

import { detectArmToolchain } from '../../../hardware/toolchain';

function makeDiagnostics() {
  return {
    set: vi.fn(),
    clear: vi.fn(),
    dispose: vi.fn(),
  } as unknown as vscode.DiagnosticCollection;
}

function makeChannel(): vscode.OutputChannel {
  return {
    appendLine: vi.fn(),
    show: vi.fn(),
    dispose: vi.fn(),
  } as unknown as vscode.OutputChannel;
}

function makeSpawn(exitCode = 0, stderr = ''): typeof import('child_process').spawn {
  return vi.fn(() => {
    const proc = new EventEmitter() as ReturnType<typeof import('child_process').spawn>;
    const stdout = new EventEmitter() as NodeJS.ReadableStream;
    const stderrStream = new EventEmitter() as NodeJS.ReadableStream;
    (proc as unknown as Record<string, unknown>)['stdout'] = stdout;
    (proc as unknown as Record<string, unknown>)['stderr'] = stderrStream;
    process.nextTick(() => {
      if (stderr) stderrStream.emit('data', Buffer.from(stderr));
      proc.emit('close', exitCode);
    });
    return proc;
  }) as unknown as typeof import('child_process').spawn;
}

describe('buildForHardware()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (vscode.workspace.getConfiguration as ReturnType<typeof vi.fn>).mockReturnValue({
      get: vi.fn(() => undefined),
    });
  });

  it('shows success message when make exits with code 0', async () => {
    const spawn = makeSpawn(0);
    await buildForHardware('/project', makeDiagnostics(), makeChannel(), { makefileExists: async () => true, spawn });
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('hardware build succeeded'),
    );
  });

  it('shows error message when make exits with non-zero code', async () => {
    const spawn = makeSpawn(2);
    await buildForHardware('/project', makeDiagnostics(), makeChannel(), { makefileExists: async () => true, spawn });
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('hardware build failed'),
    );
  });

  it('reports success / failure as its result so Build & Flash can stop on a failed build (FR-TRN-3)', async () => {
    expect(await buildForHardware('/project', makeDiagnostics(), makeChannel(), { makefileExists: async () => true, spawn: makeSpawn(0) })).toBe(true);
    expect(await buildForHardware('/project', makeDiagnostics(), makeChannel(), { makefileExists: async () => true, spawn: makeSpawn(2) })).toBe(false);
    (detectArmToolchain as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    expect(await buildForHardware('/project', makeDiagnostics(), makeChannel(), { makefileExists: async () => true, spawn: makeSpawn(0) })).toBe(false);
  });

  it('shows error and skips make when toolchain is not found', async () => {
    (detectArmToolchain as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    const spawn = makeSpawn(0);

    await buildForHardware('/project', makeDiagnostics(), makeChannel(), { makefileExists: async () => true, spawn });

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('arm-none-eabi-gcc not found'),
    );
    expect(spawn).not.toHaveBeenCalled();
  });

  it('names the install hint in the notification and the output channel when the toolchain is missing (FR-PRE-2)', async () => {
    (detectArmToolchain as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    const channel = makeChannel();
    await buildForHardware('/project', makeDiagnostics(), channel, { makefileExists: async () => true, spawn: makeSpawn(0) });
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('brew install arm-none-eabi-gcc'));
    expect(channel.appendLine).toHaveBeenCalledWith(expect.stringContaining('brew install arm-none-eabi-gcc'));
  });

  it('does not run make and says so when the project has no Makefile (FR-PRE-3)', async () => {
    const spawn = makeSpawn(0);
    const channel = makeChannel();
    const ok = await buildForHardware('/project', makeDiagnostics(), channel, { makefileExists: async () => false, spawn });
    expect(ok).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
    const msg = 'No Makefile in this project. Build for Hardware needs a libDaisy-style project; see Limitations in the README.';
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining(msg));
    expect(channel.appendLine).toHaveBeenCalledWith(msg);
  });

  it('looks for the Makefile in the project root (FR-PRE-3)', async () => {
    const makefileExists = vi.fn(async () => true);
    await buildForHardware('/project', makeDiagnostics(), makeChannel(), { makefileExists, spawn: makeSpawn(0) });
    expect(makefileExists).toHaveBeenCalledWith('/project');
  });

  it('applies diagnostics after a failed build', async () => {
    const diagnosticLine =
      '/project/effect.cpp:10:5: error: use of undeclared identifier \'foo\'';
    const spawn = vi.fn(() => {
      const proc = new EventEmitter() as ReturnType<typeof import('child_process').spawn>;
      const stderr = new EventEmitter() as NodeJS.ReadableStream;
      (proc as unknown as Record<string, unknown>)['stdout'] = new EventEmitter();
      (proc as unknown as Record<string, unknown>)['stderr'] = stderr;
      process.nextTick(() => {
        stderr.emit('data', Buffer.from(diagnosticLine + '\n'));
        proc.emit('close', 1);
      });
      return proc;
    }) as unknown as typeof import('child_process').spawn;

    const diagnostics = makeDiagnostics();
    await buildForHardware('/project', diagnostics, makeChannel(), { makefileExists: async () => true, spawn });

    expect(diagnostics.clear).toHaveBeenCalled();
    expect(diagnostics.set).toHaveBeenCalled();
  });

  it('reads the arm toolchain path from the ds-ide configuration', async () => {
    (vscode.workspace.getConfiguration as ReturnType<typeof vi.fn>).mockReturnValue({
      get: vi.fn((key: string) => key === 'armToolchainPath' ? '/custom/bin' : undefined),
    });
    const spawn = makeSpawn(0);
    await buildForHardware('/project', makeDiagnostics(), makeChannel(), { makefileExists: async () => true, spawn });
    expect(detectArmToolchain).toHaveBeenCalledWith('/custom/bin');
  });

  it('invokes make in the project root', async () => {
    const spawn = makeSpawn(0);
    await buildForHardware('/my/project', makeDiagnostics(), makeChannel(), { makefileExists: async () => true, spawn });
    const call = (spawn as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toBe('make');
    expect((call[2] as { cwd: string }).cwd).toBe('/my/project');
  });

  it('reuses the passed-in channel instead of creating a fallback', async () => {
    const spawn = makeSpawn(0);
    const channel = makeChannel();
    await buildForHardware('/project', makeDiagnostics(), channel, { makefileExists: async () => true, spawn });
    expect(vscode.window.createOutputChannel).not.toHaveBeenCalled();
    expect(channel.show).toHaveBeenCalled();
  });

  it('kills the make process when the cancellation token fires (FR-EXT-16)', async () => {
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
      // Never closes on its own — simulates a hung `make`.
      spawnedResolve();
      return proc;
    }) as unknown as typeof import('child_process').spawn;

    const source = new vscode.CancellationTokenSource();
    const resultPromise = buildForHardware('/project', makeDiagnostics(), makeChannel(), { makefileExists: async () => true, spawn }, source.token);
    await spawned; // wait until runMake has spawned + wired the cancellation listener
    source.cancel();
    await resultPromise;

    expect(killed).toBe(true);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('hardware build failed'),
    );
  });

  it('prints the memory region table on a successful build (FR-HW-5b)', async () => {
    const regionOutput = [
      'Memory region         Used Size  Region Size  %age Used',
      '       FLASH:          0 GB       128 KB      0.00%',
      '     DTCMRAM:        7440 B       128 KB      5.68%',
    ].join('\n');
    const spawn = makeSpawn(0, regionOutput);
    const channel = makeChannel();
    await buildForHardware('/project', makeDiagnostics(), channel, { makefileExists: async () => true, spawn });

    const lines = (channel.appendLine as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(lines.some((l: string) => l.includes('Memory region usage'))).toBe(true);
    expect(lines.some((l: string) => l.includes('FLASH'))).toBe(true);
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });

  it('shows a warning when a region is at or above 75% used (FR-HW-5b)', async () => {
    const regionOutput = [
      'Memory region         Used Size  Region Size  %age Used',
      '       FLASH:        100 KB       128 KB     78.13%',
    ].join('\n');
    const spawn = makeSpawn(0, regionOutput);
    await buildForHardware('/project', makeDiagnostics(), makeChannel(), { makefileExists: async () => true, spawn });

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('FLASH'),
    );
  });

  it('does not warn when all regions are below 75% used (FR-HW-5b)', async () => {
    const regionOutput = [
      'Memory region         Used Size  Region Size  %age Used',
      '       FLASH:         10 KB       128 KB      7.81%',
    ].join('\n');
    const spawn = makeSpawn(0, regionOutput);
    await buildForHardware('/project', makeDiagnostics(), makeChannel(), { makefileExists: async () => true, spawn });

    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });

  it('shows a precise overflow error message on a region overflow (FR-HW-5b)', async () => {
    const overflowOutput = [
      "arm-none-eabi-ld: effect.elf section `.text' will not fit in region `FLASH'",
      "arm-none-eabi-ld: region `FLASH' overflowed by 1234 bytes",
    ].join('\n');
    const spawn = makeSpawn(1, overflowOutput);
    await buildForHardware('/project', makeDiagnostics(), makeChannel(), { makefileExists: async () => true, spawn });

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringMatching(/FLASH.*overflowed by 1234 bytes/),
    );
  });

  it('shows a fallback overflow message when the precise pattern does not match (FR-HW-5b)', async () => {
    const overflowOutput = 'arm-none-eabi-ld: some future wording that mentions the region overflowed differently';
    const spawn = makeSpawn(1, overflowOutput);
    await buildForHardware('/project', makeDiagnostics(), makeChannel(), { makefileExists: async () => true, spawn });

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("couldn't be parsed precisely"),
    );
  });

  it('hard-errors on any SDRAM usage when hardwareVariant is base, regardless of %age used (FR-HW-5c)', async () => {
    (vscode.workspace.getConfiguration as ReturnType<typeof vi.fn>).mockReturnValue({
      get: vi.fn((key: string) => key === 'hardwareVariant' ? 'base' : undefined),
    });
    const regionOutput = [
      'Memory region         Used Size  Region Size  %age Used',
      '       SDRAM:         10 MB        64 MB     15.63%',
    ].join('\n');
    const spawn = makeSpawn(0, regionOutput);
    await buildForHardware('/project', makeDiagnostics(), makeChannel(), { makefileExists: async () => true, spawn });

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('SDRAM'),
    );
  });

  it('does not hard-error on SDRAM usage when hardwareVariant is 65mb-sdram (FR-HW-5c)', async () => {
    (vscode.workspace.getConfiguration as ReturnType<typeof vi.fn>).mockReturnValue({
      get: vi.fn((key: string) => key === 'hardwareVariant' ? '65mb-sdram' : undefined),
    });
    const regionOutput = [
      'Memory region         Used Size  Region Size  %age Used',
      '       SDRAM:         10 MB        64 MB     15.63%',
    ].join('\n');
    const spawn = makeSpawn(0, regionOutput);
    await buildForHardware('/project', makeDiagnostics(), makeChannel(), { makefileExists: async () => true, spawn });

    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });

  it('never triggers the SDRAM rule when SDRAM usage is zero, regardless of variant (FR-HW-5c)', async () => {
    (vscode.workspace.getConfiguration as ReturnType<typeof vi.fn>).mockReturnValue({
      get: vi.fn((key: string) => key === 'hardwareVariant' ? 'base' : undefined),
    });
    const regionOutput = [
      'Memory region         Used Size  Region Size  %age Used',
      '       SDRAM:          0 GB        64 MB      0.00%',
    ].join('\n');
    const spawn = makeSpawn(0, regionOutput);
    await buildForHardware('/project', makeDiagnostics(), makeChannel(), { makefileExists: async () => true, spawn });

    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('defaults hardwareVariant to base when unset (FR-HW-5c)', async () => {
    // beforeEach already stubs getConfiguration().get() to return undefined for every key.
    const regionOutput = [
      'Memory region         Used Size  Region Size  %age Used',
      '       SDRAM:         10 MB        64 MB     15.63%',
    ].join('\n');
    const spawn = makeSpawn(0, regionOutput);
    await buildForHardware('/project', makeDiagnostics(), makeChannel(), { makefileExists: async () => true, spawn });

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('SDRAM'),
    );
  });

  it('prompts for hardware variant when unset, then persists the answer (FR-HW-5d)', async () => {
    const update = vi.fn(async () => undefined);
    (vscode.workspace.getConfiguration as ReturnType<typeof vi.fn>).mockReturnValue({
      get: vi.fn(() => undefined),
      inspect: vi.fn(() => ({
        key: 'ds-ide.hardwareVariant', defaultValue: 'base',
        globalValue: undefined, workspaceValue: undefined, workspaceFolderValue: undefined,
      })),
      update,
    });
    (vscode.window.showQuickPick as ReturnType<typeof vi.fn>).mockImplementation(
      async (items: { variant: string }[]) => items.find((i) => i.variant === '65mb-sdram'),
    );

    const spawn = makeSpawn(0);
    await buildForHardware('/project', makeDiagnostics(), makeChannel(), { makefileExists: async () => true, spawn });

    expect(vscode.window.showQuickPick).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith('hardwareVariant', '65mb-sdram', vscode.ConfigurationTarget.WorkspaceFolder);
  });

  it('does not prompt when hardwareVariant is already set (FR-HW-5d)', async () => {
    (vscode.workspace.getConfiguration as ReturnType<typeof vi.fn>).mockReturnValue({
      get: vi.fn((key: string) => key === 'hardwareVariant' ? 'base' : undefined),
      inspect: vi.fn(() => ({
        key: 'ds-ide.hardwareVariant', defaultValue: 'base',
        globalValue: undefined, workspaceValue: undefined, workspaceFolderValue: 'base',
      })),
      update: vi.fn(async () => undefined),
    });

    const spawn = makeSpawn(0);
    await buildForHardware('/project', makeDiagnostics(), makeChannel(), { makefileExists: async () => true, spawn });

    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
  });

  it('defaults to base for this build only when the prompt is dismissed, without persisting (FR-HW-5d)', async () => {
    const update = vi.fn(async () => undefined);
    (vscode.workspace.getConfiguration as ReturnType<typeof vi.fn>).mockReturnValue({
      get: vi.fn(() => undefined),
      inspect: vi.fn(() => ({
        key: 'ds-ide.hardwareVariant', defaultValue: 'base',
        globalValue: undefined, workspaceValue: undefined, workspaceFolderValue: undefined,
      })),
      update,
    });
    (vscode.window.showQuickPick as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const spawn = makeSpawn(0);
    await buildForHardware('/project', makeDiagnostics(), makeChannel(), { makefileExists: async () => true, spawn });

    expect(update).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('hardware build succeeded'),
    );
  });

  it('still parses a diagnostic line split across two stderr chunks (FR-EXT-12)', async () => {
    const diagnosticLine =
      "/project/effect.cpp:10:5: error: use of undeclared identifier 'foo'";
    const spawn = vi.fn(() => {
      const proc = new EventEmitter() as ReturnType<typeof import('child_process').spawn>;
      const stderr = new EventEmitter() as NodeJS.ReadableStream;
      (proc as unknown as Record<string, unknown>)['stdout'] = new EventEmitter();
      (proc as unknown as Record<string, unknown>)['stderr'] = stderr;
      process.nextTick(() => {
        const splitPoint = diagnosticLine.indexOf('error:');
        stderr.emit('data', Buffer.from(diagnosticLine.slice(0, splitPoint)));
        stderr.emit('data', Buffer.from(diagnosticLine.slice(splitPoint) + '\n'));
        proc.emit('close', 1);
      });
      return proc;
    }) as unknown as typeof import('child_process').spawn;

    const diagnostics = makeDiagnostics();
    await buildForHardware('/project', diagnostics, makeChannel(), { makefileExists: async () => true, spawn });

    expect(diagnostics.set).toHaveBeenCalled();
    const setCall = (diagnostics.set as ReturnType<typeof vi.fn>).mock.calls[0];
    const diagArray = setCall?.[1] as { message: string }[];
    expect(diagArray?.[0]?.message).toContain("undeclared identifier 'foo'");
  });
});
