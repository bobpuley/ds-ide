import { describe, it, expect } from 'vitest';
import { computePinOverlayStates } from '../../../wiring/pin-overlay-state';
import { PIN_DEFS } from '../../../devices/pin-table.gen';
import type { PeripheralDisplayState } from '../../../wiring/peripheral-state';
import type { WiredPin } from '../../../wiring/wiring-panel';

const SDCARD_ENABLED: PeripheralDisplayState = {
  id: 'sdcard',
  label: 'SD Card',
  enabled: true,
  bus: 'SDMMC1',
  pins: [
    { pin: 1, signal: 'SDMMC1_D3' },
    { pin: 2, signal: 'SDMMC1_D2' },
    { pin: 3, signal: 'SDMMC1_D1' },
    { pin: 4, signal: 'SDMMC1_D0' },
    { pin: 5, signal: 'SDMMC1_CMD' },
    { pin: 6, signal: 'SDMMC1_CK' },
  ],
};
const SDCARD_DISABLED: PeripheralDisplayState = { ...SDCARD_ENABLED, enabled: false };

describe('computePinOverlayStates (FR-DEV-11/12 regression)', () => {
  it('marks an enabled peripheral\'s pins pin-bus with a tooltip', () => {
    const states = computePinOverlayStates(PIN_DEFS, [], [SDCARD_ENABLED]);
    const d5 = states.find(s => s.pin === 5)!;
    expect(d5.className).toBe('pin-bus');
    expect(d5.tip).toContain('SDMMC1_CMD');
    expect(d5.tip).toContain('SD Card');
  });

  // Regression: disabling a peripheral used to leave its pins visually
  // marked pin-bus forever — applyPeripheralPins only ever added the class,
  // never restored the default once the peripheral was disabled.
  it('restores the default unassigned/adc class once the peripheral is disabled', () => {
    const states = computePinOverlayStates(PIN_DEFS, [], [SDCARD_DISABLED]);
    const d5 = states.find(s => s.pin === 5)!;
    expect(d5.className).toBe('pin-unassigned');
    expect(d5.tip).toBeNull();
  });

  it('an ADC-capable pin with no occupant restores to pin-adc, not pin-unassigned', () => {
    const states = computePinOverlayStates(PIN_DEFS, [], []);
    const d15 = states.find(s => s.pin === 15)!; // D15/A0 is ADC-capable
    expect(d15.className).toBe('pin-adc');
  });

  it('a hand-wired control on a pin always wins over a bus overlay', () => {
    const wiredPins: WiredPin[] = [{ pinNumber: 5, deviceType: 'led', id: 'led1' }];
    const states = computePinOverlayStates(PIN_DEFS, wiredPins, [SDCARD_ENABLED]);
    const d5 = states.find(s => s.pin === 5)!;
    expect(d5.className).toBe('pin-led');
    expect(d5.tip).toBeNull();
  });

  it('every assignable pin is present exactly once', () => {
    const states = computePinOverlayStates(PIN_DEFS, [], [SDCARD_ENABLED]);
    const assignablePins = PIN_DEFS.filter(d => d.pin !== null).length;
    expect(states).toHaveLength(assignablePins);
  });
});
