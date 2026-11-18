import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  locateTool,
  executableName,
  setManagedToolDirsProvider,
  type ToolSpec,
} from '../../../hardware/tool-locator';

// Fixtures use injected `exists` / `exec` / `listDir`, so both platforms are
// exercised on any host (FR-WIN-TCH-5).

const existsIn = (...present: string[]) => vi.fn(async (p: string) => present.includes(p));
const execReturning = (out: string) => vi.fn(async () => out);
const execFailing = () => vi.fn(async () => { throw new Error('not found'); });

const posixSpec: ToolSpec = {
  binary: 'mytool',
  knownDirs: () => ['/opt/homebrew/bin', '/usr/local/bin'],
};

const winSpec: ToolSpec = {
  binary: 'mytool',
  knownDirs: (_platform, env) => [
    `${env['ProgramFiles'] ?? 'C:\\Program Files'}\\MyTool\\bin`,
    'C:\\msys64\\usr\\bin',
  ],
};

afterEach(() => setManagedToolDirsProvider(undefined));

describe('executableName()', () => {
  it('adds .exe on Windows only', () => {
    expect(executableName('cmake', 'win32')).toBe('cmake.exe');
    expect(executableName('cmake', 'darwin')).toBe('cmake');
    expect(executableName('cmake', 'linux')).toBe('cmake');
  });
});

describe('locateTool() — macOS / Linux (results unchanged)', () => {
  it.each(['darwin', 'linux'] as const)('configured path to the binary wins on %s', async (platform) => {
    const exec = execReturning('/usr/local/bin/mytool\n');
    const result = await locateTool(posixSpec, '/custom/bin/mytool', {
      platform, exists: existsIn('/custom/bin/mytool', '/usr/local/bin/mytool'), exec,
    });
    expect(result).toBe('/custom/bin/mytool');
    expect(exec).not.toHaveBeenCalled();
  });

  it('appends the binary name to a configured directory, with or without trailing slash', async () => {
    const exists = existsIn('/custom/bin/mytool');
    expect(await locateTool(posixSpec, '/custom/bin', { platform: 'darwin', exists, exec: execFailing() }))
      .toBe('/custom/bin/mytool');
    expect(await locateTool(posixSpec, '/custom/bin/', { platform: 'darwin', exists, exec: execFailing() }))
      .toBe('/custom/bin/mytool');
  });

  it('ignores a configured path that does not exist and keeps looking', async () => {
    const result = await locateTool(posixSpec, '/nope/mytool', {
      platform: 'darwin', exists: existsIn('/usr/local/bin/mytool'), exec: execFailing(),
    });
    expect(result).toBe('/usr/local/bin/mytool');
  });

  it('asks `which` for PATH and returns its answer when it exists on disk', async () => {
    const exec = execReturning('/somewhere/mytool\n');
    const result = await locateTool(posixSpec, undefined, {
      platform: 'darwin', exists: existsIn('/somewhere/mytool', '/usr/local/bin/mytool'), exec,
    });
    expect(result).toBe('/somewhere/mytool');
    expect(exec).toHaveBeenCalledWith('which', ['mytool']);
  });

  it('skips a `which` answer that is not on disk', async () => {
    const result = await locateTool(posixSpec, undefined, {
      platform: 'darwin', exists: existsIn('/opt/homebrew/bin/mytool'), exec: execReturning('/ghost/mytool\n'),
    });
    expect(result).toBe('/opt/homebrew/bin/mytool');
  });

  it('falls through the known directories in order', async () => {
    const result = await locateTool(posixSpec, undefined, {
      platform: 'darwin', exists: existsIn('/usr/local/bin/mytool'), exec: execFailing(),
    });
    expect(result).toBe('/usr/local/bin/mytool');
  });

  it('tries every PATH name in turn (e.g. versioned binaries)', async () => {
    const spec: ToolSpec = { binary: 'dap', pathNames: ['dap', 'dap-20', 'dap-19'] };
    const exec = vi.fn(async (_c: string, args: string[]) => {
      if (args[0] === 'dap-19') return '/usr/bin/dap-19\n';
      throw new Error('nope');
    });
    const result = await locateTool(spec, undefined, {
      platform: 'linux', exists: existsIn('/usr/bin/dap-19'), exec,
    });
    expect(result).toBe('/usr/bin/dap-19');
    expect(exec.mock.calls.map((c) => c[1][0])).toEqual(['dap', 'dap-20', 'dap-19']);
  });

  it('returns undefined when nothing is found anywhere', async () => {
    expect(await locateTool(posixSpec, undefined, {
      platform: 'darwin', exists: existsIn(), exec: execFailing(),
    })).toBeUndefined();
  });
});

describe('locateTool() — Windows', () => {
  it('asks where.exe (not which) for PATH and returns the first answer that exists', async () => {
    const exec = execReturning('C:\\ghost\\mytool.exe\r\nC:\\tools\\bin\\mytool.exe\r\n');
    const result = await locateTool(winSpec, undefined, {
      platform: 'win32', exists: existsIn('C:\\tools\\bin\\mytool.exe'), exec, env: {},
    });
    expect(result).toBe('C:\\tools\\bin\\mytool.exe');
    expect(exec).toHaveBeenCalledWith('where.exe', ['mytool']);
  });

  it('appends mytool.exe to a configured directory, with either kind of trailing separator', async () => {
    const exists = existsIn('D:\\arm\\bin\\mytool.exe');
    for (const dir of ['D:\\arm\\bin', 'D:\\arm\\bin\\', 'D:\\arm\\bin/']) {
      expect(await locateTool(winSpec, dir, { platform: 'win32', exists, exec: execFailing(), env: {} }))
        .toBe('D:\\arm\\bin\\mytool.exe');
    }
  });

  it('accepts a configured full path with or without the .exe suffix', async () => {
    const exists = existsIn('D:\\arm\\bin\\mytool.exe');
    expect(await locateTool(winSpec, 'D:\\arm\\bin\\mytool.exe', { platform: 'win32', exists, exec: execFailing(), env: {} }))
      .toBe('D:\\arm\\bin\\mytool.exe');
    expect(await locateTool(winSpec, 'D:\\arm\\bin\\mytool', { platform: 'win32', exists, exec: execFailing(), env: {} }))
      .toBe('D:\\arm\\bin\\mytool.exe');
  });

  it('uses the known install locations, built from the environment, with backslash joins', async () => {
    const result = await locateTool(winSpec, undefined, {
      platform: 'win32',
      exists: existsIn('E:\\Progs\\MyTool\\bin\\mytool.exe'),
      exec: execFailing(),
      env: { ProgramFiles: 'E:\\Progs' },
    });
    expect(result).toBe('E:\\Progs\\MyTool\\bin\\mytool.exe');
  });

  it('PATH wins over the known install locations', async () => {
    const result = await locateTool(winSpec, undefined, {
      platform: 'win32',
      exists: existsIn('C:\\onpath\\mytool.exe', 'C:\\msys64\\usr\\bin\\mytool.exe'),
      exec: execReturning('C:\\onpath\\mytool.exe\r\n'),
      env: {},
    });
    expect(result).toBe('C:\\onpath\\mytool.exe');
  });

  it('returns undefined when nothing is found', async () => {
    expect(await locateTool(winSpec, undefined, {
      platform: 'win32', exists: existsIn(), exec: execFailing(), env: {},
    })).toBeUndefined();
  });
});

describe('locateTool() — versioned install directories', () => {
  const spec: ToolSpec = {
    binary: 'gcc',
    knownDirs: () => ['C:\\Arm\\*\\bin'],
  };

  it('expands a * segment newest-first from the directory listing', async () => {
    const listDir = vi.fn(async () => ['12.2', '13.3', '9.1']);
    const result = await locateTool(spec, undefined, {
      platform: 'win32',
      exists: existsIn('C:\\Arm\\13.3\\bin\\gcc.exe', 'C:\\Arm\\12.2\\bin\\gcc.exe'),
      exec: execFailing(), listDir, env: {},
    });
    expect(result).toBe('C:\\Arm\\13.3\\bin\\gcc.exe');
    expect(listDir).toHaveBeenCalledWith('C:\\Arm');
  });

  it('sorts versions numerically, so 10 beats 9', async () => {
    const result = await locateTool(spec, undefined, {
      platform: 'win32',
      exists: existsIn('C:\\Arm\\10\\bin\\gcc.exe', 'C:\\Arm\\9\\bin\\gcc.exe'),
      exec: execFailing(), listDir: async () => ['9', '10'], env: {},
    });
    expect(result).toBe('C:\\Arm\\10\\bin\\gcc.exe');
  });

  it('treats an unreadable parent directory as having no versions', async () => {
    const result = await locateTool(spec, undefined, {
      platform: 'win32', exists: existsIn(), exec: execFailing(),
      listDir: async () => { throw new Error('ENOENT'); }, env: {},
    });
    expect(result).toBeUndefined();
  });
});

describe('locateTool() — managed-toolchain extension point (filled in M82)', () => {
  it('is consulted after PATH and the known locations', async () => {
    setManagedToolDirsProvider(async () => ['/managed/bin']);
    const exists = existsIn('/managed/bin/mytool');
    expect(await locateTool(posixSpec, undefined, { platform: 'darwin', exists, exec: execFailing() }))
      .toBe('/managed/bin/mytool');

    const both = existsIn('/managed/bin/mytool', '/usr/local/bin/mytool');
    expect(await locateTool(posixSpec, undefined, { platform: 'darwin', exists: both, exec: execFailing() }))
      .toBe('/usr/local/bin/mytool');
  });

  it('receives the tool name', async () => {
    const provider = vi.fn(async () => [] as string[]);
    setManagedToolDirsProvider(provider);
    await locateTool(posixSpec, undefined, { platform: 'darwin', exists: existsIn(), exec: execFailing() });
    expect(provider).toHaveBeenCalledWith('mytool');
  });

  it('does nothing when no provider is registered', async () => {
    expect(await locateTool(posixSpec, undefined, { platform: 'darwin', exists: existsIn(), exec: execFailing() }))
      .toBeUndefined();
  });
});
