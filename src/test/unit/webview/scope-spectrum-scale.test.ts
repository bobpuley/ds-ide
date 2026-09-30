import { describe, it, expect } from 'vitest';
import {
  freqPosition, freqTicks, levelToDb, dbRange, dbPosition, dbTicks, MIN_LOG_HZ,
} from '../../../webview/scope/scope-spectrum-scale';

describe('frequency axis (FR-SCI-11)', () => {
  it('linear: position is frequency over the maximum', () => {
    expect(freqPosition(0, 'lin', 20000)).toBe(0);
    expect(freqPosition(10000, 'lin', 20000)).toBe(0.5);
    expect(freqPosition(20000, 'lin', 20000)).toBe(1);
  });

  it('log: 20 Hz at the left edge, 20 kHz at the right, a decade is a third of the axis', () => {
    expect(MIN_LOG_HZ).toBe(20);
    expect(freqPosition(20, 'log', 20000)).toBeCloseTo(0, 9);
    expect(freqPosition(20000, 'log', 20000)).toBeCloseTo(1, 9);
    expect(freqPosition(200, 'log', 20000)).toBeCloseTo(1 / 3, 6);
  });

  it('a 200 Hz corner is squeezed into the first 1% on Lin but not on Log', () => {
    expect(freqPosition(200, 'lin', 20000)).toBeCloseTo(0.01, 9);
    expect(freqPosition(200, 'log', 20000)).toBeGreaterThan(0.3);
  });

  it('log clamps frequencies below 20 Hz to the left edge', () => {
    expect(freqPosition(0, 'log', 20000)).toBe(0);
    expect(freqPosition(5, 'log', 20000)).toBe(0);
  });

  it('labels ticks up to the maximum frequency', () => {
    expect(freqTicks('lin', 20000).map(t => t.label)).toEqual(['0', '5k', '10k', '15k', '20k']);
    expect(freqTicks('log', 20000).map(t => t.label))
      .toEqual(['20', '50', '100', '200', '500', '1k', '2k', '5k', '10k', '20k']);
    expect(freqTicks('log', 8000).map(t => t.label)).toEqual(['20', '50', '100', '200', '500', '1k', '2k', '5k']);
  });
});

describe('level axis (FR-SCI-11)', () => {
  it('absolute: a full-scale sine reads 0 dBFS (corrects the Hann window gain)', () => {
    // The emulator's Hann-windowed FFT reports a full-scale sine as 0.5.
    expect(levelToDb(0.5, 'abs', 1)).toBeCloseTo(0, 6);
  });

  it('absolute: halving the input lowers the trace by 6 dB and does not rescale', () => {
    const full = levelToDb(0.5, 'abs', 0.5);
    const half = levelToDb(0.25, 'abs', 0.25);   // the running peak halved too
    expect(full - half).toBeCloseTo(6.02, 1);
  });

  it('relative: the running peak is 0 dB', () => {
    expect(levelToDb(0.2, 'rel', 0.2)).toBeCloseTo(0, 6);
    expect(levelToDb(0.1, 'rel', 0.2)).toBeCloseTo(-6.02, 1);
  });

  it('silence is minus infinity', () => {
    expect(levelToDb(0, 'abs', 1)).toBe(-Infinity);
  });

  it('ranges: 90 dB absolute, 60 dB relative', () => {
    expect(dbRange('abs')).toBe(90);
    expect(dbRange('rel')).toBe(60);
  });

  it('dbPosition: 0 dB at the top (0), the floor at the bottom (1), silence below it', () => {
    expect(dbPosition(0, 90)).toBe(0);
    expect(dbPosition(-45, 90)).toBe(0.5);
    expect(dbPosition(-90, 90)).toBe(1);
    expect(dbPosition(-200, 90)).toBe(1);
    expect(dbPosition(-Infinity, 90)).toBe(1);
    expect(dbPosition(6, 90)).toBe(0);
  });

  it('dbTicks every 20 dB down to the range', () => {
    expect(dbTicks(90)).toEqual([0, -20, -40, -60, -80]);
    expect(dbTicks(60)).toEqual([0, -20, -40, -60]);
  });
});
