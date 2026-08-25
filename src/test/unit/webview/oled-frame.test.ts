import { describe, it, expect } from 'vitest';
import { decodeOledFrame, computeFrameRate } from '../../../webview/oled-frame';

describe('decodeOledFrame (FR-DEV-15)', () => {
  it('decodes a base64 payload back to its original bytes', () => {
    const original = new Uint8Array([0x00, 0xff, 0x10, 0x81, 0x7f]);
    const base64 = btoa(String.fromCharCode(...original));
    expect(Array.from(decodeOledFrame(base64) ?? [])).toEqual(Array.from(original));
  });

  it('decodes a full 1024-byte SSD1306 frame without truncation', () => {
    const original = new Uint8Array(1024);
    for (let i = 0; i < original.length; i++) original[i] = i % 256;
    let binary = '';
    for (const b of original) binary += String.fromCharCode(b);
    const base64 = btoa(binary);
    const decoded = decodeOledFrame(base64);
    expect(decoded?.length).toBe(1024);
    expect(Array.from(decoded ?? [])).toEqual(Array.from(original));
  });

  it('decodes an empty payload to an empty array', () => {
    expect(decodeOledFrame('')?.length).toBe(0);
  });

  it('returns null instead of throwing on malformed base64 (FR-EXT-17)', () => {
    expect(() => decodeOledFrame('not-valid-base64!!!')).not.toThrow();
    expect(decodeOledFrame('not-valid-base64!!!')).toBeNull();
  });
});

describe('computeFrameRate (FR-DEV-15)', () => {
  it('returns 0 for fewer than two timestamps', () => {
    expect(computeFrameRate([])).toBe(0);
    expect(computeFrameRate([1000])).toBe(0);
  });

  it('computes fps from evenly-spaced timestamps within the window', () => {
    // 10 frames spaced 100ms apart = 10 fps over the 900ms span they cover.
    const timestamps = Array.from({ length: 10 }, (_, i) => i * 100);
    expect(computeFrameRate(timestamps, 1000)).toBeCloseTo(10, 1);
  });

  it('only counts timestamps within the trailing window', () => {
    // Old frames far outside the 1000ms window must not count toward the
    // rate: recent = 5 frames spanning 400ms = 10 fps. If the stale frames
    // leaked in, the computed span (and thus rate) would be very different.
    const old = [0, 50, 100];
    const recent = [10000, 10100, 10200, 10300, 10400];
    expect(computeFrameRate([...old, ...recent], 1000)).toBeCloseTo(10, 0);
  });

  it('returns 0 when the window contains fewer than two timestamps', () => {
    expect(computeFrameRate([0, 100, 5000], 500)).toBe(0);
  });
});
