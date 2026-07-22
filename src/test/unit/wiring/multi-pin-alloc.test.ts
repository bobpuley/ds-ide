import { describe, it, expect } from 'vitest';
import { allocateAdjacentPins } from '../../../wiring/multi-pin-alloc';
import type { PinDef } from '../../../devices/pin-table.gen';

function makePinDefs(pins: Array<number | null>): PinDef[] {
  return pins.map((pin, i) => ({
    row: i, side: 'L', pin, label: pin === null ? 'GND' : `D${pin}`,
    aLabel: null, adc: false, i2c: null, uart: null, spi: null, sdmmc: null, canonicalBusSignal: null,
  }));
}

describe('allocateAdjacentPins (FR-DEV-8)', () => {
  const PIN_DEFS = makePinDefs([0, 1, 2, 3, 4, 5, null, 6, 7]);

  it('allocates the clicked pin plus the next free pins in ascending order', () => {
    expect(allocateAdjacentPins(2, 3, PIN_DEFS, new Set())).toEqual([2, 3, 4]);
  });

  it('skips already-occupied pins when scanning forward', () => {
    expect(allocateAdjacentPins(2, 3, PIN_DEFS, new Set([3]))).toEqual([2, 4, 5]);
  });

  it('skips a non-assignable (power/special) pin entirely', () => {
    // 5 -> next assignable after 5 is 6 (index skips the null entry)
    expect(allocateAdjacentPins(5, 2, PIN_DEFS, new Set())).toEqual([5, 6]);
  });

  it('returns null when not enough free pins remain after the clicked one', () => {
    expect(allocateAdjacentPins(7, 3, PIN_DEFS, new Set())).toBeNull();
  });

  it('returns null when the clicked pin is not itself assignable', () => {
    expect(allocateAdjacentPins(99, 3, PIN_DEFS, new Set())).toBeNull();
  });

  it('a single-pin allocation (count=1) returns just the clicked pin', () => {
    expect(allocateAdjacentPins(2, 1, PIN_DEFS, new Set())).toEqual([2]);
  });
});
