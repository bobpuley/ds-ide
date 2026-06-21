import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectEffectSrc, detectDaisySP } from '../../../commands/build';
import * as fs from 'fs';

vi.mock('fs');

describe('detectEffectSrc', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the single .cpp file at root', () => {
    vi.mocked(fs.readdirSync).mockReturnValue(['effect.cpp', 'Makefile'] as unknown as fs.Dirent[]);
    expect(detectEffectSrc('/proj')).toBe('/proj/effect.cpp');
  });

  it('returns undefined when no .cpp found', () => {
    vi.mocked(fs.readdirSync).mockReturnValue(['Makefile'] as unknown as fs.Dirent[]);
    expect(detectEffectSrc('/proj')).toBeUndefined();
  });

  it('returns undefined when multiple .cpp files present and no single non-main', () => {
    vi.mocked(fs.readdirSync).mockReturnValue(['a.cpp', 'b.cpp'] as unknown as fs.Dirent[]);
    expect(detectEffectSrc('/proj')).toBeUndefined();
  });

  it('picks non-main.cpp when exactly one other exists', () => {
    vi.mocked(fs.readdirSync).mockReturnValue(['main.cpp', 'effect.cpp'] as unknown as fs.Dirent[]);
    expect(detectEffectSrc('/proj')).toBe('/proj/effect.cpp');
  });

  it('returns undefined on fs error', () => {
    vi.mocked(fs.readdirSync).mockImplementation(() => { throw new Error('ENOENT'); });
    expect(detectEffectSrc('/proj')).toBeUndefined();
  });

  it('falls back to src/ subdirectory when no root .cpp found (AC-72)', () => {
    vi.mocked(fs.readdirSync).mockImplementation((dir) => {
      if (String(dir).endsWith('src')) return ['effect.cpp'] as unknown as fs.Dirent[];
      return [] as unknown as fs.Dirent[];
    });
    expect(detectEffectSrc('/proj')).toBe('/proj/src/effect.cpp');
  });

  it('falls back to source/ subdirectory when no root or src .cpp found (AC-72)', () => {
    vi.mocked(fs.readdirSync).mockImplementation((dir) => {
      if (String(dir).endsWith('source')) return ['effect.cpp'] as unknown as fs.Dirent[];
      return [] as unknown as fs.Dirent[];
    });
    expect(detectEffectSrc('/proj')).toBe('/proj/source/effect.cpp');
  });

  it('prefers root .cpp over src/ fallback (AC-72)', () => {
    vi.mocked(fs.readdirSync).mockImplementation((dir) => {
      if (String(dir) === '/proj') return ['root.cpp'] as unknown as fs.Dirent[];
      return ['src.cpp'] as unknown as fs.Dirent[];
    });
    expect(detectEffectSrc('/proj')).toBe('/proj/root.cpp');
  });
});

describe('detectDaisySP', () => {
  beforeEach(() => vi.clearAllMocks());

  it('finds DaisySP/Source at project root', () => {
    vi.mocked(fs.statSync).mockImplementation((p) => {
      if (String(p).endsWith('DaisySP/Source')) return { isDirectory: () => true } as fs.Stats;
      throw new Error('ENOENT');
    });
    expect(detectDaisySP('/proj')).toBe('/proj/DaisySP/Source');
  });

  it('returns undefined when DaisySP not found', () => {
    vi.mocked(fs.statSync).mockImplementation(() => { throw new Error('ENOENT'); });
    expect(detectDaisySP('/proj')).toBeUndefined();
  });
});
