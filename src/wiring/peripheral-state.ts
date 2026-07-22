// Pure reducer from (effect source text) to per-peripheral display state for
// the Wiring Editor's Peripherals section (FR-DEV-11) — no DOM access, no
// vscode import, so it's unit-testable directly. Mirrors wired-pin-state.ts's
// role for pin-attached devices; a peripheral's *enabled* state has the same
// source-of-truth convention every pin-attached device already uses — the
// effect source text itself, not workspaceState or a YAML file (see
// peripheral-config.ts for the writer side).
import { REGISTRY } from '../devices/registry';
import { resolveBusFootprint } from '../devices/attachment';
import type { ResolvedPin } from '../devices/attachment';

export interface PeripheralDisplayState {
  id: string;
  label: string;
  enabled: boolean;
  /**
   * Resolved pin footprint (FR-DEV-3), each with its bus signal name — empty
   * for a connector-attached peripheral. Carries the signal (not just the
   * pin number) so FR-DEV-12's tooltip can show "pin · signal · owner"
   * without re-resolving the bus footprint a second time.
   */
  pins: ResolvedPin[];
  /**
   * The bus this peripheral currently resolves against, or null for a
   * connector-attached peripheral. For a single-bus peripheral this is
   * always its fixed `bus`; for a multi-bus peripheral (FR-DEV-14) it's read
   * back from which `declLine()` variant is present in source — the "source
   * is the source of truth" convention every other peripheral/control state
   * already uses — defaulting to `busChoices[0]` before it's ever enabled.
   */
  bus: string | null;
}

// The bus a peripheral currently resolves against (FR-DEV-14). A single-bus
// peripheral's `bus` never varies; a multi-bus peripheral's selection lives
// in source text (which declLine() variant is present), read back via its
// own codegen's busOfDeclLine — never cached or stored separately, so a
// direct source edit is picked up the same way `enabled` already is.
export function currentBusOf(source: string, id: string): string | null {
  const d = REGISTRY[id];
  if (!d) return null;
  if (d.bus) return d.bus;
  if (!d.busChoices || d.busChoices.length === 0) return null;
  const codegen = d.peripheralCodegen;
  if (codegen?.busOfDeclLine) {
    for (const line of source.split('\n')) {
      const bus = codegen.busOfDeclLine(line.replace(/\r$/, ''));
      if (bus) return bus;
    }
  }
  return d.busChoices[0]!;
}

// Registry ids for bus/connector-attached peripherals — the Peripherals
// section's own scope, symmetric with wiredControlIds() (devices/registry.ts)
// which covers the complementary pin/pins-attached set.
export function peripheralIds(): string[] {
  return Object.keys(REGISTRY).filter(id => {
    const kind = REGISTRY[id]!.attachmentKind;
    return kind === 'bus' || kind === 'connector';
  });
}

// True once `id`'s own declaration line (from its peripheralCodegen strategy)
// is present anywhere in `source` — no id/pin annotation needed, since a
// peripheral like sdcard has neither and is a singleton (never more than one
// instance).
export function isPeripheralEnabled(source: string, id: string): boolean {
  const codegen = REGISTRY[id]?.peripheralCodegen;
  if (!codegen) return false;
  return source.split('\n').some(l => codegen.isDeclLine(l.replace(/\r$/, '')));
}

export function computePeripheralDisplayStates(source: string): PeripheralDisplayState[] {
  return peripheralIds().map(id => {
    const d = REGISTRY[id]!;
    const bus = currentBusOf(source, id);
    const pins = bus ? resolveBusFootprint(bus) : [];
    return { id, label: d.label, enabled: isPeripheralEnabled(source, id), pins, bus };
  });
}
