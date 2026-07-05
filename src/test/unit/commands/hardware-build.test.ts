import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import * as vscode from 'vscode';
import { buildForHardware } from '../../../commands/hardware-build';

// Mock toolchain module so tests don't depend on actual fs/execSync.
vi.mock('../../../hardware/toolchain', () => ({
  detectArmToolchain: vi.fn().mockResolvedValue('/opt/homebrew/bin/arm-none-eabi-gcc'),
  ARM_GCC_INSTALL_HINT: 'brew install arm-none-eabi-gcc',
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
    await buildForHardware('/project', makeDiagnostics(), makeChannel(), { spawn });
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('hardware build succeeded'),
    );
  });

  it('shows error message when make exits with non-zero code', async () => {
    const spawn = makeSpawn(2);
    await buildForHardware('/project', makeDiagnostics(), makeChannel(), { spawn });
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('hardware build failed'),
    );
  });

  it('shows error and skips make when toolchain is not found', async () => {
    (detectArmToolchain as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    const spawn = makeSpawn(0);

    await buildForHardware('/project', makeDiagnostics(), makeChannel(), { spawn });

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('arm-none-eabi-gcc not found'),
    );
    expect(spawn).not.toHaveBeenCalled();
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
    await buildForHardware('/project', diagnostics, makeChannel(), { spawn });

    expect(diagnostics.clear).toHaveBeenCalled();
    expect(diagnostics.set).toHaveBeenCalled();
  });

  it('reads the arm toolchain path from the ds-ide configuration', async () => {
    (vscode.workspace.getConfiguration as ReturnType<typeof vi.fn>).mockReturnValue({
      get: vi.fn((key: string) => key === 'armToolchainPath' ? '/custom/bin' : undefined),
    });
    const spawn = makeSpawn(0);
    await buildForHardware('/project', makeDiagnostics(), makeChannel(), { spawn });
    expect(detectArmToolchain).toHaveBeenCalledWith('/custom/bin');
  });

  it('invokes make in the project root', async () => {
    const spawn = makeSpawn(0);
    await buildForHardware('/my/project', makeDiagnostics(), makeChannel(), { spawn });
    const call = (spawn as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toBe('make');
    expect((call[2] as { cwd: string }).cwd).toBe('/my/project');
  });

  it('reuses the passed-in channel instead of creating a fallback', async () => {
    const spawn = makeSpawn(0);
    const channel = makeChannel();
    await buildForHardware('/project', makeDiagnostics(), channel, { spawn });
    expect(vscode.window.createOutputChannel).not.toHaveBeenCalled();
    expect(channel.show).toHaveBeenCalled();
  });
});
