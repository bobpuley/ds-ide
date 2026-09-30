import { describe, it, expect } from 'vitest';
import { Meters, measure, toDb, formatDb, meterPosition, CLIP_LEVEL } from '../../../webview/scope/scope-meters';

describe('measure (FR-SCI-8)', () => {
  it('returns peak and RMS of a block', () => {
    const m = measure([0.5, -0.5, 0.5, -0.5]);
    expect(m.peak).toBe(0.5);
    expect(m.rms).toBeCloseTo(0.5, 6);
  });
  it('returns zeros for an empty block', () => {
    expect(measure([])).toEqual({ peak: 0, rms: 0 });
  });
  it('takes the peak from the loudest sample regardless of sign', () => {
    expect(measure([0.1, -0.9, 0.3]).peak).toBe(0.9);
  });
});

describe('dB helpers (FR-SCI-8)', () => {
  it('converts linear to dBFS', () => {
    expect(toDb(1)).toBeCloseTo(0, 6);
    expect(toDb(0.5)).toBeCloseTo(-6.0206, 3);
    expect(toDb(0)).toBe(-Infinity);
  });
  it('formats silence as minus infinity and everything else to one decimal', () => {
    expect(formatDb(-Infinity)).toBe('−∞');
    expect(formatDb(-6.0206)).toBe('-6.0');
    expect(formatDb(0)).toBe('0.0');
  });
  it('maps dB onto a -60..0 bar', () => {
    expect(meterPosition(0)).toBe(1);
    expect(meterPosition(-30)).toBe(0.5);
    expect(meterPosition(-60)).toBe(0);
    expect(meterPosition(-90)).toBe(0);
    expect(meterPosition(6)).toBe(1);
    expect(meterPosition(-Infinity)).toBe(0);
  });
});

describe('Meters (FR-SCI-8)', () => {
  it('reports peak and RMS of the latest block per channel', () => {
    const m = new Meters();
    m.update('in', [0.5, -0.5]);
    m.update('l', [0.25, 0.25]);
    expect(m.state('in').peakDb).toBeCloseTo(-6.02, 1);
    expect(m.state('l').peakDb).toBeCloseTo(-12.04, 1);
    expect(m.state('r').peakDb).toBe(-Infinity);
  });

  it('holds the highest peak until reset', () => {
    const m = new Meters();
    m.update('in', [0.9]);
    m.update('in', [0.1]);
    expect(m.state('in').holdDb).toBeCloseTo(toDb(0.9), 6);
    expect(m.state('in').peakDb).toBeCloseTo(toDb(0.1), 6);
    m.resetPeaks();
    expect(m.state('in').holdDb).toBe(-Infinity);
  });

  it('latches CLIP on a full-scale sample, for that channel only', () => {
    const m = new Meters();
    m.update('l', [0.2, -CLIP_LEVEL, 0.1]);
    m.update('l', [0.1]);            // stays latched after the signal recovers
    expect(m.state('l').clipped).toBe(true);
    expect(m.state('in').clipped).toBe(false);
    expect(m.state('r').clipped).toBe(false);
  });

  it('does not latch below the clip level', () => {
    const m = new Meters();
    m.update('in', [0.998]);
    expect(m.state('in').clipped).toBe(false);
  });

  it('clearClip clears one channel, resetPeaks clears the holds and every clip', () => {
    const m = new Meters();
    m.update('in', [1]); m.update('l', [1]);
    m.clearClip('in');
    expect(m.state('in').clipped).toBe(false);
    expect(m.state('l').clipped).toBe(true);
    m.resetPeaks();
    expect(m.state('l').clipped).toBe(false);
  });

  it('headroom is the distance of the worst current peak from 0 dBFS', () => {
    const m = new Meters();
    expect(m.headroomDb()).toBeNull();               // silence: nothing to report
    m.update('in', [0.5]);
    m.update('l', [0.25]);
    expect(m.headroomDb()).toBeCloseTo(6.02, 1);
    m.update('l', [1]);
    expect(m.headroomDb()).toBeCloseTo(0, 6);
  });

  it('ignores an empty block without disturbing the reading', () => {
    const m = new Meters();
    m.update('in', [0.5]);
    m.update('in', []);
    expect(m.state('in').peakDb).toBeCloseTo(toDb(0.5), 6);
  });
});
