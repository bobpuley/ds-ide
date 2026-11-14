import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as vscode from 'vscode';
import { findEffectSource, EffectSourceOutsideWorkspaceError } from '../../../commands/find-effect-source';
import { buildForEmulator, detectDaisySP } from '../../../commands/build';
import { EmulatorManager, CMakeNotFoundError, CompilerNotFoundError } from '../../../emulator/manager';
import * as fs from 'fs';
import * as path from 'path';

vi.mock('fs', () => ({
  promises: {
    readdir: vi.fn(),
    stat: vi.fn(),
    access: vi.fn(),
  },
}));

function makeChannel(): vscode.OutputChannel {
  return {
    appendLine: vi.fn(),
    show: vi.fn(),
    dispose: vi.fn(),
  } as unknown as vscode.OutputChannel;
}

function makeWorkspaceState(): vscode.Memento {
  return {
    get: vi.fn(),
    update: vi.fn(() => Promise.resolve()),
    keys: () => [],
  } as unknown as vscode.Memento;
}

describe('findEffectSource', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns the single .cpp file at root', async () => {
    vi.mocked(fs.promises.readdir).mockResolvedValue(['effect.cpp', 'Makefile'] as never);
    expect(await findEffectSource('/proj')).toBe(path.join('/proj/effect.cpp'));
  });

  it('returns undefined when no .cpp found', async () => {
    vi.mocked(fs.promises.readdir).mockResolvedValue(['Makefile'] as never);
    expect(await findEffectSource('/proj')).toBeUndefined();
  });

  it('returns undefined when multiple .cpp files present and no single non-main', async () => {
    vi.mocked(fs.promises.readdir).mockResolvedValue(['a.cpp', 'b.cpp'] as never);
    expect(await findEffectSource('/proj')).toBeUndefined();
  });

  it('picks non-main.cpp when exactly one other exists', async () => {
    vi.mocked(fs.promises.readdir).mockResolvedValue(['main.cpp', 'effect.cpp'] as never);
    expect(await findEffectSource('/proj')).toBe(path.join('/proj/effect.cpp'));
  });

  it('returns undefined on fs error', async () => {
    vi.mocked(fs.promises.readdir).mockRejectedValue(new Error('ENOENT'));
    expect(await findEffectSource('/proj')).toBeUndefined();
  });

  it('falls back to src/ subdirectory when no root .cpp found (AC-72)', async () => {
    vi.mocked(fs.promises.readdir).mockImplementation((dir) => {
      if (String(dir).endsWith('src')) return Promise.resolve(['effect.cpp'] as never);
      return Promise.resolve([] as never);
    });
    expect(await findEffectSource('/proj')).toBe(path.join('/proj/src/effect.cpp'));
  });

  it('falls back to source/ subdirectory when no root or src .cpp found (AC-72)', async () => {
    vi.mocked(fs.promises.readdir).mockImplementation((dir) => {
      if (String(dir).endsWith('source')) return Promise.resolve(['effect.cpp'] as never);
      return Promise.resolve([] as never);
    });
    expect(await findEffectSource('/proj')).toBe(path.join('/proj/source/effect.cpp'));
  });

  it('prefers root .cpp over src/ fallback (AC-72)', async () => {
    vi.mocked(fs.promises.readdir).mockImplementation((dir) => {
      if (String(dir) === '/proj') return Promise.resolve(['root.cpp'] as never);
      return Promise.resolve(['src.cpp'] as never);
    });
    expect(await findEffectSource('/proj')).toBe(path.join('/proj/root.cpp'));
  });

  it('throws EffectSourceOutsideWorkspaceError for a configured absolute path outside the workspace (FR-UX-3)', async () => {
    await expect(findEffectSource('/proj', '/etc/passwd')).rejects.toBeInstanceOf(EffectSourceOutsideWorkspaceError);
    expect(fs.promises.access).not.toHaveBeenCalled();
  });

  it('throws EffectSourceOutsideWorkspaceError for a configured relative path that escapes via ../ (FR-UX-3)', async () => {
    await expect(findEffectSource('/proj', '../../etc/passwd')).rejects.toBeInstanceOf(EffectSourceOutsideWorkspaceError);
    expect(fs.promises.access).not.toHaveBeenCalled();
  });

  it('accepts a configured absolute path inside the workspace (FR-UX-3)', async () => {
    vi.mocked(fs.promises.access).mockResolvedValue(undefined);
    expect(await findEffectSource('/proj', '/proj/nested/effect.cpp')).toBe('/proj/nested/effect.cpp');
  });

  it('accepts a configured relative path resolving inside the workspace (FR-UX-3)', async () => {
    vi.mocked(fs.promises.access).mockResolvedValue(undefined);
    expect(await findEffectSource('/proj', 'nested/effect.cpp')).toBe(path.join('/proj/nested/effect.cpp'));
  });
});

describe('detectDaisySP', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('finds DaisySP/Source at project root', async () => {
    vi.mocked(fs.promises.stat).mockImplementation((p) => {
      if (String(p).endsWith(path.join('DaisySP', 'Source'))) return Promise.resolve({ isDirectory: () => true } as fs.Stats);
      return Promise.reject(new Error('ENOENT'));
    });
    expect(await detectDaisySP('/proj')).toBe(path.join('/proj/DaisySP/Source'));
  });

  it('returns undefined when DaisySP not found', async () => {
    vi.mocked(fs.promises.stat).mockRejectedValue(new Error('ENOENT'));
    expect(await detectDaisySP('/proj')).toBeUndefined();
  });

  describe('bundled fallback (FR-EXM-1)', () => {
    const bundled = path.join('/ext', 'vendor', 'DaisySP', 'Source');
    const isDir = { isDirectory: () => true } as fs.Stats;

    it('falls back to the extension\'s bundled DaisySP when the project has none', async () => {
      vi.mocked(fs.promises.stat).mockImplementation((p) =>
        String(p) === bundled ? Promise.resolve(isDir) : Promise.reject(new Error('ENOENT')));
      expect(await detectDaisySP('/proj', '/ext')).toBe(bundled);
    });

    it('prefers the project\'s own copy over the bundled one', async () => {
      vi.mocked(fs.promises.stat).mockResolvedValue(isDir);
      expect(await detectDaisySP('/proj', '/ext')).toBe(path.join('/proj', 'DaisySP', 'Source'));
    });

    it('returns undefined when neither exists', async () => {
      vi.mocked(fs.promises.stat).mockRejectedValue(new Error('ENOENT'));
      expect(await detectDaisySP('/proj', '/ext')).toBeUndefined();
    });

    it('buildForEmulator passes the bundled DaisySP to the build when the project has none', async () => {
      (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = [{ uri: { fsPath: '/proj' } }];
      vi.mocked(fs.promises.readdir).mockResolvedValue(['effect.cpp'] as never);
      vi.mocked(fs.promises.stat).mockImplementation((p) =>
        String(p) === bundled ? Promise.resolve(isDir) : Promise.reject(new Error('ENOENT')));
      const build = vi.fn().mockResolvedValue(undefined);
      await buildForEmulator({ build } as unknown as EmulatorManager, '/ext', undefined, makeChannel(), makeWorkspaceState());
      expect(build.mock.calls[0]![0]).toMatchObject({ daisySpDir: bundled });
    });
  });
});

describe('buildForEmulator success notification (FR-UX-2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = [
      { uri: { fsPath: '/proj' } },
    ];
    vi.mocked(fs.promises.readdir).mockResolvedValue(['effect.cpp'] as never);
    vi.mocked(fs.promises.stat).mockRejectedValue(new Error('ENOENT'));
  });

  it('relies on the status bar instead of a success toast when the build succeeds', async () => {
    const manager = { build: vi.fn().mockResolvedValue(undefined) } as unknown as EmulatorManager;
    const ok = await buildForEmulator(manager, '/ext', undefined, makeChannel(), makeWorkspaceState());
    expect(ok).toBe(true);
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    expect(vscode.window.setStatusBarMessage).toHaveBeenCalledWith(
      expect.stringContaining('build succeeded'),
      expect.anything(),
    );
  });

  it('still shows an error toast when the build fails', async () => {
    const manager = { build: vi.fn().mockRejectedValue(new Error('boom')) } as unknown as EmulatorManager;
    const ok = await buildForEmulator(manager, '/ext', undefined, makeChannel(), makeWorkspaceState());
    expect(ok).toBe(false);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('build failed'),
    );
  });
});

describe('buildForEmulator failure toast on the transport path (FR-TRN-6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = [
      { uri: { fsPath: '/proj' } },
    ];
    vi.mocked(fs.promises.readdir).mockResolvedValue(['effect.cpp'] as never);
    vi.mocked(fs.promises.stat).mockRejectedValue(new Error('ENOENT'));
  });

  it('with genericFailureToast: false, a plain build failure shows no toast (the transport shows its own)', async () => {
    const manager = { build: vi.fn().mockRejectedValue(new Error('boom')) } as unknown as EmulatorManager;
    const ok = await buildForEmulator(manager, '/ext', undefined, makeChannel(), makeWorkspaceState(), undefined, { genericFailureToast: false });
    expect(ok).toBe(false);
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('with genericFailureToast: false, a non-portable-symbol diagnosis is still shown', async () => {
    const manager = {
      build: vi.fn((_o: unknown, onLine: (l: string) => void) => {
        onLine("undefined reference to `daisy::QSPIHandle::Init()'");
        return Promise.reject(new Error('link failed'));
      }),
    } as unknown as EmulatorManager;
    await buildForEmulator(manager, '/ext', undefined, makeChannel(), makeWorkspaceState(), undefined, { genericFailureToast: false });
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('not emulated'));
  });
});

describe('buildForEmulator active folder resolution (FR-UX-4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.promises.readdir).mockResolvedValue(['effect.cpp'] as never);
    vi.mocked(fs.promises.stat).mockRejectedValue(new Error('ENOENT'));
  });

  afterEach(() => {
    (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = undefined;
  });

  it('shows an error and does not build when no workspace folder is open', async () => {
    (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = undefined;
    const manager = { build: vi.fn() } as unknown as EmulatorManager;
    const ok = await buildForEmulator(manager, '/ext', undefined, makeChannel(), makeWorkspaceState());
    expect(ok).toBe(false);
    expect(manager.build).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('no workspace folder open'),
    );
  });

  it('builds the persisted active folder rather than always folder 0 in a multi-root workspace', async () => {
    (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = [
      { uri: { fsPath: '/a' }, name: 'a' },
      { uri: { fsPath: '/b' }, name: 'b' },
    ];
    const manager = { build: vi.fn().mockResolvedValue(undefined) } as unknown as EmulatorManager;
    const workspaceState = {
      get: vi.fn(() => '/b'),
      update: vi.fn(() => Promise.resolve()),
      keys: () => [],
    } as unknown as vscode.Memento;
    await buildForEmulator(manager, '/ext', undefined, makeChannel(), workspaceState);
    expect(manager.build).toHaveBeenCalledWith(
      expect.objectContaining({ projectRoot: '/b' }),
      expect.anything(),
      undefined,
    );
  });
});

// ── FR-EXT-10: ds-ide.effectSource must be honored by the build command ────

describe('buildForEmulator honors ds-ide.effectSource (FR-EXT-10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = [
      { uri: { fsPath: '/proj' } },
    ];
  });

  afterEach(() => {
    (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = undefined;
  });

  it('builds the configured effectSource file when multiple heuristic-matched .cpp files are present', async () => {
    vi.mocked(fs.promises.readdir).mockResolvedValue(['a.cpp', 'b.cpp'] as never);
    vi.mocked(fs.promises.stat).mockRejectedValue(new Error('ENOENT'));
    vi.mocked(fs.promises.access).mockResolvedValue(undefined);
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn(() => 'custom.cpp'),
    } as unknown as vscode.WorkspaceConfiguration);

    const manager = { build: vi.fn().mockResolvedValue(undefined) } as unknown as EmulatorManager;
    const ok = await buildForEmulator(manager, '/ext', undefined, makeChannel(), makeWorkspaceState());

    expect(ok).toBe(true);
    expect(manager.build).toHaveBeenCalledWith(
      expect.objectContaining({ effectSrc: path.join('/proj/custom.cpp') }),
      expect.anything(),
      undefined,
    );
  });

  it('builds the configured effectSource file when zero heuristic-matched .cpp files are present', async () => {
    vi.mocked(fs.promises.readdir).mockResolvedValue([] as never);
    vi.mocked(fs.promises.stat).mockRejectedValue(new Error('ENOENT'));
    vi.mocked(fs.promises.access).mockResolvedValue(undefined);
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn(() => 'custom.cpp'),
    } as unknown as vscode.WorkspaceConfiguration);

    const manager = { build: vi.fn().mockResolvedValue(undefined) } as unknown as EmulatorManager;
    const ok = await buildForEmulator(manager, '/ext', undefined, makeChannel(), makeWorkspaceState());

    expect(ok).toBe(true);
    expect(manager.build).toHaveBeenCalledWith(
      expect.objectContaining({ effectSrc: path.join('/proj/custom.cpp') }),
      expect.anything(),
      undefined,
    );
  });
});

describe('buildForEmulator when CMake is missing (FR-REL-2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = [
      { uri: { fsPath: '/proj' } },
    ];
    vi.mocked(fs.promises.readdir).mockResolvedValue(['effect.cpp'] as never);
    vi.mocked(fs.promises.stat).mockRejectedValue(new Error('ENOENT'));
  });

  const missingCMake = (): EmulatorManager =>
    ({ build: vi.fn().mockRejectedValue(new CMakeNotFoundError()) }) as unknown as EmulatorManager;

  it('writes the cause to the build output channel', async () => {
    const channel = makeChannel();
    await buildForEmulator(missingCMake(), '/ext', undefined, channel, makeWorkspaceState());
    expect(channel.appendLine).toHaveBeenCalledWith(expect.stringMatching(/CMake not found.*brew install cmake/));
  });

  it('shows the specific message in the build-failed toast', async () => {
    const ok = await buildForEmulator(missingCMake(), '/ext', undefined, makeChannel(), makeWorkspaceState());
    expect(ok).toBe(false);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringMatching(/CMake not found.*brew install cmake/));
  });

  it('on the transport path (no generic toast) it reports the reason to the caller instead of toasting', async () => {
    const onFailureReason = vi.fn();
    const ok = await buildForEmulator(
      missingCMake(), '/ext', undefined, makeChannel(), makeWorkspaceState(), undefined,
      { genericFailureToast: false, onFailureReason },
    );
    expect(ok).toBe(false);
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(onFailureReason).toHaveBeenCalledWith(expect.stringMatching(/CMake not found.*brew install cmake/));
  });

  it('an ordinary build failure reports no reason to the caller', async () => {
    const onFailureReason = vi.fn();
    const manager = { build: vi.fn().mockRejectedValue(new Error('boom')) } as unknown as EmulatorManager;
    await buildForEmulator(
      manager, '/ext', undefined, makeChannel(), makeWorkspaceState(), undefined,
      { genericFailureToast: false, onFailureReason },
    );
    expect(onFailureReason).not.toHaveBeenCalled();
  });
});

describe('buildForEmulator when the C++ compiler is missing (FR-PRE-1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = [
      { uri: { fsPath: '/proj' } },
    ];
    vi.mocked(fs.promises.readdir).mockResolvedValue(['effect.cpp'] as never);
    vi.mocked(fs.promises.stat).mockRejectedValue(new Error('ENOENT'));
  });

  const missingCompiler = (): EmulatorManager =>
    ({ build: vi.fn().mockRejectedValue(new CompilerNotFoundError()) }) as unknown as EmulatorManager;

  it('writes the cause to the output channel and toasts it, with no Show Problems button', async () => {
    const channel = makeChannel();
    const ok = await buildForEmulator(missingCompiler(), '/ext', undefined, channel, makeWorkspaceState());
    expect(ok).toBe(false);
    expect(channel.appendLine).toHaveBeenCalledWith(expect.stringContaining('xcode-select --install'));
    expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(vscode.window.showErrorMessage).mock.calls[0]).toHaveLength(1);
    expect(vi.mocked(vscode.window.showErrorMessage).mock.calls[0]![0]).toMatch(/xcode-select --install/);
  });
});
