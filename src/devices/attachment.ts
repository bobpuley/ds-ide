// Attachment model (FR-DEV-3) — how a device occupies board resources.
// A bus peripheral's pin footprint is a function of its *selected* bus, not
// a constant: an OLED occupies D7-D10 on SPI1 but D11-D12 on I2C1. Every
// function here re-derives a bus attachment's footprint from the current
// pin table on every call rather than caching it, so a bus switch (or a
// pin-table regeneration) is always reflected.
import { PIN_DEFS } from './pin-table.gen';
import type { PinDef } from './pin-table.gen';

export type Attachment =
  | { kind: 'pin'; pin: number }
  | { kind: 'pins'; pins: number[] }
  | { kind: 'bus'; bus: string }
  | { kind: 'connector'; id: string };

// Not yet exposed in any UI (connectors like this are M47's USB MIDI target)
// but addressable as an attachment kind starting now (FR-DEV-3).
export const KNOWN_CONNECTORS = ['microusb'] as const;
export type ConnectorId = typeof KNOWN_CONNECTORS[number];

export interface ResolvedPin {
  pin: number;
  /** The specific bus signal at this pin (e.g. 'SPI1_NSS'), or null for a plain pin/pins attachment. */
  signal: string | null;
}

// Scans the pin table for every pin whose canonical, board-dedicated bus
// signal is in `busName`'s namespace (e.g. 'SPI1' matches 'SPI1_NSS',
// 'SPI1_SCK', ... but not 'SPI13_...' or 'I2C1_...') — the pin table is the
// single source of truth for this mapping (FR-DEV-3, see pin-table.gen.ts),
// so it is never hand-declared per device.
//
// Matches against `canonicalBusSignal` only, not the full i2c/uart/spi
// mux-option arrays (FR-DEV-14): those list every alternate-function the
// silicon supports for a pin, most of which the Daisy Seed board never
// actually wires — e.g. D13/D14 list I2C1_SCL/SDA as a mux option but their
// canonical assignment is USART1 (MIDI TRS, M47). Resolving against the
// full arrays would falsely include such pins in another bus's footprint.
export function resolveBusFootprint(busName: string, pinDefs: PinDef[] = PIN_DEFS): ResolvedPin[] {
  const prefix = `${busName}_`;
  const resolved: ResolvedPin[] = [];
  for (const def of pinDefs) {
    if (def.pin === null) continue;
    if (def.canonicalBusSignal?.startsWith(prefix)) {
      resolved.push({ pin: def.pin, signal: def.canonicalBusSignal });
    }
  }
  return resolved;
}

// Resolves any attachment kind to its current set of occupied pins.
// Connectors occupy no numbered GPIO pin, so they resolve to an empty pin
// footprint — collisions on a connector are tracked separately (see
// findConflicts).
export function resolveFootprint(attachment: Attachment, pinDefs: PinDef[] = PIN_DEFS): ResolvedPin[] {
  switch (attachment.kind) {
    case 'pin':
      return [{ pin: attachment.pin, signal: null }];
    case 'pins':
      return attachment.pins.map(pin => ({ pin, signal: null }));
    case 'bus':
      return resolveBusFootprint(attachment.bus, pinDefs);
    case 'connector':
      return [];
  }
}

export interface AttachedDevice {
  /** Stable instance id, distinct from `owner` (which is what a conflict message displays). */
  id: string;
  /** Human-readable name shown in a conflict report — e.g. "vol (Pot)". */
  owner: string;
  attachment: Attachment;
}

export interface PinConflict {
  pin: number;
  signal: string | null;
  owners: string[];
}

export interface ConnectorConflict {
  connectorId: string;
  owners: string[];
}

export interface ConflictReport {
  pinConflicts: PinConflict[];
  connectorConflicts: ConnectorConflict[];
}

// Resolves the footprint of every enabled device (pin/pins/bus/connector
// alike — a wired control's single-pin attachment and a bus peripheral's
// derived footprint are checked the same way) and reports each pin or
// connector occupied by more than one device, naming every owner (FR-DEV-3).
export function findConflicts(devices: AttachedDevice[], pinDefs: PinDef[] = PIN_DEFS): ConflictReport {
  const pinOwners = new Map<number, { signal: string | null; owners: string[] }>();
  const connectorOwners = new Map<string, string[]>();

  for (const device of devices) {
    if (device.attachment.kind === 'connector') {
      const owners = connectorOwners.get(device.attachment.id) ?? [];
      owners.push(device.owner);
      connectorOwners.set(device.attachment.id, owners);
      continue;
    }
    for (const { pin, signal } of resolveFootprint(device.attachment, pinDefs)) {
      const entry = pinOwners.get(pin) ?? { signal, owners: [] };
      if (signal && !entry.signal) entry.signal = signal;
      entry.owners.push(device.owner);
      pinOwners.set(pin, entry);
    }
  }

  const pinConflicts: PinConflict[] = [];
  for (const [pin, { signal, owners }] of pinOwners) {
    if (owners.length > 1) pinConflicts.push({ pin, signal, owners });
  }

  const connectorConflicts: ConnectorConflict[] = [];
  for (const [connectorId, owners] of connectorOwners) {
    if (owners.length > 1) connectorConflicts.push({ connectorId, owners });
  }

  return { pinConflicts, connectorConflicts };
}
