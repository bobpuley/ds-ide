// FR-UDM-6: every place a picked-up device could be dropped, and what each
// drop would displace. Pure and browser-safe (no `vscode`, no Node builtins):
// the Wiring Editor webview calls it to paint targets while dragging, and the
// host derives its multi-pin allocation from the same occupancy, so a
// previewed footprint is exactly the one the host writes.
import type { PinDef } from '../devices/pin-table.gen';
import { REGISTRY } from '../devices/registry';
import { resolveBusFootprint } from '../devices/attachment';
import { parseControlsConvention } from '../controllers/controls-convention-parser';
import type { WiredPin } from './wiring-panel';
import type { PeripheralDisplayState } from './peripheral-state';
import { computePeripheralDisplayStates } from './peripheral-state';
import { expandToWiredPins } from './wired-pin-state';
import { isPinEligible } from './pin-eligibility';
import { allocateAdjacentPins } from './multi-pin-alloc';
import { candidateBusesFor } from './conflict-remedy';

/** What is on the board right now — the webview already holds exactly this. */
export interface Occupancy {
  wiredPins: WiredPin[];
  peripherals: PeripheralDisplayState[];
}

/** A device a drop would remove. `label` matches buildOccupants()' naming. */
export interface DropConflict {
  id: string;
  label: string;
  kind: 'control' | 'peripheral';
}

export interface DropTarget {
  /** 'pin' = a control's start pin; 'lane' = a bus; 'usb' = the micro-USB connector. */
  kind: 'pin' | 'lane' | 'usb';
  /** The full footprint the drop would claim, in slot / bus-signal order. */
  pins: number[];
  /** The bus this target selects — lanes and usb only. */
  bus?: string;
  conflicts: DropConflict[];
}

/** The same occupancy the webview renders, derived from the effect source (host side). */
export function occupancyFromSource(source: string): Occupancy {
  return {
    wiredPins: expandToWiredPins(parseControlsConvention(source).controls),
    peripherals: computePeripheralDisplayStates(source),
  };
}

function controlConflict(wp: WiredPin): DropConflict {
  return { id: wp.id, label: `${wp.id} (${REGISTRY[wp.deviceType]?.label ?? wp.deviceType})`, kind: 'control' };
}

/** Pins inside any enabled peripheral's resolved lane, except `exceptId`'s. */
function lanePins(peripherals: PeripheralDisplayState[], exceptId?: string): Set<number> {
  return new Set(peripherals
    .filter(p => p.enabled && p.id !== exceptId)
    .flatMap(p => p.pins.map(rp => rp.pin)));
}

/**
 * Every drop target for `deviceId` (FR-UDM-6). `exclude` is the id of a
 * control being moved: its own pins count as free.
 *
 * - single-pin controls: every eligible pin outside enabled peripheral lanes;
 *   a pin held by another control is a target with that control as conflict.
 * - multi-pin controls: every free, eligible start pin for which
 *   allocateAdjacentPins succeeds (occupied pins and lanes are skipped), so
 *   these targets never conflict.
 * - bus peripherals: one lane per candidate bus (a zero-pin bus is the usb
 *   target), naming every control and other peripheral it overlaps. An
 *   already-placed peripheral omits its current bus: dropping there is no move.
 */
export function computeDropTargets(
  deviceId: string,
  pinDefs: PinDef[],
  occupancy: Occupancy,
  exclude?: string,
): DropTarget[] {
  const d = REGISTRY[deviceId];
  if (!d) return [];
  const controls = occupancy.wiredPins.filter(wp => wp.id !== exclude);

  if (d.attachmentKind === 'pin' || d.attachmentKind === 'pins') {
    const lanes = lanePins(occupancy.peripherals);
    const eligible = pinDefs
      .filter(def => isPinEligible(def, deviceId) && !lanes.has(def.pin!))
      .map(def => def.pin!)
      .sort((a, b) => a - b);

    if (d.attachmentKind === 'pin') {
      return eligible.map(pin => ({
        kind: 'pin' as const,
        pins: [pin],
        conflicts: controls.filter(wp => wp.pinNumber === pin).slice(0, 1).map(controlConflict),
      }));
    }

    const count = d.pinCount ?? 1;
    const occupied = new Set([...controls.map(wp => wp.pinNumber), ...lanes]);
    const eligibleSet = new Set(eligible);
    const targets: DropTarget[] = [];
    for (const start of eligible) {
      if (occupied.has(start)) continue;
      const pins = allocateAdjacentPins(start, count, pinDefs, occupied);
      if (pins && pins.every(p => eligibleSet.has(p))) targets.push({ kind: 'pin', pins, conflicts: [] });
    }
    return targets;
  }

  const current = occupancy.peripherals.find(p => p.id === deviceId && p.enabled);
  const others = occupancy.peripherals.filter(p => p.enabled && p.id !== deviceId);
  return candidateBusesFor(deviceId)
    .filter(bus => bus !== current?.bus)
    .map(bus => {
      const pins = resolveBusFootprint(bus, pinDefs).map(rp => rp.pin);
      const onLane = new Set(pins);
      const conflicts: DropConflict[] = [];
      for (const wp of controls) {
        if (onLane.has(wp.pinNumber) && !conflicts.some(c => c.id === wp.id)) conflicts.push(controlConflict(wp));
      }
      for (const p of others) {
        const overlaps = pins.length === 0 ? p.bus === bus : p.pins.some(rp => onLane.has(rp.pin));
        if (overlaps) conflicts.push({ id: p.id, label: p.label, kind: 'peripheral' });
      }
      return { kind: pins.length === 0 ? 'usb' as const : 'lane' as const, pins, bus, conflicts };
    });
}
