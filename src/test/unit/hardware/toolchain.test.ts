import { describe, it, expect, vi } from 'vitest';
import {
  detectArmToolchain,
  detectDfuUtil,
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
