import { describe, it, expect } from 'vitest';
import { computeKnobGeometry } from '../../../webview/knob-math';

describe('computeKnobGeometry (FR-IPC-6)', () => {
  it('clamps values above 1 down to 1', () => {
    expect(computeKnobGeometry(1.5).clampedValue).toBe(1);
  });

  it('clamps values below 0 up to 0', () => {
    expect(computeKnobGeometry(-0.5).clampedValue).toBe(0);
  });

  it('passes through values already in [0, 1]', () => {
    expect(computeKnobGeometry(0.42).clampedValue).toBe(0.42);
  });

  it('hides the value arc when the value is at the very bottom of the range', () => {
    expect(computeKnobGeometry(0).valuePath).toBeNull();
  });

  it('draws a value arc once the value is far enough from zero', () => {
    expect(computeKnobGeometry(0.5).valuePath).not.toBeNull();
  });

  it('always produces a non-empty track path regardless of value', () => {
    expect(computeKnobGeometry(0).trackPath).toMatch(/^M /);
    expect(computeKnobGeometry(1).trackPath).toMatch(/^M /);
  });

  it('the track path is identical across values (track is static)', () => {
    expect(computeKnobGeometry(0.1).trackPath).toBe(computeKnobGeometry(0.9).trackPath);
  });

  it('moves the dot to a different position as value changes', () => {
    const low = computeKnobGeometry(0);
    const high = computeKnobGeometry(1);
    expect(low.dotX).not.toBeCloseTo(high.dotX, 3);
  });

  it('uses the large-arc flag once span exceeds 180 degrees (value > 2/3)', () => {
    // span = value * 270deg; > 180deg when value > 0.667
    const justUnder = computeKnobGeometry(0.6).valuePath!;
    const over = computeKnobGeometry(0.8).valuePath!;
    expect(justUnder).toContain(' 0 1 '); // large-arc-flag = 0
    expect(over).toContain(' 1 1 ');      // large-arc-flag = 1
  });
});
