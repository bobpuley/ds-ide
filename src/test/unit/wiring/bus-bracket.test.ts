import { describe, it, expect } from 'vitest';
import { computeBusBrackets } from '../../../wiring/bus-bracket';
import { PIN_DEFS } from '../../../devices/pin-table.gen';
import type { PeripheralDisplayState } from '../../../wiring/peripheral-state';

const SDCARD_ENABLED: PeripheralDisplayState = {
  id: 'sdcard',
  label: 'SD Card',
  enabled: true,
  pins: [
    { pin: 1, signal: 'SDMMC1_D3' },
    { pin: 2, signal: 'SDMMC1_D2' },
    { pin: 3, signal: 'SDMMC1_D1' },
    { pin: 4, signal: 'SDMMC1_D0' },
    { pin: 5, signal: 'SDMMC1_CMD' },
    { pin: 6, signal: 'SDMMC1_CK' },
  ],
};

describe('computeBusBrackets (FR-DEV-12)', () => {
  it('produces one bracket per enabled peripheral', () => {
    const brackets = computeBusBrackets([SDCARD_ENABLED], PIN_DEFS);
    expect(brackets).toHaveLength(1);
    expect(brackets[0]!.id).toBe('sdcard');
    expect(brackets[0]!.label).toBe('SD Card');
  });

  it('spans from the topmost to bottommost row of its resolved pins', () => {
    const brackets = computeBusBrackets([SDCARD_ENABLED], PIN_DEFS);
    const rows = SDCARD_ENABLED.pins.map(rp => PIN_DEFS.find(d => d.pin === rp.pin)!.row);
    expect(brackets[0]!.minRow).toBe(Math.min(...rows));
    expect(brackets[0]!.maxRow).toBe(Math.max(...rows));
  });

  it('carries each pin with its signal name, for the tooltip', () => {
    const brackets = computeBusBrackets([SDCARD_ENABLED], PIN_DEFS);
    const pin5 = brackets[0]!.pins.find(p => p.pin === 5);
    expect(pin5?.signal).toBe('SDMMC1_CMD');
  });

  it('omits a disabled peripheral entirely', () => {
    const disabled = { ...SDCARD_ENABLED, enabled: false };
    expect(computeBusBrackets([disabled], PIN_DEFS)).toEqual([]);
  });

  it('omits a peripheral with no resolved pins (e.g. connector-attached)', () => {
    const connectorLike: PeripheralDisplayState = { id: 'midiusb', label: 'MIDI USB', enabled: true, pins: [] };
    expect(computeBusBrackets([connectorLike], PIN_DEFS)).toEqual([]);
  });

  it('assigns the correct board side from the pin table', () => {
    const brackets = computeBusBrackets([SDCARD_ENABLED], PIN_DEFS);
    expect(brackets[0]!.side).toBe('L'); // D1–D6 are all left-side pins
  });
});
