import { describe, it, expect, vi } from 'vitest';
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
} from '../../../hardware/toolchain';

// ── detectArmToolchain ────────────────────────────────────────────────────────

describe('detectArmToolchain()', () => {
  it('returns the configured path when it points directly to the binary', async () => {
    const exists = vi.fn((p: string) => Promise.resolve(p === '/custom/bin/arm-none-eabi-gcc'));
    const exec = vi.fn(() => Promise.reject(new Error()));

    const result = await detectArmToolchain('/custom/bin/arm-none-eabi-gcc', exists, exec);
    expect(result).toBe('/custom/bin/arm-none-eabi-gcc');
  });

  it('appends binary name when configured path is a bin directory', async () => {
    const exists = vi.fn((p: string) => Promise.resolve(p === '/custom/bin/arm-none-eabi-gcc'));
    const exec = vi.fn(() => Promise.reject(new Error()));

    const result = await detectArmToolchain('/custom/bin', exists, exec);
    expect(result).toBe('/custom/bin/arm-none-eabi-gcc');
  });

  it('appends binary name even when configured directory has trailing slash', async () => {
    const exists = vi.fn((p: string) => Promise.resolve(p === '/custom/bin/arm-none-eabi-gcc'));
    const exec = vi.fn(() => Promise.reject(new Error()));

    const result = await detectArmToolchain('/custom/bin/', exists, exec);
    expect(result).toBe('/custom/bin/arm-none-eabi-gcc');
  });

  it('ignores a configured path that does not exist', async () => {
    const exists = vi.fn((p: string) => Promise.resolve(p === ARM_GCC_CANDIDATES[0]));
    const exec = vi.fn(() => Promise.reject(new Error()));

    const result = await detectArmToolchain('/nonexistent/bin', exists, exec);
    expect(result).toBe(ARM_GCC_CANDIDATES[0]);
  });

  it('returns the which result when found on PATH', async () => {
    const exists = vi.fn(() => Promise.resolve(true));
    const exec = vi.fn(() => Promise.resolve('/usr/bin/arm-none-eabi-gcc\n'));

    const result = await detectArmToolchain(undefined, exists, exec);
    expect(result).toBe('/usr/bin/arm-none-eabi-gcc');
    expect(exec).toHaveBeenCalledWith('which', [ARM_GCC_BINARY]);
  });

  it('skips which result when the path does not exist on disk', async () => {
    const exists = vi.fn((p: string) => Promise.resolve(p === ARM_GCC_CANDIDATES[0]));
    const exec = vi.fn(() => Promise.resolve('/ghost/arm-none-eabi-gcc\n'));

    const result = await detectArmToolchain(undefined, exists, exec);
    expect(result).toBe(ARM_GCC_CANDIDATES[0]);
  });

  it('falls back to known Homebrew path when which fails', async () => {
    const exists = vi.fn((p: string) => Promise.resolve(p === ARM_GCC_CANDIDATES[0]));
    const exec = vi.fn(() => Promise.reject(new Error('not found')));

    const result = await detectArmToolchain(undefined, exists, exec);
    expect(result).toBe(ARM_GCC_CANDIDATES[0]);
  });

  it('falls back to second candidate when first is absent', async () => {
    const exists = vi.fn((p: string) => Promise.resolve(p === ARM_GCC_CANDIDATES[1]));
    const exec = vi.fn(() => Promise.reject(new Error()));

    const result = await detectArmToolchain(undefined, exists, exec);
    expect(result).toBe(ARM_GCC_CANDIDATES[1]);
  });

  it('returns undefined when no candidate exists', async () => {
    const exists = vi.fn(() => Promise.resolve(false));
    const exec = vi.fn(() => Promise.reject(new Error()));

    const result = await detectArmToolchain(undefined, exists, exec);
    expect(result).toBeUndefined();
  });
});

// ── detectDfuUtil ─────────────────────────────────────────────────────────────

describe('detectDfuUtil()', () => {
  it('returns the which result when dfu-util is on PATH', async () => {
    const exists = vi.fn(() => Promise.resolve(true));
    const exec = vi.fn(() => Promise.resolve('/usr/bin/dfu-util\n'));

    const result = await detectDfuUtil(exists, exec);
    expect(result).toBe('/usr/bin/dfu-util');
  });

  it('falls back to Homebrew candidate when which fails', async () => {
    const exists = vi.fn((p: string) => Promise.resolve(p === DFU_UTIL_CANDIDATES[0]));
    const exec = vi.fn(() => Promise.reject(new Error()));

    const result = await detectDfuUtil(exists, exec);
    expect(result).toBe(DFU_UTIL_CANDIDATES[0]);
  });

  it('returns undefined when dfu-util is not found anywhere', async () => {
    const exists = vi.fn(() => Promise.resolve(false));
    const exec = vi.fn(() => Promise.reject(new Error()));

    const result = await detectDfuUtil(exists, exec);
    expect(result).toBeUndefined();
  });

  it('skips which result when the path does not exist on disk', async () => {
    const exists = vi.fn((p: string) => Promise.resolve(p === DFU_UTIL_CANDIDATES[0]));
    const exec = vi.fn(() => Promise.resolve('/ghost/dfu-util\n'));

    const result = await detectDfuUtil(exists, exec);
    expect(result).toBe(DFU_UTIL_CANDIDATES[0]);
  });
});

// ── detectCMake (FR-REL-2) ────────────────────────────────────────────────────

describe('detectCMake()', () => {
  it('returns the which result when cmake is on PATH (PATH wins over known locations)', async () => {
    const exists = vi.fn(() => Promise.resolve(true));
    const exec = vi.fn(() => Promise.resolve('/custom/bin/cmake\n'));

    expect(await detectCMake(exists, exec)).toBe('/custom/bin/cmake');
  });

  it('falls back to the Homebrew location when which fails', async () => {
    const exists = vi.fn((p: string) => Promise.resolve(p === CMAKE_CANDIDATES[0]));
    const exec = vi.fn(() => Promise.reject(new Error()));

    expect(await detectCMake(exists, exec)).toBe('/opt/homebrew/bin/cmake');
  });

  it('falls back to /usr/local/bin when only that exists', async () => {
    const exists = vi.fn((p: string) => Promise.resolve(p === '/usr/local/bin/cmake'));
    const exec = vi.fn(() => Promise.reject(new Error()));

    expect(await detectCMake(exists, exec)).toBe('/usr/local/bin/cmake');
  });

  it('ignores a which result that does not exist on disk and keeps looking', async () => {
    const exists = vi.fn((p: string) => Promise.resolve(p === CMAKE_CANDIDATES[0]));
    const exec = vi.fn(() => Promise.resolve('/stale/cmake\n'));

    expect(await detectCMake(exists, exec)).toBe(CMAKE_CANDIDATES[0]);
  });

  it('returns undefined when cmake is not found anywhere', async () => {
    const exists = vi.fn(() => Promise.resolve(false));
    const exec = vi.fn(() => Promise.reject(new Error()));

    expect(await detectCMake(exists, exec)).toBeUndefined();
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
    expect(await detectCxxCompiler(exists, exec)).toBe(`${CLT}/usr/bin/clang++`);
  });

  it('is not fooled by the /usr/bin/clang++ stub that exists without the Command Line Tools', async () => {
    const exec = vi.fn(() => Promise.reject(new Error('xcode-select: error: no developer tools were found')));
    const exists = vi.fn((p: string) => Promise.resolve(p === '/usr/bin/clang++'));
    expect(await detectCxxCompiler(exists, exec)).toBeUndefined();
  });

  it('falls back to the known Command Line Tools location when xcode-select cannot be run', async () => {
    const exec = vi.fn(() => Promise.reject(new Error()));
    const exists = vi.fn((p: string) => Promise.resolve(p === `${CLT}/usr/bin/clang++`));
    expect(await detectCxxCompiler(exists, exec)).toBe(`${CLT}/usr/bin/clang++`);
  });

  it('returns undefined when no compiler is found anywhere', async () => {
    const exec = vi.fn(() => Promise.reject(new Error()));
    const exists = vi.fn(() => Promise.resolve(false));
    expect(await detectCxxCompiler(exists, exec)).toBeUndefined();
  });

  it('has not-found messages that name xcode-select --install', () => {
    expect(CXX_COMPILER_NOT_FOUND_MESSAGE).toBe(
      'Xcode Command Line Tools not found. Run `xcode-select --install` and try again.');
    expect(LLDB_DAP_NOT_FOUND_MESSAGE).toMatch(/lldb-dap not found.*xcode-select --install/);
  });
});
