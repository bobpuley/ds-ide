import { describe, it, expect } from 'vitest';
import {
  TIME_BASES_MS, DEFAULT_TIME_BASE_MS, DIVISIONS,
  windowSamples, pointsPerDivision, isLowResolution, visibleRange, timeTicks, amplitudeTicks,
  GAIN_STEPS, autoGain, peakAbs, samplePosition,
} from '../../../webview/scope/scope-view';

describe('time base (FR-SCI-4)', () => {
  it('offers 0.5 / 1 / 2 / 5 / 10 ms per division, defaulting to 2', () => {
    expect([...TIME_BASES_MS]).toEqual([0.5, 1, 2, 5, 10]);
    expect(DEFAULT_TIME_BASE_MS).toBe(2);
    expect(DIVISIONS).toBe(10);
  });

  it('windowSamples covers ten divisions at the effective rate', () => {
    expect(windowSamples(2, 12000)).toBe(240);   // 20 ms at 12 kHz
    expect(windowSamples(10, 12000)).toBe(1200); // 100 ms
    expect(windowSamples(0.5, 12000)).toBe(60);
  });

  it('windowSamples is 0 while the rate is unknown', () => {
    expect(windowSamples(2, 0)).toBe(0);
  });

  it('pointsPerDivision is ms per division times the rate', () => {
    expect(pointsPerDivision(2, 12000)).toBe(24);
    expect(pointsPerDivision(0.5, 12000)).toBe(6);
  });

  it('flags a time base with fewer than 20 points per division', () => {
    expect(isLowResolution(0.5, 12000)).toBe(true);   // 6 points
    expect(isLowResolution(1, 12000)).toBe(true);     // 12 points
    expect(isLowResolution(2, 12000)).toBe(false);    // 24 points
    expect(isLowResolution(0.5, 48000)).toBe(false);  // 24 points at full rate
  });

  it('does not flag anything while the rate is unknown', () => {
    expect(isLowResolution(0.5, 0)).toBe(false);
  });
});

describe('visibleRange (FR-SCI-4)', () => {
  it('shows the most recent window', () => {
    expect(visibleRange(1000, 240)).toEqual({ start: 760, count: 240 });
  });
  it('shows everything that exists when the capture is shorter than the window', () => {
    expect(visibleRange(100, 240)).toEqual({ start: 0, count: 100 });
  });
  it('shows nothing for an empty capture', () => {
    expect(visibleRange(0, 240)).toEqual({ start: 0, count: 0 });
  });
});

describe('axis ticks (FR-SCI-4)', () => {
  it('labels the time axis every two divisions in ms', () => {
    expect(timeTicks(2)).toEqual([
      { div: 0, label: '0' }, { div: 2, label: '4' }, { div: 4, label: '8' },
      { div: 6, label: '12' }, { div: 8, label: '16' }, { div: 10, label: '20' },
    ]);
  });
  it('keeps one decimal for fractional ms', () => {
    expect(timeTicks(0.5).map(t => t.label)).toEqual(['0', '1', '2', '3', '4', '5']);
    expect(timeTicks(0.5).at(1)).toEqual({ div: 2, label: '1' });
    expect(timeTicks(0.25).map(t => t.label)).toEqual(['0', '0.5', '1', '1.5', '2', '2.5']);
  });
  it('labels the amplitude axis from +1 to -1', () => {
    expect(amplitudeTicks(1, 'lin')).toEqual([
      { pos: 1, label: '+1.0' }, { pos: 0.5, label: '+0.5' }, { pos: 0, label: '0' },
      { pos: -0.5, label: '-0.5' }, { pos: -1, label: '-1.0' },
    ]);
  });
});

describe('gain (FR-SCI-5)', () => {
  it('offers x1 / x2 / x4 plus Auto', () => {
    expect([...GAIN_STEPS]).toEqual([1, 2, 4]);
  });

  it('autoGain fits the peak in 90% of the plot, never below x1 and capped at x64', () => {
    expect(autoGain(0.9)).toBeCloseTo(1, 5);
    expect(autoGain(0.45)).toBeCloseTo(2, 5);
    expect(autoGain(0.01)).toBeCloseTo(64, 5);   // -40 dBFS would want x90 -> capped
    expect(autoGain(1.5)).toBe(1);               // clipping signal: never attenuate
    expect(autoGain(0)).toBe(1);                 // silence
  });

  it('peakAbs scans a range of samples', () => {
    expect(peakAbs([0.1, -0.7, 0.3, 0.2], 1, 2)).toBe(0.7);
    expect(peakAbs([], 0, 0)).toBe(0);
  });
});

describe('amplitude mapping (FR-SCI-5)', () => {
  it('linear: position is the sample times the gain', () => {
    expect(samplePosition(0.25, 1, 'lin')).toBeCloseTo(0.25, 6);
    expect(samplePosition(0.25, 4, 'lin')).toBeCloseTo(1, 6);
    expect(samplePosition(-0.1, 2, 'lin')).toBeCloseTo(-0.2, 6);
  });

  it('dBFS: full scale reaches the edge, -60 dB sits on the centre line, sign is kept', () => {
    expect(samplePosition(1, 1, 'db')).toBeCloseTo(1, 6);
    expect(samplePosition(-1, 1, 'db')).toBeCloseTo(-1, 6);
    expect(samplePosition(0.001, 1, 'db')).toBeCloseTo(0, 6);
    expect(samplePosition(0, 1, 'db')).toBe(0);
    expect(samplePosition(0.1, 1, 'db')).toBeCloseTo(2 / 3, 6); // -20 dB
  });

  it('keeps positions within a bounded overshoot so an overdriven trace cannot run away', () => {
    expect(samplePosition(1, 64, 'lin')).toBeLessThanOrEqual(2);
    expect(samplePosition(1, 64, 'db')).toBeLessThanOrEqual(2);
  });

  it('linear ticks show the amplitude each line represents at the current gain', () => {
    expect(amplitudeTicks(4, 'lin').map(t => t.label)).toEqual(['+0.25', '+0.13', '0', '-0.13', '-0.25']);
  });

  it('dBFS ticks are labelled in dB of the signal, shifted by the gain', () => {
    const ticks = amplitudeTicks(1, 'db');
    expect(ticks.filter(t => t.label).map(t => t.label)).toEqual(['0 dB', '-6 dB', '-20 dB', '-40 dB']);
    expect(ticks.filter(t => t.label).map(t => t.pos)).toEqual([1, 54 / 60, 40 / 60, 20 / 60]);
    // x4 is +12 dB of display gain, so the top line represents -12 dBFS of signal
    expect(amplitudeTicks(4, 'db').filter(t => t.label)[0]?.label).toBe('-12 dB');
  });
});
