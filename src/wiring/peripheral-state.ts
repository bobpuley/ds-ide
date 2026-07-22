// Pure reducer from (effect source text) to per-peripheral display state for
// the Wiring Editor's Peripherals section (FR-DEV-11) — no DOM access, no
// vscode import, so it's unit-testable directly. Mirrors wired-pin-state.ts's
// role for pin-attached devices; a peripheral's *enabled* state has the same
// source-of-truth convention every pin-attached device already uses — the
// effect source text itself, not workspaceState or a YAML file (see
// peripheral-config.ts for the writer side).
import { REGISTRY } from '../devices/registry';
import { resolveBusFootprint } from '../devices/attachment';

export interface PeripheralDisplayState {
  id: string;
  label: string;
  enabled: boolean;
  /** Resolved pin footprint (FR-DEV-3) — empty for a connector-attached peripheral. */
  pins: number[];
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
    const pins = d.bus ? resolveBusFootprint(d.bus).map(r => r.pin) : [];
    return { id, label: d.label, enabled: isPeripheralEnabled(source, id), pins };
  });
}
