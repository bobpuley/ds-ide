import { describe, it, expect } from 'vitest';
import { readDataIsland } from '../../../webview/data-island';

interface Pair { a: number; b: string }
const isPair = (v: unknown): v is Pair =>
  typeof v === 'object' && v !== null &&
  typeof (v as Record<string, unknown>)['a'] === 'number' &&
  typeof (v as Record<string, unknown>)['b'] === 'string';

describe('readDataIsland (FR-EXT-28)', () => {
  it('returns the parsed value with no error when JSON is well-formed and matches the shape', () => {
    const result = readDataIsland('{"a":1,"b":"x"}', isPair, { a: 0, b: '' });
    expect(result).toEqual({ value: { a: 1, b: 'x' }, error: null });
  });

  it('falls back and reports an error on malformed JSON instead of throwing', () => {
    const result = readDataIsland('{not json', isPair, { a: 0, b: '' });
    expect(result.value).toEqual({ a: 0, b: '' });
    expect(result.error).toMatch(/malformed JSON/);
  });

  it('falls back and reports an error when the parsed value does not match the shape', () => {
    const result = readDataIsland('{"a":"not a number"}', isPair, { a: 0, b: '' });
    expect(result.value).toEqual({ a: 0, b: '' });
    expect(result.error).toMatch(/unexpected shape/);
  });

  it('falls back and reports an error on a well-formed but wrong top-level type', () => {
    const result = readDataIsland('[1,2,3]', isPair, { a: 0, b: '' });
    expect(result.error).toMatch(/unexpected shape/);
  });
});
