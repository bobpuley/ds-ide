import { describe, it, expect } from 'vitest';
import { triggerStart } from '../../../webview/scope/scope-trigger';

// One period of a square-ish ramp: -1, -0.5, 0, 0.5, 1, 0.5, 0, -0.5 (8 samples)
const period = [-1, -0.5, 0, 0.5, 1, 0.5, 0, -0.5];
const wave = (periods: number): number[] => Array.from({ length: periods * 8 }, (_, i) => period[i % 8]!);

describe('triggerStart (FR-SCI-9)', () => {
  it('free run shows the newest window and is not locked', () => {
    expect(triggerStart(wave(4), 10, 'free', 0)).toEqual({ start: 22, locked: false });
  });

  it('free run shows everything when the capture is shorter than the window', () => {
    expect(triggerStart([1, 2, 3], 10, 'free', 0)).toEqual({ start: 0, locked: false });
  });

  it('rising: starts on the first sample at or above the level after one below it', () => {
    // Level 0: rising crossing is at index 2 of each period (-0.5 -> 0).
    const r = triggerStart(wave(4), 8, 'rise', 0);
    expect(r?.locked).toBe(true);
    expect(r && r.start % 8).toBe(2);
  });

  it('falling: starts on the first sample at or below the level after one above it', () => {
    // Level 0: falling crossing is at index 6 of each period (0.5 -> 0).
    const r = triggerStart(wave(4), 8, 'fall', 0);
    expect(r?.locked).toBe(true);
    expect(r && r.start % 8).toBe(6);
  });

  it('takes the latest crossing that still leaves a full window', () => {
    // 4 periods = 32 samples, window 8 -> last usable start is 24; latest rising crossing <= 24 is 18.
    expect(triggerStart(wave(4), 8, 'rise', 0)?.start).toBe(18);
  });

  it('gives the same phase every time, so a periodic wave stands still', () => {
    const a = triggerStart(wave(4), 8, 'rise', 0)!;
    const b = triggerStart(wave(5), 8, 'rise', 0)!;
    expect(a.start % 8).toBe(b.start % 8);
  });

  it('honours the level', () => {
    // Rising through 0.25: -0.5 -> 0 doesn't cross; 0 -> 0.5 does, at index 3.
    expect(triggerStart(wave(4), 8, 'rise', 0.25)?.start).toBe(19);
  });

  it('returns null when the signal never crosses the level', () => {
    expect(triggerStart(wave(4), 8, 'rise', 2)).toBeNull();
    expect(triggerStart(wave(4), 8, 'fall', -2)).toBeNull();
    expect(triggerStart([0.5, 0.5, 0.5], 2, 'rise', 0)).toBeNull();
  });

  it('accepts a crossing exactly at the last start that leaves a full window', () => {
    // 8 samples, window 4: a crossing at index 4 leaves samples 4..7 = exactly 4.
    const s = [0, 0, 0, 0, 1, 1, 1, 1];
    expect(triggerStart(s, 4, 'rise', 0.5)).toEqual({ start: 4, locked: true });
  });

  it('uses the earliest crossing when the capture is shorter than the window', () => {
    expect(triggerStart([-1, 1, -1, 1], 10, 'rise', 0)).toEqual({ start: 1, locked: true });
  });

  it('cannot trigger on the very first sample (there is no sample before it)', () => {
    expect(triggerStart([1, 1, 1, 1], 2, 'rise', 0.5)).toBeNull();
  });

  it('returns null for an empty capture in an edge mode', () => {
    expect(triggerStart([], 10, 'rise', 0)).toBeNull();
  });
});
