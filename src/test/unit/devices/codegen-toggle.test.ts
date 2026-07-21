import { describe, it, expect } from 'vitest';
import { clampTogglePosition, TOGGLE_POSITIONS } from '../../../devices/codegen/toggle';

describe('clampTogglePosition (FR-DEV-7)', () => {
  it('rounds a fractional value to the nearest position', () => {
    expect(clampTogglePosition(0.4)).toBe(0);
    expect(clampTogglePosition(0.6)).toBe(1);
    expect(clampTogglePosition(1.5)).toBe(2);
  });

  it('clamps below 0 up to 0', () => {
    expect(clampTogglePosition(-3)).toBe(0);
  });

  it('clamps above the max position down to the max', () => {
    expect(clampTogglePosition(99)).toBe(TOGGLE_POSITIONS - 1);
  });

  it('round-trips every valid position unchanged', () => {
    for (let p = 0; p < TOGGLE_POSITIONS; p++) {
      expect(clampTogglePosition(p)).toBe(p);
    }
  });
});
