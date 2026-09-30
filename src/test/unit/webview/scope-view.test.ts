import { describe, it, expect } from 'vitest';
import {
  TIME_BASES_MS, DEFAULT_TIME_BASE_MS, DIVISIONS,
  windowSamples, pointsPerDivision, isLowResolution, visibleRange, timeTicks, amplitudeTicks,
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
    expect(amplitudeTicks()).toEqual([
      { value: 1, label: '+1.0' }, { value: 0.5, label: '+0.5' }, { value: 0, label: '0' },
      { value: -0.5, label: '-0.5' }, { value: -1, label: '-1.0' },
    ]);
  });
});
