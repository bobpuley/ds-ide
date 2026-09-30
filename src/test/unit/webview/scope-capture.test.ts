import { describe, it, expect } from 'vitest';
import { ScopeCapture, deriveStep } from '../../../webview/scope/scope-capture';

const ramp = (from: number, n: number): number[] => Array.from({ length: n }, (_, i) => from + i);

describe('deriveStep (FR-SCI-3)', () => {
  it('uses the base decimation up to a 256-frame block and scales above it', () => {
    expect(deriveStep(4)).toBe(4);
    expect(deriveStep(256)).toBe(4);
    expect(deriveStep(512)).toBe(8);
    expect(deriveStep(1024)).toBe(16);
  });
  it('falls back to the base decimation for an unknown block size', () => {
    expect(deriveStep(0)).toBe(4);
  });
});

describe('ScopeCapture (FR-SCI-3)', () => {
  it('stitches consecutive snapshots into one contiguous capture', () => {
    const cap = new ScopeCapture();
    cap.setConfig(48000, 256);
    cap.push({ in: [1, 2], out: [3, 4], outR: [5, 6], step: 4 });
    cap.push({ in: [7, 8], out: [9, 10], outR: [11, 12], step: 4 });
    expect(cap.channel('in')).toEqual([1, 2, 7, 8]);
    expect(cap.channel('l')).toEqual([3, 4, 9, 10]);
    expect(cap.channel('r')).toEqual([5, 6, 11, 12]);
    expect(cap.length).toBe(4);
  });

  it('reports the effective sample rate from the step carried by the snapshot', () => {
    const cap = new ScopeCapture();
    cap.setConfig(48000, 256);
    cap.push({ in: [0], out: [0], step: 4 });
    expect(cap.effectiveRate).toBe(12000);
  });

  it('derives the step from the block size when the snapshot carries none', () => {
    const cap = new ScopeCapture();
    cap.setConfig(48000, 512);
    cap.push({ in: [0], out: [0] });
    expect(cap.effectiveRate).toBe(6000);
  });

  it('leaves the right channel empty when the emulator does not send out_r', () => {
    const cap = new ScopeCapture();
    cap.setConfig(48000, 256);
    cap.push({ in: [1], out: [2] });
    expect(cap.channel('r')).toEqual([]);
  });

  it('drops the oldest samples once the ring is full', () => {
    const cap = new ScopeCapture(100); // 100 ms
    cap.setConfig(48000, 256);         // 12 kHz effective -> 1200 samples
    cap.push({ in: ramp(0, 1000), out: ramp(0, 1000), step: 4 });
    cap.push({ in: ramp(1000, 1000), out: ramp(1000, 1000), step: 4 });
    expect(cap.length).toBe(1200);
    expect(cap.channel('in')[0]).toBe(800);
    expect(cap.channel('in')[1199]).toBe(1999);
  });

  it('still holds a full snapshot when one is longer than the window', () => {
    const cap = new ScopeCapture(10);  // 10 ms -> only 120 samples at 12 kHz
    cap.setConfig(48000, 256);
    cap.push({ in: ramp(0, 2112), out: ramp(0, 2112), step: 4 });
    expect(cap.length).toBe(2112);
  });

  it('keeps at least 100 ms for a 4-frame block, where one snapshot spans only 2.75 ms', () => {
    const cap = new ScopeCapture();
    cap.setConfig(48000, 4);           // step 4 -> 12 kHz effective
    for (let i = 0; i < 100; i++) cap.push({ in: ramp(i * 33, 33), out: ramp(i * 33, 33), step: 4 });
    expect(cap.length).toBeGreaterThanOrEqual(1200); // >= 100 ms at 12 kHz
  });

  it('clears when the sample rate or block size changes', () => {
    const cap = new ScopeCapture();
    expect(cap.setConfig(48000, 256)).toBe(true);
    cap.push({ in: [1], out: [1], step: 4 });
    expect(cap.setConfig(48000, 256)).toBe(false);
    expect(cap.length).toBe(1);
    expect(cap.setConfig(44100, 256)).toBe(true);
    expect(cap.length).toBe(0);
    cap.push({ in: [1], out: [1], step: 4 });
    expect(cap.setConfig(44100, 128)).toBe(true);
    expect(cap.length).toBe(0);
  });

  it('clears when the decimation step changes mid-stream', () => {
    const cap = new ScopeCapture();
    cap.setConfig(48000, 256);
    cap.push({ in: [1, 2], out: [1, 2], step: 4 });
    cap.push({ in: [3], out: [3], step: 8 });
    expect(cap.channel('in')).toEqual([3]);
    expect(cap.effectiveRate).toBe(6000);
  });

  it('clear() empties every channel', () => {
    const cap = new ScopeCapture();
    cap.setConfig(48000, 256);
    cap.push({ in: [1], out: [2], outR: [3], step: 4 });
    cap.clear();
    expect(cap.length).toBe(0);
    expect(cap.channel('r')).toEqual([]);
  });
});
