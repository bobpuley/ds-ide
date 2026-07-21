// Pure reducer from (pin definitions, wired pins) to per-pin display state
// for the Wiring Editor's SVG pinout — no DOM access, so it can be
// unit-tested directly instead of only through a browser (FR-IPC-6).
import { PinDef, WiredPin, DeviceType } from './wiring-panel';

// Derived from DeviceType (FR-DEV-2) rather than hand-listed, so a new
// registry entry doesn't need a matching edit here.
export type PinDisplayClass = `pin-${DeviceType}` | 'pin-unassigned' | 'pin-adc';

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
      states.push({ pin: def.pin, className: def.adc ? 'pin-adc' : 'pin-unassigned', assignedId: null });
    }
  }
  return states;
}
