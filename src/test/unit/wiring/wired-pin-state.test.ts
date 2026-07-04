import { describe, it, expect } from 'vitest';
import { computePinDisplayStates } from '../../../wiring/wired-pin-state';
import { PinDef, WiredPin } from '../../../wiring/wiring-panel';

const PIN_DEFS: PinDef[] = [
  { row: 0, side: 'L', pin: 0, label: 'D0', aLabel: null, adc: false },
  { row: 1, side: 'R', pin: 15, label: 'D15', aLabel: 'A0', adc: true },
  { row: 2, side: 'R', pin: null, label: 'GND', aLabel: null, adc: false },
];

describe('computePinDisplayStates (FR-IPC-6)', () => {
  it('excludes power/special pins with a null pin number', () => {
    const states = computePinDisplayStates(PIN_DEFS, []);
    expect(states.map((s) => s.pin)).not.toContain(null);
    expect(states).toHaveLength(2);
  });

  it('marks a non-ADC unwired pin as pin-unassigned', () => {
    const states = computePinDisplayStates(PIN_DEFS, []);
    const d0 = states.find((s) => s.pin === 0)!;
    expect(d0.className).toBe('pin-unassigned');
    expect(d0.assignedId).toBeNull();
  });

  it('marks an ADC-capable unwired pin as pin-adc', () => {
    const states = computePinDisplayStates(PIN_DEFS, []);
    const d15 = states.find((s) => s.pin === 15)!;
    expect(d15.className).toBe('pin-adc');
    expect(d15.assignedId).toBeNull();
  });

  it('marks a wired pin with its device-type class and assigned id', () => {
    const wired: WiredPin[] = [{ pinNumber: 0, deviceType: 'pot', id: 'vol1' }];
    const states = computePinDisplayStates(PIN_DEFS, wired);
    const d0 = states.find((s) => s.pin === 0)!;
    expect(d0.className).toBe('pin-pot');
    expect(d0.assignedId).toBe('vol1');
  });

  it('an ADC pin that gets wired loses its pin-adc class in favor of the device class', () => {
    const wired: WiredPin[] = [{ pinNumber: 15, deviceType: 'button', id: 'btn1' }];
    const states = computePinDisplayStates(PIN_DEFS, wired);
    const d15 = states.find((s) => s.pin === 15)!;
    expect(d15.className).toBe('pin-button');
  });

  it('a pin that becomes unwired again reverts to its unassigned/adc default', () => {
    const states = computePinDisplayStates(PIN_DEFS, []);
    const d0 = states.find((s) => s.pin === 0)!;
    expect(d0.className).toBe('pin-unassigned');
  });
});
