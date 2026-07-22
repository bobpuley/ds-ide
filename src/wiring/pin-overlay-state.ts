// Pure reducer combining wired-control state and bus-peripheral occupancy
// into one final visual class per assignable pin (FR-DEV-11/12 regression
// fix) — no DOM access, so it's unit-testable directly. Computing the full
// end-state on every call (rather than incrementally add/removing classes
// in the DOM) is deliberate: the earlier DOM-side version only ever *added*
// `pin-bus` and never restored the default class once a peripheral was
// disabled, leaving its pins visually "connected" forever. A pure "what
// should this pin look like right now" function makes that class of bug
// structurally impossible — applying it is just "set the classList to
// exactly this," never a delta.
import type { PinDef, WiredPin } from './wiring-panel';
import type { PeripheralDisplayState } from './peripheral-state';
import { computePinDisplayStates, type PinDisplayClass } from './wired-pin-state';
import { computeBusBrackets } from './bus-bracket';

export interface PinOverlayState {
  pin: number;
  className: PinDisplayClass | 'pin-bus';
  assignedId: string | null;
  /** "pin · signal · owner" tooltip text — set only for a pin-bus pin. */
  tip: string | null;
}

export function computePinOverlayStates(
  pinDefs: PinDef[],
  wiredPins: WiredPin[],
  peripherals: PeripheralDisplayState[],
): PinOverlayState[] {
  const wiredPinNumbers = new Set(wiredPins.map(wp => wp.pinNumber));
  const owned = new Map<number, { signal: string | null; owner: string }>();
  for (const b of computeBusBrackets(peripherals, pinDefs)) {
    for (const rp of b.pins) owned.set(rp.pin, { signal: rp.signal, owner: b.label });
  }

  return computePinDisplayStates(pinDefs, wiredPins).map(ws => {
    if (wiredPinNumbers.has(ws.pin)) {
      return { pin: ws.pin, className: ws.className, assignedId: ws.assignedId, tip: null };
    }
    const info = owned.get(ws.pin);
    if (!info) {
      return { pin: ws.pin, className: ws.className, assignedId: ws.assignedId, tip: null };
    }
    return {
      pin: ws.pin,
      className: 'pin-bus' as const,
      assignedId: null,
      tip: `D${ws.pin} · ${info.signal ?? '—'} · ${info.owner}`,
    };
  });
}
