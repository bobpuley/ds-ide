// Pure reducer from (pin definitions, wired pins) to per-pin display state
// for the Wiring Editor's SVG pinout — no DOM access, so it can be
// unit-tested directly instead of only through a browser (FR-IPC-6).
import type { PinDef, WiredPin, DeviceType } from './wiring-panel';
import type { ConventionControl } from '../controllers/controls-convention-parser';

// Derived from DeviceType (FR-DEV-2) rather than hand-listed, so a new
// registry entry doesn't need a matching edit here.
export type PinDisplayClass = `pin-${DeviceType}` | 'pin-unassigned';

export interface PinDisplayState {
  pin: number;
  className: PinDisplayClass;
  assignedId: string | null;
}

// Only assignable pins (def.pin !== null) are included — power/special pins
// have no state transitions.
export function computePinDisplayStates(pinDefs: PinDef[], wiredPins: WiredPin[]): PinDisplayState[] {
  const wiredByPin = new Map(wiredPins.map((wp) => [wp.pinNumber, wp]));
  const states: PinDisplayState[] = [];
  for (const def of pinDefs) {
    if (def.pin === null) continue;
    const wired = wiredByPin.get(def.pin);
    if (wired) {
      states.push({ pin: def.pin, className: `pin-${wired.deviceType}`, assignedId: wired.id });
    } else {
      // FR-UDM-10: every free pin is grey — ADC capability shows through
      // the A-label and the drag-time targets, not a distinct idle colour.
      states.push({ pin: def.pin, className: 'pin-unassigned', assignedId: null });
    }
  }
  return states;
}

// Expands parsed controls into one WiredPin per physical pin — a
// 'pins'-attachment device (rgbled, encoder — FR-DEV-8/9) occupies more than
// one, all sharing its id, so a single-pin `{pinNumber: c.pin, ...}` mapping
// silently drops its other pins. The single shared implementation here
// replaces three independent inline copies in extension.ts that drifted out
// of sync (one kept using the old single-pin form after the multi-pin
// devices landed, clobbering the Wiring Editor's display back down to one
// highlighted pin on the very next save).
export function expandToWiredPins(controls: ConventionControl[]): WiredPin[] {
  return controls.flatMap(c =>
    (c.pins ?? [c.pin]).map(p => ({ pinNumber: p, deviceType: c.kind as DeviceType, id: c.id })),
  );
}
