import { describe, it, expect } from 'vitest';
import {
  GENERATORS, GENERATOR_DEFAULTS, clampParams, generatorDef, isGeneratorId, type GeneratorId,
} from '../../../webview/scope/scope-generators';

describe('scope generators (FR-GEN-2)', () => {
  it('lists the seven generators in menu order', () => {
    expect(GENERATORS.map(g => g.id)).toEqual(['sine', 'noise', 'sweep', 'impulse', 'step', 'silence', 'twotone']);
    expect(GENERATORS.map(g => g.label)).toEqual(['Sine', 'Noise', 'Log sweep', 'Impulse', 'Step', 'Silence', 'Two-tone']);
  });

  it('has the documented defaults', () => {
    expect(GENERATOR_DEFAULTS).toEqual({
      freq: 440, amp: 0.25, color: 'white', from: 20, to: 20000, time: 5, period: 500,
    });
  });

  it('gives each generator only its own parameters', () => {
    const keys = (id: GeneratorId): string[] => generatorDef(id).params.map(p => p.key);
    expect(keys('sine')).toEqual(['freq', 'amp']);
    expect(keys('noise')).toEqual(['color', 'amp']);
    expect(keys('sweep')).toEqual(['from', 'to', 'time', 'amp']);
    expect(keys('impulse')).toEqual(['amp', 'period']);
    expect(keys('step')).toEqual(['amp', 'period']);
    expect(keys('silence')).toEqual([]);
    expect(keys('twotone')).toEqual(['amp']);
  });

  it('shows a hint for Silence, Impulse, Step and Two-tone only', () => {
    const hint = (id: GeneratorId): string | undefined => generatorDef(id).hint;
    expect(hint('silence')).toMatch(/noise floor|zero/i);
    expect(hint('impulse')).toMatch(/impulse response/i);
    expect(hint('step')).toMatch(/step response|attack|release/i);
    expect(hint('twotone')).toMatch(/60 Hz.*7 kHz|intermodulation/i);
    for (const id of ['sine', 'noise', 'sweep'] as const) expect(hint(id)).toBeUndefined();
  });

  it('clamps every parameter to its range, at both edges', () => {
    const lo = clampParams({ ...GENERATOR_DEFAULTS, freq: -5, amp: -1, time: 0, period: 0 });
    expect(lo).toMatchObject({ freq: 20, amp: 0, time: 0.5, period: 10 });
    const hi = clampParams({ ...GENERATOR_DEFAULTS, freq: 1e9, amp: 7, time: 1e6, period: 1e6 });
    expect(hi).toMatchObject({ freq: 20000, amp: 1, time: 60, period: 5000 });
    const edge = clampParams({ ...GENERATOR_DEFAULTS, freq: 20, amp: 1, time: 0.5, period: 5000 });
    expect(edge).toMatchObject({ freq: 20, amp: 1, time: 0.5, period: 5000 });
  });

  it('keeps sweep To above From', () => {
    expect(clampParams({ ...GENERATOR_DEFAULTS, from: 1000, to: 500 }).to).toBeGreaterThan(1000);
    const top = clampParams({ ...GENERATOR_DEFAULTS, from: 20000, to: 20000 });
    expect(top.to).toBeGreaterThan(top.from);
    expect(top.to).toBeLessThanOrEqual(20000);
    expect(top.from).toBeGreaterThanOrEqual(20);
    const low = clampParams({ ...GENERATOR_DEFAULTS, from: 1, to: 1 });
    expect(low.from).toBe(20);
    expect(low.to).toBeGreaterThan(20);
  });

  it('replaces non-finite numbers with the default and unknown colours with white', () => {
    const p = clampParams({ ...GENERATOR_DEFAULTS, freq: NaN, amp: Infinity, color: 'blue' as never });
    expect(p.freq).toBe(440);
    expect(p.amp).toBe(1);
    expect(p.color).toBe('white');
  });

  it('isGeneratorId accepts only the seven ids', () => {
    expect(isGeneratorId('sweep')).toBe(true);
    expect(isGeneratorId('live')).toBe(false);
    expect(isGeneratorId(3)).toBe(false);
  });
});
