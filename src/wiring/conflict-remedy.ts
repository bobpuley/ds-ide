// Reject-with-remedy (FR-DEV-13) — an action that would create a pin or
// connector conflict is refused before any state changes, never
// applied-and-flagged. A colliding peripheral occupant gets a one-click
// "move to bus X" remedy when it has a collision-free alternative; a
// colliding hand-wired control never does — the editor never relocates a
// hand-placed control automatically.
import type { PinDef } from '../devices/pin-table.gen';
import type { Attachment } from '../devices/attachment';
import { resolveFootprint } from '../devices/attachment';
import { REGISTRY } from '../devices/registry';
import { parseControlsConvention } from '../controllers/controls-convention-parser';
import { computePeripheralDisplayStates } from './peripheral-state';

export interface Occupant {
  id: string;
  /** Display name shown in a rejection message, e.g. "vol (Pot)" or "SD Card". */
  label: string;
  kind: 'control' | 'peripheral';
  attachment: Attachment;
}

export type Blocker =
  | { kind: 'pin'; pin: number; signal: string | null; occupant: Occupant }
  | { kind: 'connector'; connectorId: string; occupant: Occupant };

export interface Remedy {
  /** Human-readable action description, e.g. "Move OLED to I2C1 instead". */
  description: string;
  /** The blocking occupant this remedy would move. */
  occupantId: string;
  targetBus: string;
}

export interface Rejection {
  blockers: Blocker[];
  remedies: Remedy[];
  /** True when at least one blocker is a hand-wired control (guidance-only, no auto-fix). */
  hasControlBlocker: boolean;
}

function connectorIdOf(a: Attachment): string | null {
  return a.kind === 'connector' ? a.id : null;
}

// Would `attachment` collide with the candidate or any occupant other than
// `excludeId` (the occupant being hypothetically moved)?
function collides(
  attachment: Attachment,
  excludeId: string,
  others: Occupant[],
  candidateAttachment: Attachment,
  pinDefs: PinDef[],
): boolean {
  const connectorId = connectorIdOf(attachment);
  if (connectorId !== null) {
    if (connectorIdOf(candidateAttachment) === connectorId) return true;
    return others.some(o => o.id !== excludeId && connectorIdOf(o.attachment) === connectorId);
  }

  const pins = new Set(resolveFootprint(attachment, pinDefs).map(rp => rp.pin));
  if (pins.size === 0) return false;

  const candidatePins = resolveFootprint(candidateAttachment, pinDefs).map(rp => rp.pin);
  if (candidatePins.some(p => pins.has(p))) return true;

  for (const o of others) {
    if (o.id === excludeId) continue;
    const otherPins = resolveFootprint(o.attachment, pinDefs).map(rp => rp.pin);
    if (otherPins.some(p => pins.has(p))) return true;
  }
  return false;
}

// Checks whether `candidateAttachment` collides with anything in `existing`.
// Returns null when clear. `candidateBusesFor(occupantId)` reports the buses
// a *blocking peripheral occupant* could be moved to instead — a hand-wired
// control is never offered as a move target, so this is only consulted for
// peripheral blockers.
export function checkConflict(
  candidateAttachment: Attachment,
  existing: Occupant[],
  pinDefs: PinDef[],
  candidateBusesFor: (occupantId: string) => string[],
): Rejection | null {
  const blockers: Blocker[] = [];

  const candidateConnector = connectorIdOf(candidateAttachment);
  if (candidateConnector !== null) {
    for (const occ of existing) {
      if (connectorIdOf(occ.attachment) === candidateConnector) {
        blockers.push({ kind: 'connector', connectorId: candidateConnector, occupant: occ });
      }
    }
  } else {
    // A plain pin/pins attachment (a hand-wired control) resolves with no
    // signal of its own — the meaningful signal name at a colliding pin
    // comes from whichever side is bus-attached, typically the candidate.
    const candidateResolved = resolveFootprint(candidateAttachment, pinDefs);
    const candidatePins = new Set(candidateResolved.map(rp => rp.pin));
    const candidateSignalByPin = new Map(candidateResolved.map(rp => [rp.pin, rp.signal]));
    for (const occ of existing) {
      for (const rp of resolveFootprint(occ.attachment, pinDefs)) {
        if (!candidatePins.has(rp.pin)) continue;
        const signal = rp.signal ?? candidateSignalByPin.get(rp.pin) ?? null;
        blockers.push({ kind: 'pin', pin: rp.pin, signal, occupant: occ });
      }
    }
  }

  if (blockers.length === 0) return null;

  const hasControlBlocker = blockers.some(b => b.occupant.kind === 'control');

  const remedies: Remedy[] = [];
  const seen = new Set<string>();
  for (const b of blockers) {
    if (b.occupant.kind !== 'peripheral' || seen.has(b.occupant.id)) continue;
    seen.add(b.occupant.id);
    const currentBus = b.occupant.attachment.kind === 'bus' ? b.occupant.attachment.bus : null;
    for (const bus of candidateBusesFor(b.occupant.id)) {
      if (bus === currentBus) continue;
      const moved: Attachment = { kind: 'bus', bus };
      if (!collides(moved, b.occupant.id, existing, candidateAttachment, pinDefs)) {
        remedies.push({
          description: `Move ${b.occupant.label} to ${bus} instead`,
          occupantId: b.occupant.id,
          targetBus: bus,
        });
        break;
      }
    }
  }

  return { blockers, remedies, hasControlBlocker };
}

// Plain-text rejection message naming every blocking pin/connector with its
// signal and owner, any one-click remedies, and guidance when a hand-wired
// control is among the blockers (FR-DEV-13) — the editor never relocates a
// hand-placed control automatically.
export function formatRejection(peripheralLabel: string, rejection: Rejection): string {
  const why = rejection.blockers.map(b => b.kind === 'pin'
    ? `D${b.pin}${b.signal ? ` (${b.signal})` : ''} — in use by ${b.occupant.label}`
    : `${b.connectorId} connector — in use by ${b.occupant.label}`,
  ).join('; ');

  const guidance = rejection.hasControlBlocker
    ? ' Move or remove the conflicting control from the board first — controls are not relocated automatically.'
    : '';
  const remedyText = rejection.remedies.length
    ? ` ${rejection.remedies.map(r => r.description).join(' ')}`
    : '';

  return `ds-ide: can't enable ${peripheralLabel} — ${why}.${guidance}${remedyText}`;
}

// Assembles every occupant currently on the board from the effect source
// text — one control occupant per wired control (controls-convention-parser)
// plus one peripheral occupant per *other* enabled peripheral
// (peripheral-state) — excluding `excludingPeripheralId` (the peripheral
// being enabled, which is the candidate, not an existing occupant).
export function buildOccupants(source: string, excludingPeripheralId: string): Occupant[] {
  const { controls } = parseControlsConvention(source);
  const controlOccupants: Occupant[] = controls.map(c => ({
    id: c.id,
    label: `${c.id} (${REGISTRY[c.kind]?.label ?? c.kind})`,
    kind: 'control',
    attachment: c.pins ? { kind: 'pins', pins: c.pins } : { kind: 'pin', pin: c.pin },
  }));

  const peripheralOccupants: Occupant[] = computePeripheralDisplayStates(source)
    .filter(p => p.enabled && p.id !== excludingPeripheralId && p.bus)
    .map(p => ({
      id: p.id,
      label: p.label,
      kind: 'peripheral',
      attachment: { kind: 'bus', bus: p.bus! },
    }));

  return [...controlOccupants, ...peripheralOccupants];
}
