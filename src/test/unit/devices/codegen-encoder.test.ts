import { describe, it, expect } from 'vitest';
import { wrapEncoderPosition, encoderDelta, ENCODER_POSITION_MODULUS } from '../../../devices/codegen/encoder';

describe('wrapEncoderPosition (FR-DEV-9)', () => {
  it('leaves an in-range value unchanged', () => {
    expect(wrapEncoderPosition(5)).toBe(5);
    expect(wrapEncoderPosition(0)).toBe(0);
    expect(wrapEncoderPosition(ENCODER_POSITION_MODULUS - 1)).toBe(ENCODER_POSITION_MODULUS - 1);
  });

  it('wraps a value at/past the modulus back into range', () => {
    expect(wrapEncoderPosition(ENCODER_POSITION_MODULUS)).toBe(0);
    expect(wrapEncoderPosition(ENCODER_POSITION_MODULUS + 3)).toBe(3);
  });

  it('wraps a negative value into range', () => {
    expect(wrapEncoderPosition(-1)).toBe(ENCODER_POSITION_MODULUS - 1);
    expect(wrapEncoderPosition(-5)).toBe(ENCODER_POSITION_MODULUS - 5);
  });
});

describe('encoderDelta (FR-DEV-9)', () => {
  it('derives a simple forward delta', () => {
    expect(encoderDelta(5, 8)).toBe(3);
  });

  it('derives a simple backward delta', () => {
    expect(encoderDelta(8, 5)).toBe(-3);
  });

  it('derives zero delta across an unchanged callback boundary', () => {
    expect(encoderDelta(5, 5)).toBe(0);
  });

  it('handles forward wraparound (max -> min is +1, not a huge negative jump)', () => {
    expect(encoderDelta(ENCODER_POSITION_MODULUS - 1, 0)).toBe(1);
  });

  it('handles backward wraparound (min -> max is -1, not a huge positive jump)', () => {
    expect(encoderDelta(0, ENCODER_POSITION_MODULUS - 1)).toBe(-1);
  });

  it('handles multi-step wraparound in either direction', () => {
    expect(encoderDelta(ENCODER_POSITION_MODULUS - 2, 1)).toBe(3);
    expect(encoderDelta(1, ENCODER_POSITION_MODULUS - 2)).toBe(-3);
  });

  it('accumulates correctly across several sequential callback boundaries', () => {
    const positions = [0, 2, 5, 5, 3, ENCODER_POSITION_MODULUS - 1, 1];
    const deltas: number[] = [];
    for (let i = 1; i < positions.length; i++) {
      deltas.push(encoderDelta(positions[i - 1]!, positions[i]!));
    }
    expect(deltas).toEqual([2, 3, 0, -2, -4, 2]);
  });
});
