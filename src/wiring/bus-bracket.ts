// Pure reducer from (peripheral display states, pin table) to one collapsed
// bracket per enabled bus peripheral (FR-DEV-12) — no DOM access, so it's
// unit-testable directly. A bracket spans from its peripheral's topmost to
// bottommost pin row (even across a gap — a wired control interspersed, or a
// non-contiguous footprint), and carries one label, never one per pin.
import type { PinDef } from '../devices/pin-table.gen';
import type { PeripheralDisplayState } from './peripheral-state';
import type { ResolvedPin } from '../devices/attachment';

export interface BusBracket {
  id: string;
  label: string;
  side: 'L' | 'R';
  minRow: number;
  maxRow: number;
  pins: ResolvedPin[];
}

export function computeBusBrackets(
  peripherals: PeripheralDisplayState[],
  pinDefs: PinDef[],
): BusBracket[] {
  const brackets: BusBracket[] = [];

  for (const p of peripherals) {
    if (!p.enabled || p.pins.length === 0) continue;

    const rows = p.pins
      .map(rp => pinDefs.find(d => d.pin === rp.pin))
      .filter((d): d is PinDef => d !== undefined);
    if (rows.length === 0) continue;

    brackets.push({
      id: p.id,
      label: p.label,
      side: rows[0]!.side,
      minRow: Math.min(...rows.map(d => d.row)),
      maxRow: Math.max(...rows.map(d => d.row)),
      pins: p.pins,
    });
  }

  return brackets;
}
