import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findEffectSource } from '../../../commands/find-effect-source';
import { detectDaisySP } from '../../../commands/build';
import * as fs from 'fs';

vi.mock('fs', () => ({
  promises: {
    readdir: vi.fn(),
    stat: vi.fn(),
    access: vi.fn(),
  },
}));

describe('findEffectSource', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the single .cpp file at root', async () => {
    vi.mocked(fs.promises.readdir).mockResolvedValue(['effect.cpp', 'Makefile'] as never);
    expect(await findEffectSource('/proj')).toBe('/proj/effect.cpp');
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
    expect(await findEffectSource('/proj')).toBe('/proj/effect.cpp');
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
    expect(await findEffectSource('/proj')).toBe('/proj/src/effect.cpp');
  });

  it('falls back to source/ subdirectory when no root or src .cpp found (AC-72)', async () => {
    vi.mocked(fs.promises.readdir).mockImplementation((dir) => {
      if (String(dir).endsWith('source')) return Promise.resolve(['effect.cpp'] as never);
      return Promise.resolve([] as never);
    });
    expect(await findEffectSource('/proj')).toBe('/proj/source/effect.cpp');
  });

  it('prefers root .cpp over src/ fallback (AC-72)', async () => {
    vi.mocked(fs.promises.readdir).mockImplementation((dir) => {
      if (String(dir) === '/proj') return Promise.resolve(['root.cpp'] as never);
      return Promise.resolve(['src.cpp'] as never);
    });
    expect(await findEffectSource('/proj')).toBe('/proj/root.cpp');
  });
});

describe('detectDaisySP', () => {
  beforeEach(() => vi.clearAllMocks());

  it('finds DaisySP/Source at project root', async () => {
    vi.mocked(fs.promises.stat).mockImplementation((p) => {
      if (String(p).endsWith('DaisySP/Source')) return Promise.resolve({ isDirectory: () => true } as fs.Stats);
      return Promise.reject(new Error('ENOENT'));
    });
    expect(await detectDaisySP('/proj')).toBe('/proj/DaisySP/Source');
  });

  it('returns undefined when DaisySP not found', async () => {
    vi.mocked(fs.promises.stat).mockRejectedValue(new Error('ENOENT'));
    expect(await detectDaisySP('/proj')).toBeUndefined();
  });
});
