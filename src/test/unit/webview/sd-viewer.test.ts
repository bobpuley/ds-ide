import { describe, it, expect } from 'vitest';
import { isTxtEntryName, formatSdSize, sortSdEntries, sdListingsEqual, sdStalePreviews, SD_PREVIEW_MAX_BYTES } from '../../../webview/sd-viewer';

describe('isTxtEntryName (FR-SD-1)', () => {
  it('matches a .txt extension case-insensitively', () => {
    expect(isTxtEntryName('LOG.TXT')).toBe(true);
    expect(isTxtEntryName('log.txt')).toBe(true);
  });

  it('does not match other extensions', () => {
    expect(isTxtEntryName('IR_HALL.WAV')).toBe(false);
    expect(isTxtEntryName('noext')).toBe(false);
  });
});

describe('formatSdSize (FR-SD-1)', () => {
  it('formats sub-1024-byte sizes in bytes', () => {
    expect(formatSdSize(96)).toBe('96 B');
  });

  it('formats sub-1MB sizes in KB with one decimal', () => {
    expect(formatSdSize(412)).toBe('412 B');
    expect(formatSdSize(2048)).toBe('2.0 KB');
  });

  it('formats sizes at or above 1MB in MB with one decimal', () => {
    expect(formatSdSize(1024 * 1024)).toBe('1.0 MB');
    expect(formatSdSize(1_887_436)).toBe('1.8 MB');
  });
});

describe('sortSdEntries (FR-SD-1)', () => {
  it('sorts entries by name without mutating the input', () => {
    const entries = [{ name: 'b.txt', size: 1 }, { name: 'a.txt', size: 2 }];
    const sorted = sortSdEntries(entries);
    expect(sorted.map(e => e.name)).toEqual(['a.txt', 'b.txt']);
    expect(entries.map(e => e.name)).toEqual(['b.txt', 'a.txt']);
  });
});

describe('SD_PREVIEW_MAX_BYTES (FR-SD-1)', () => {
  it('is a positive, reasonably small cap', () => {
    expect(SD_PREVIEW_MAX_BYTES).toBeGreaterThan(0);
    expect(SD_PREVIEW_MAX_BYTES).toBeLessThanOrEqual(1024 * 1024);
  });
});

describe('sdListingsEqual (FR-EXM-9)', () => {
  const a = [{ name: 'a.txt', size: 1 }, { name: 'b.wav', size: 9 }];

  it('is true for the same names and sizes', () => {
    expect(sdListingsEqual(a, [{ name: 'a.txt', size: 1 }, { name: 'b.wav', size: 9 }])).toBe(true);
  });

  it('is false when a size changed, a file was added or removed', () => {
    expect(sdListingsEqual(a, [{ name: 'a.txt', size: 2 }, { name: 'b.wav', size: 9 }])).toBe(false);
    expect(sdListingsEqual(a, [...a, { name: 'c.txt', size: 0 }])).toBe(false);
    expect(sdListingsEqual(a, [a[0]!])).toBe(false);
  });

  it('is true for two empty listings', () => {
    expect(sdListingsEqual([], [])).toBe(true);
  });
});

describe('sdStalePreviews (FR-EXM-9)', () => {
  it('names the files still listed whose size changed', () => {
    const prev = [{ name: 'a.txt', size: 1 }, { name: 'b.txt', size: 5 }];
    const next = [{ name: 'a.txt', size: 40 }, { name: 'b.txt', size: 5 }];
    expect(sdStalePreviews(prev, next)).toEqual(['a.txt']);
  });

  it('ignores new files and removed files', () => {
    const prev = [{ name: 'gone.txt', size: 1 }];
    const next = [{ name: 'new.txt', size: 1 }];
    expect(sdStalePreviews(prev, next)).toEqual([]);
  });

  it('returns nothing when no size changed', () => {
    const l = [{ name: 'a.txt', size: 3 }];
    expect(sdStalePreviews(l, l)).toEqual([]);
  });
});
