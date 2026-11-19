import { describe, it, expect, vi, afterEach } from 'vitest';
import { setManagedToolDirsProvider } from '../../../hardware/tool-locator';
import {
  detectArmToolchain,
  detectDfuUtil,
  detectCMake,
  detectCxxCompiler,
  CXX_COMPILER_NOT_FOUND_MESSAGE,
  LLDB_DAP_NOT_FOUND_MESSAGE,
  CMAKE_CANDIDATES,
  CMAKE_NOT_FOUND_MESSAGE,
  ARM_GCC_BINARY,
  ARM_GCC_CANDIDATES,
  DFU_UTIL_CANDIDATES,
  detectMake,
  detectLldbDap,
  detectNinja,
  armGccInstallHint,
  dfuUtilInstallHint,
  makeInstallHint,
  cmakeNotFoundMessage,
  cxxCompilerNotFoundMessage,
  ARM_GCC_INSTALL_HINT,
  DFU_UTIL_INSTALL_HINT,
} from '../../../hardware/toolchain';

// These suites describe the macOS/Linux behaviour; the platform is explicit so
// they hold on a Windows host too (FR-WIN-TCH-5).
const MAC = { platform: 'darwin' } as const;

// ── detectArmToolchain ────────────────────────────────────────────────────────

describe('detectArmToolchain()', () => {
  it('returns the configured path when it points directly to the binary', async () => {
    const exists = vi.fn((p: string) => Promise.resolve(p === '/custom/bin/arm-none-eabi-gcc'));
    const exec = vi.fn(() => Promise.reject(new Error()));

    const result = await detectArmToolchain('/custom/bin/arm-none-eabi-gcc', exists, exec, MAC);
    expect(result).toBe('/custom/bin/arm-none-eabi-gcc');
  });

  it('appends binary name when configured path is a bin directory', async () => {
    const exists = vi.fn((p: string) => Promise.resolve(p === '/custom/bin/arm-none-eabi-gcc'));
    const exec = vi.fn(() => Promise.reject(new Error()));

    const result = await detectArmToolchain('/custom/bin', exists, exec, MAC);
    expect(result).toBe('/custom/bin/arm-none-eabi-gcc');
  });

  it('appends binary name even when configured directory has trailing slash', async () => {
    const exists = vi.fn((p: string) => Promise.resolve(p === '/custom/bin/arm-none-eabi-gcc'));
    const exec = vi.fn(() => Promise.reject(new Error()));

    const result = await detectArmToolchain('/custom/bin/', exists, exec, MAC);
    expect(result).toBe('/custom/bin/arm-none-eabi-gcc');
  });

  it('ignores a configured path that does not exist', async () => {
    const exists = vi.fn((p: string) => Promise.resolve(p === ARM_GCC_CANDIDATES[0]));
    const exec = vi.fn(() => Promise.reject(new Error()));

    const result = await detectArmToolchain('/nonexistent/bin', exists, exec, MAC);
    expect(result).toBe(ARM_GCC_CANDIDATES[0]);
  });

  it('returns the which result when found on PATH', async () => {
    const exists = vi.fn(() => Promise.resolve(true));
    const exec = vi.fn(() => Promise.resolve('/usr/bin/arm-none-eabi-gcc\n'));

    const result = await detectArmToolchain(undefined, exists, exec, MAC);
    expect(result).toBe('/usr/bin/arm-none-eabi-gcc');
    expect(exec).toHaveBeenCalledWith('which', [ARM_GCC_BINARY]);
  });

  it('skips which result when the path does not exist on disk', async () => {
    const exists = vi.fn((p: string) => Promise.resolve(p === ARM_GCC_CANDIDATES[0]));
    const exec = vi.fn(() => Promise.resolve('/ghost/arm-none-eabi-gcc\n'));

    const result = await detectArmToolchain(undefined, exists, exec, MAC);
    expect(result).toBe(ARM_GCC_CANDIDATES[0]);
  });

  it('falls back to known Homebrew path when which fails', async () => {
    const exists = vi.fn((p: string) => Promise.resolve(p === ARM_GCC_CANDIDATES[0]));
    const exec = vi.fn(() => Promise.reject(new Error('not found')));

    const result = await detectArmToolchain(undefined, exists, exec, MAC);
    expect(result).toBe(ARM_GCC_CANDIDATES[0]);
  });

  it('falls back to second candidate when first is absent', async () => {
    const exists = vi.fn((p: string) => Promise.resolve(p === ARM_GCC_CANDIDATES[1]));
    const exec = vi.fn(() => Promise.reject(new Error()));

    const result = await detectArmToolchain(undefined, exists, exec, MAC);
    expect(result).toBe(ARM_GCC_CANDIDATES[1]);
  });

  it('returns undefined when no candidate exists', async () => {
    const exists = vi.fn(() => Promise.resolve(false));
    const exec = vi.fn(() => Promise.reject(new Error()));

    const result = await detectArmToolchain(undefined, exists, exec, MAC);
    expect(result).toBeUndefined();
  });
});

// ── detectDfuUtil ─────────────────────────────────────────────────────────────

describe('detectDfuUtil()', () => {
  it('returns the which result when dfu-util is on PATH', async () => {
    const exists = vi.fn(() => Promise.resolve(true));
    const exec = vi.fn(() => Promise.resolve('/usr/bin/dfu-util\n'));

    const result = await detectDfuUtil(exists, exec, MAC);
    expect(result).toBe('/usr/bin/dfu-util');
  });

  it('falls back to Homebrew candidate when which fails', async () => {
    const exists = vi.fn((p: string) => Promise.resolve(p === DFU_UTIL_CANDIDATES[0]));
    const exec = vi.fn(() => Promise.reject(new Error()));

    const result = await detectDfuUtil(exists, exec, MAC);
    expect(result).toBe(DFU_UTIL_CANDIDATES[0]);
  });

  it('returns undefined when dfu-util is not found anywhere', async () => {
    const exists = vi.fn(() => Promise.resolve(false));
    const exec = vi.fn(() => Promise.reject(new Error()));

    const result = await detectDfuUtil(exists, exec, MAC);
    expect(result).toBeUndefined();
  });

  it('skips which result when the path does not exist on disk', async () => {
    const exists = vi.fn((p: string) => Promise.resolve(p === DFU_UTIL_CANDIDATES[0]));
    const exec = vi.fn(() => Promise.resolve('/ghost/dfu-util\n'));

    const result = await detectDfuUtil(exists, exec, MAC);
    expect(result).toBe(DFU_UTIL_CANDIDATES[0]);
  });
});

// ── detectCMake (FR-REL-2) ────────────────────────────────────────────────────

describe('detectCMake()', () => {
  it('returns the which result when cmake is on PATH (PATH wins over known locations)', async () => {
    const exists = vi.fn(() => Promise.resolve(true));
    const exec = vi.fn(() => Promise.resolve('/custom/bin/cmake\n'));

    expect(await detectCMake(exists, exec, MAC)).toBe('/custom/bin/cmake');
  });

  it('falls back to the Homebrew location when which fails', async () => {
    const exists = vi.fn((p: string) => Promise.resolve(p === CMAKE_CANDIDATES[0]));
    const exec = vi.fn(() => Promise.reject(new Error()));

    expect(await detectCMake(exists, exec, MAC)).toBe('/opt/homebrew/bin/cmake');
  });

  it('falls back to /usr/local/bin when only that exists', async () => {
    const exists = vi.fn((p: string) => Promise.resolve(p === '/usr/local/bin/cmake'));
    const exec = vi.fn(() => Promise.reject(new Error()));

    expect(await detectCMake(exists, exec, MAC)).toBe('/usr/local/bin/cmake');
  });

  it('ignores a which result that does not exist on disk and keeps looking', async () => {
    const exists = vi.fn((p: string) => Promise.resolve(p === CMAKE_CANDIDATES[0]));
    const exec = vi.fn(() => Promise.resolve('/stale/cmake\n'));

    expect(await detectCMake(exists, exec, MAC)).toBe(CMAKE_CANDIDATES[0]);
  });

  it('returns undefined when cmake is not found anywhere', async () => {
    const exists = vi.fn(() => Promise.resolve(false));
    const exec = vi.fn(() => Promise.reject(new Error()));

    expect(await detectCMake(exists, exec, MAC)).toBeUndefined();
  });

  it('has a not-found message that names CMake and how to install it', () => {
    expect(CMAKE_NOT_FOUND_MESSAGE).toMatch(/CMake not found/);
    expect(CMAKE_NOT_FOUND_MESSAGE).toMatch(/brew install cmake/);
  });
});

// ── detectCxxCompiler (FR-PRE-1) ──────────────────────────────────────────────

describe('detectCxxCompiler()', () => {
  const CLT = '/Library/Developer/CommandLineTools';

  it('returns the compiler inside the developer directory xcode-select reports', async () => {
    const exec = vi.fn((cmd: string) => cmd === 'xcode-select' ? Promise.resolve(`${CLT}\n`) : Promise.reject(new Error()));
    const exists = vi.fn((p: string) => Promise.resolve(p === `${CLT}/usr/bin/clang++`));
    expect(await detectCxxCompiler(exists, exec, MAC)).toBe(`${CLT}/usr/bin/clang++`);
  });

  it('is not fooled by the /usr/bin/clang++ stub that exists without the Command Line Tools', async () => {
    const exec = vi.fn(() => Promise.reject(new Error('xcode-select: error: no developer tools were found')));
    const exists = vi.fn((p: string) => Promise.resolve(p === '/usr/bin/clang++'));
    expect(await detectCxxCompiler(exists, exec, MAC)).toBeUndefined();
  });

  it('falls back to the known Command Line Tools location when xcode-select cannot be run', async () => {
    const exec = vi.fn(() => Promise.reject(new Error()));
    const exists = vi.fn((p: string) => Promise.resolve(p === `${CLT}/usr/bin/clang++`));
    expect(await detectCxxCompiler(exists, exec, MAC)).toBe(`${CLT}/usr/bin/clang++`);
  });

  it('returns undefined when no compiler is found anywhere', async () => {
    const exec = vi.fn(() => Promise.reject(new Error()));
    const exists = vi.fn(() => Promise.resolve(false));
    expect(await detectCxxCompiler(exists, exec, MAC)).toBeUndefined();
  });

  it('has not-found messages that name xcode-select --install', () => {
    expect(CXX_COMPILER_NOT_FOUND_MESSAGE).toBe(
      'Xcode Command Line Tools not found. Run `xcode-select --install` and try again.');
    expect(LLDB_DAP_NOT_FOUND_MESSAGE).toMatch(/lldb-dap not found.*xcode-select --install/);
  });
});

// ── Windows discovery (FR-WIN-TCH-1) ─────────────────────────────────────────
// Platform, environment and directory listings are injected, so these run on
// any host.

const WIN_ENV = {
  ProgramFiles: 'C:\\Program Files',
  'ProgramFiles(x86)': 'C:\\Program Files (x86)',
  ProgramData: 'C:\\ProgramData',
  SystemDrive: 'C:',
  USERPROFILE: 'C:\\Users\\me',
  APPDATA: 'C:\\Users\\me\\AppData\\Roaming',
  LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
};
const winOpts = (listDir?: (d: string) => Promise<string[]>) =>
  ({ platform: 'win32' as const, env: WIN_ENV, ...(listDir ? { listDir } : {}) });
const present = (...files: string[]) => vi.fn(async (p: string) => files.includes(p));
const noPath = vi.fn(async (): Promise<string> => { throw new Error('where: not found'); });
const noList = async (): Promise<string[]> => { throw new Error('ENOENT'); };

describe('Windows: detectArmToolchain()', () => {
  it('finds it on PATH through where.exe', async () => {
    const exec = vi.fn(async () => 'C:\\tools\\arm\\bin\\arm-none-eabi-gcc.exe\r\n');
    const exists = present('C:\\tools\\arm\\bin\\arm-none-eabi-gcc.exe');
    expect(await detectArmToolchain(undefined, exists, exec, winOpts(noList)))
      .toBe('C:\\tools\\arm\\bin\\arm-none-eabi-gcc.exe');
    expect(exec).toHaveBeenCalledWith('where.exe', ['arm-none-eabi-gcc']);
  });

  it('honours a configured bin directory and adds .exe', async () => {
    const exists = present('D:\\arm\\bin\\arm-none-eabi-gcc.exe');
    expect(await detectArmToolchain('D:\\arm\\bin', exists, noPath, winOpts(noList)))
      .toBe('D:\\arm\\bin\\arm-none-eabi-gcc.exe');
  });

  it('finds the newest Arm GNU Toolchain default install (versioned directory)', async () => {
    const root = 'C:\\Program Files (x86)\\Arm GNU Toolchain arm-none-eabi';
    const exists = present(`${root}\\12.2 Rel1\\bin\\arm-none-eabi-gcc.exe`, `${root}\\13.3 Rel1\\bin\\arm-none-eabi-gcc.exe`);
    const listDir = async (d: string) => { if (d === root) return ['12.2 Rel1', '13.3 Rel1']; throw new Error('ENOENT'); };
    expect(await detectArmToolchain(undefined, exists, noPath, winOpts(listDir)))
      .toBe(`${root}\\13.3 Rel1\\bin\\arm-none-eabi-gcc.exe`);
  });

  it('finds an xPack global install', async () => {
    const root = 'C:\\Users\\me\\AppData\\Roaming\\xPacks\\@xpack-dev-tools\\arm-none-eabi-gcc';
    const exe = `${root}\\13.2.1-1.1\\.content\\bin\\arm-none-eabi-gcc.exe`;
    const listDir = async (d: string) => { if (d === root) return ['13.2.1-1.1']; throw new Error('ENOENT'); };
    expect(await detectArmToolchain(undefined, present(exe), noPath, winOpts(listDir))).toBe(exe);
  });

  it('finds an MSYS2 install', async () => {
    const exe = 'C:\\msys64\\mingw64\\bin\\arm-none-eabi-gcc.exe';
    expect(await detectArmToolchain(undefined, present(exe), noPath, winOpts(noList))).toBe(exe);
  });

  it('returns undefined when there is none', async () => {
    expect(await detectArmToolchain(undefined, present(), noPath, winOpts(noList))).toBeUndefined();
  });
});

describe('Windows: detectDfuUtil()', () => {
  it.each([
    'C:\\Program Files\\dfu-util\\dfu-util.exe',
    'C:\\msys64\\mingw64\\bin\\dfu-util.exe',
    'C:\\ProgramData\\chocolatey\\bin\\dfu-util.exe',
  ])('finds %s', async (exe) => {
    expect(await detectDfuUtil(present(exe), noPath, winOpts(noList))).toBe(exe);
  });

  it('returns undefined when there is none', async () => {
    expect(await detectDfuUtil(present(), noPath, winOpts(noList))).toBeUndefined();
  });
});

describe('detectMake()', () => {
  it('on Windows finds the MSYS2 and Chocolatey makes', async () => {
    for (const exe of ['C:\\msys64\\usr\\bin\\make.exe', 'C:\\ProgramData\\chocolatey\\bin\\make.exe']) {
      expect(await detectMake(present(exe), noPath, winOpts(noList))).toBe(exe);
    }
  });

  it('on Windows asks where.exe first', async () => {
    const exec = vi.fn(async () => 'C:\\gnu\\make.exe\r\n');
    expect(await detectMake(present('C:\\gnu\\make.exe'), exec, winOpts(noList))).toBe('C:\\gnu\\make.exe');
    expect(exec).toHaveBeenCalledWith('where.exe', ['make']);
  });

  it('on macOS/Linux finds make on PATH, then /usr/bin', async () => {
    const exec = vi.fn(async () => '/opt/x/make\n');
    expect(await detectMake(present('/opt/x/make'), exec, MAC)).toBe('/opt/x/make');
    expect(await detectMake(present('/usr/bin/make'), noPath, MAC)).toBe('/usr/bin/make');
  });

  it('returns undefined when there is none', async () => {
    expect(await detectMake(present(), noPath, MAC)).toBeUndefined();
    expect(await detectMake(present(), noPath, winOpts(noList))).toBeUndefined();
  });
});

describe('Windows: detectCMake()', () => {
  it.each([
    'C:\\Program Files\\CMake\\bin\\cmake.exe',
    'C:\\msys64\\clang64\\bin\\cmake.exe',
  ])('finds %s', async (exe) => {
    expect(await detectCMake(present(exe), noPath, winOpts(noList))).toBe(exe);
  });
});

describe('Windows: detectCxxCompiler()', () => {
  it('finds clang++ on PATH without ever asking xcode-select', async () => {
    const exec = vi.fn(async (cmd: string) => {
      if (cmd === 'where.exe') return 'C:\\msys64\\clang64\\bin\\clang++.exe\r\n';
      throw new Error('unexpected ' + cmd);
    });
    expect(await detectCxxCompiler(present('C:\\msys64\\clang64\\bin\\clang++.exe'), exec, winOpts(noList)))
      .toBe('C:\\msys64\\clang64\\bin\\clang++.exe');
    expect(exec).not.toHaveBeenCalledWith('xcode-select', expect.anything());
  });

  it.each([
    'C:\\Program Files\\LLVM\\bin\\clang++.exe',
    'C:\\msys64\\clang64\\bin\\clang++.exe',
  ])('finds %s', async (exe) => {
    expect(await detectCxxCompiler(present(exe), noPath, winOpts(noList))).toBe(exe);
  });

  it('returns undefined when there is none', async () => {
    expect(await detectCxxCompiler(present(), noPath, winOpts(noList))).toBeUndefined();
  });
});

describe('install hints per platform', () => {
  it('macOS/Linux keep the existing wording', () => {
    expect(armGccInstallHint('darwin')).toBe(ARM_GCC_INSTALL_HINT);
    expect(armGccInstallHint('linux')).toBe(ARM_GCC_INSTALL_HINT);
    expect(dfuUtilInstallHint('darwin')).toBe(DFU_UTIL_INSTALL_HINT);
    expect(cmakeNotFoundMessage('darwin')).toBe(CMAKE_NOT_FOUND_MESSAGE);
    expect(cxxCompilerNotFoundMessage('darwin')).toBe(CXX_COMPILER_NOT_FOUND_MESSAGE);
  });

  it('Windows hints never mention Homebrew or Xcode', () => {
    const all = [
      armGccInstallHint('win32'), dfuUtilInstallHint('win32'), makeInstallHint('win32'),
      cmakeNotFoundMessage('win32'), cxxCompilerNotFoundMessage('win32'),
    ];
    for (const h of all) expect(h).not.toMatch(/brew|xcode/i);
  });

  it('Windows hints name where to get each tool', () => {
    expect(armGccInstallHint('win32')).toMatch(/Arm GNU Toolchain/);
    expect(armGccInstallHint('win32')).toMatch(/xPack/);
    expect(dfuUtilInstallHint('win32')).toMatch(/dfu-util/i);
    expect(makeInstallHint('win32')).toMatch(/MSYS2|make/);
    expect(cmakeNotFoundMessage('win32')).toMatch(/CMake not found/);
    expect(cxxCompilerNotFoundMessage('win32')).toMatch(/clang/i);
  });
});

// ── managed toolchain in the lookup order (FR-WIN-TCH-5) ─────────────────────
// The managed toolchain is the LAST source: configured path, PATH and the known
// install locations all win over it, so a user-installed toolchain is an override.

describe('managed toolchain in the lookup order (FR-WIN-TCH-5)', () => {
  const MANAGED = 'C:\\store\\1\\llvm-mingw\\bin';
  const MANAGED_CMAKE = 'C:\\store\\1\\cmake\\bin';

  afterEach(() => setManagedToolDirsProvider(undefined));

  const withManaged = (): void => setManagedToolDirsProvider(async () => [MANAGED, MANAGED_CMAKE]);

  it('finds cmake, the compiler and lldb-dap in the managed directories', async () => {
    withManaged();
    expect(await detectCMake(present(`${MANAGED_CMAKE}\\cmake.exe`), noPath, winOpts(noList))).toBe(`${MANAGED_CMAKE}\\cmake.exe`);
    expect(await detectCxxCompiler(present(`${MANAGED}\\clang++.exe`), noPath, winOpts(noList))).toBe(`${MANAGED}\\clang++.exe`);
    expect(await detectLldbDap(present(`${MANAGED}\\lldb-dap.exe`), noPath, winOpts(noList))).toBe(`${MANAGED}\\lldb-dap.exe`);
  });

  it('a toolchain on PATH wins over the managed one', async () => {
    withManaged();
    const exec = vi.fn(async () => 'C:\\mine\\cmake.exe\r\n');
    const exists = present('C:\\mine\\cmake.exe', `${MANAGED_CMAKE}\\cmake.exe`);
    expect(await detectCMake(exists, exec, winOpts(noList))).toBe('C:\\mine\\cmake.exe');
  });

  it('a toolchain in a known install location wins over the managed one', async () => {
    withManaged();
    const known = 'C:\\Program Files\\CMake\\bin\\cmake.exe';
    expect(await detectCMake(present(known, `${MANAGED_CMAKE}\\cmake.exe`), noPath, winOpts(noList))).toBe(known);
  });

  it('the configured arm toolchain path wins over the managed one', async () => {
    setManagedToolDirsProvider(async () => ['C:\\store\\1\\arm\\bin']);
    const exists = present('D:\\arm\\bin\\arm-none-eabi-gcc.exe', 'C:\\store\\1\\arm\\bin\\arm-none-eabi-gcc.exe');
    expect(await detectArmToolchain('D:\\arm\\bin', exists, noPath, winOpts(noList))).toBe('D:\\arm\\bin\\arm-none-eabi-gcc.exe');
  });

  it('tools the managed set does not ship (arm-none-eabi-gcc, make, dfu-util) are simply not found there', async () => {
    withManaged();
    expect(await detectArmToolchain(undefined, present(), noPath, winOpts(noList))).toBeUndefined();
    expect(await detectMake(present(), noPath, winOpts(noList))).toBeUndefined();
    expect(await detectDfuUtil(present(), noPath, winOpts(noList))).toBeUndefined();
  });

  it('without a managed install nothing changes', async () => {
    setManagedToolDirsProvider(async () => []);
    expect(await detectCMake(present(), noPath, winOpts(noList))).toBeUndefined();
  });
});

describe('detectNinja() (FR-WIN-TCH-5)', () => {
  it('on Windows finds ninja on PATH through where.exe', async () => {
    const exec = vi.fn(async () => 'C:\\tools\\ninja.exe\r\n');
    expect(await detectNinja(present('C:\\tools\\ninja.exe'), exec, winOpts(noList))).toBe('C:\\tools\\ninja.exe');
    expect(exec).toHaveBeenCalledWith('where.exe', ['ninja']);
  });

  it.each([
    'C:\\msys64\\clang64\\bin\\ninja.exe',
    'C:\\ProgramData\\chocolatey\\bin\\ninja.exe',
    'C:\\Users\\me\\scoop\\shims\\ninja.exe',
  ])('on Windows finds ninja at %s', async (exe) => {
    expect(await detectNinja(present(exe), noPath, winOpts(noList))).toBe(exe);
  });

  it('finds the managed Ninja, last', async () => {
    setManagedToolDirsProvider(async () => ['C:\\store\\1\\ninja']);
    try {
      expect(await detectNinja(present('C:\\store\\1\\ninja\\ninja.exe'), noPath, winOpts(noList))).toBe('C:\\store\\1\\ninja\\ninja.exe');
    } finally {
      setManagedToolDirsProvider(undefined);
    }
  });

  it('on macOS/Linux finds ninja on PATH, then Homebrew', async () => {
    expect(await detectNinja(present('/opt/x/ninja'), vi.fn(async () => '/opt/x/ninja\n'), MAC)).toBe('/opt/x/ninja');
    expect(await detectNinja(present('/opt/homebrew/bin/ninja'), noPath, MAC)).toBe('/opt/homebrew/bin/ninja');
  });

  it('returns undefined when there is none', async () => {
    expect(await detectNinja(present(), noPath, MAC)).toBeUndefined();
    expect(await detectNinja(present(), noPath, winOpts(noList))).toBeUndefined();
  });
});
