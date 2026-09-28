// FR-UDM-6: what the Wiring Editor paints while a device is being dragged,
// derived from computeDropTargets()' output. Pure (no DOM) so the rules stay
// unit-testable; wiring-webview.ts only applies the result to the SVG.
import { REGISTRY } from '../devices/registry';
import type { DropTarget } from './drop-targets';

/** Stable id for a target — stamped on the SVG element that accepts it. */
export function targetKey(t: DropTarget): string {
  if (t.kind === 'usb') return 'usb';
  if (t.kind === 'lane') return `lane:${t.bus ?? ''}`;
  return `pin:${t.pins[0] ?? ''}`;
}

export interface PinDragState {
  key: string;
  /** free / occ = a pin target's start pin; lane = a pin inside a lane target. */
  state: 'free' | 'occ' | 'lane';
}

/** Per pin, the target it accepts a drop for. Pins absent from the map are dimmed. */
export function pinDragStates(targets: DropTarget[]): Map<number, PinDragState> {
  const m = new Map<number, PinDragState>();
  for (const t of targets) {
    const key = targetKey(t);
    if (t.kind === 'pin') {
      const start = t.pins[0];
      if (start !== undefined) m.set(start, { key, state: t.conflicts.length ? 'occ' : 'free' });
    } else {
      for (const p of t.pins) m.set(p, { key, state: 'lane' });
    }
  }
  return m;
}

/** The footprint a hovered target would claim, each pin with its slot name ('' if none). */
export function previewSlots(deviceId: string, t: DropTarget): Map<number, string> {
  const slots = t.kind === 'pin' ? REGISTRY[deviceId]?.pinSlots : undefined;
  return new Map(t.pins.map((p, i) => [p, slots?.[i] ?? '']));
}

export interface DragLabel {
  text: string;
  tone: 'ok' | 'warn' | 'no' | 'none';
}

/** The label that follows the cursor: the target's pins/bus, or why there is none. */
export function dragLabel(t: DropTarget | null, overBoard: boolean): DragLabel {
  if (!t) return overBoard ? { text: '✕ not a valid target here', tone: 'no' } : { text: '', tone: 'none' };
  const where = t.kind === 'usb'
    ? 'micro USB (INTERNAL)'
    : t.kind === 'lane'
      ? `${t.bus ?? ''} · ${t.pins.map(p => 'D' + p).join(' ')}`
      : t.pins.map(p => 'D' + p).join(' · ');
  return t.conflicts.length
    ? { text: `⚠ replaces ${t.conflicts.map(c => c.label).join(', ')} · ${where}`, tone: 'warn' }
    : { text: `→ ${where}`, tone: 'ok' };
}
