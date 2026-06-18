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
  it('returns the configured path when it points directly to the binary', () => {
    const existsSync = vi.fn((p: string) => p === '/custom/bin/arm-none-eabi-gcc');
    const execSync = vi.fn(() => { throw new Error(); });

    const result = detectArmToolchain('/custom/bin/arm-none-eabi-gcc', existsSync, execSync);
    expect(result).toBe('/custom/bin/arm-none-eabi-gcc');
  });

  it('appends binary name when configured path is a bin directory', () => {
    const existsSync = vi.fn((p: string) => p === '/custom/bin/arm-none-eabi-gcc');
    const execSync = vi.fn(() => { throw new Error(); });

    const result = detectArmToolchain('/custom/bin', existsSync, execSync);
    expect(result).toBe('/custom/bin/arm-none-eabi-gcc');
  });

  it('appends binary name even when configured directory has trailing slash', () => {
    const existsSync = vi.fn((p: string) => p === '/custom/bin/arm-none-eabi-gcc');
    const execSync = vi.fn(() => { throw new Error(); });

    const result = detectArmToolchain('/custom/bin/', existsSync, execSync);
    expect(result).toBe('/custom/bin/arm-none-eabi-gcc');
  });

  it('ignores a configured path that does not exist', () => {
    const existsSync = vi.fn((p: string) => p === ARM_GCC_CANDIDATES[0]);
    const execSync = vi.fn(() => { throw new Error(); });

    const result = detectArmToolchain('/nonexistent/bin', existsSync, execSync);
    expect(result).toBe(ARM_GCC_CANDIDATES[0]);
  });

  it('returns the which result when found on PATH', () => {
    const existsSync = vi.fn(() => true);
    const execSync = vi.fn(() => Buffer.from('/usr/bin/arm-none-eabi-gcc\n'));

    const result = detectArmToolchain(undefined, existsSync, execSync);
    expect(result).toBe('/usr/bin/arm-none-eabi-gcc');
    expect(execSync).toHaveBeenCalledWith(`which ${ARM_GCC_BINARY} 2>/dev/null`);
  });

  it('skips which result when the path does not exist on disk', () => {
    const existsSync = vi.fn((p: string) => p === ARM_GCC_CANDIDATES[0]);
    const execSync = vi.fn(() => Buffer.from('/ghost/arm-none-eabi-gcc\n'));

    const result = detectArmToolchain(undefined, existsSync, execSync);
    expect(result).toBe(ARM_GCC_CANDIDATES[0]);
  });

  it('falls back to known Homebrew path when which fails', () => {
    const existsSync = vi.fn((p: string) => p === ARM_GCC_CANDIDATES[0]);
    const execSync = vi.fn(() => { throw new Error('not found'); });

    const result = detectArmToolchain(undefined, existsSync, execSync);
    expect(result).toBe(ARM_GCC_CANDIDATES[0]);
  });

  it('falls back to second candidate when first is absent', () => {
    const existsSync = vi.fn((p: string) => p === ARM_GCC_CANDIDATES[1]);
    const execSync = vi.fn(() => { throw new Error(); });

    const result = detectArmToolchain(undefined, existsSync, execSync);
    expect(result).toBe(ARM_GCC_CANDIDATES[1]);
  });

  it('returns undefined when no candidate exists', () => {
    const existsSync = vi.fn(() => false);
    const execSync = vi.fn(() => { throw new Error(); });

    const result = detectArmToolchain(undefined, existsSync, execSync);
    expect(result).toBeUndefined();
  });
});

// ── detectDfuUtil ─────────────────────────────────────────────────────────────

describe('detectDfuUtil()', () => {
  it('returns the which result when dfu-util is on PATH', () => {
    const existsSync = vi.fn(() => true);
    const execSync = vi.fn(() => Buffer.from('/usr/bin/dfu-util\n'));

    const result = detectDfuUtil(existsSync, execSync);
    expect(result).toBe('/usr/bin/dfu-util');
  });

  it('falls back to Homebrew candidate when which fails', () => {
    const existsSync = vi.fn((p: string) => p === DFU_UTIL_CANDIDATES[0]);
    const execSync = vi.fn(() => { throw new Error(); });

    const result = detectDfuUtil(existsSync, execSync);
    expect(result).toBe(DFU_UTIL_CANDIDATES[0]);
  });

  it('returns undefined when dfu-util is not found anywhere', () => {
    const existsSync = vi.fn(() => false);
    const execSync = vi.fn(() => { throw new Error(); });

    const result = detectDfuUtil(existsSync, execSync);
    expect(result).toBeUndefined();
  });

  it('skips which result when the path does not exist on disk', () => {
    const existsSync = vi.fn((p: string) => p === DFU_UTIL_CANDIDATES[0]);
    const execSync = vi.fn(() => Buffer.from('/ghost/dfu-util\n'));

    const result = detectDfuUtil(existsSync, execSync);
    expect(result).toBe(DFU_UTIL_CANDIDATES[0]);
  });
});
