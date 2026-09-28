// FR-UDM-3: what the Wiring Editor's one #device-popover shows for a placed
// device — a pin-attached control or an enabled bus/connector peripheral.
// Pure (no DOM, no `vscode`) so the webview only renders the model and the
// content rules stay unit-testable, same convention as pin-overlay-state.ts.
import { REGISTRY } from '../devices/registry';
import type { WiredPin } from './wiring-panel';
import type { PeripheralDisplayState } from './peripheral-state';
import type { WiringWebviewMessage } from '../webview/messages';
import type { DeviceType } from '../devices/registry';
import type { DropTarget } from './drop-targets';
import { defaultId } from './id-validation';

export type PopoverTarget =
  | { kind: 'control'; id: string }
  | { kind: 'peripheral'; id: string };

export interface DevicePopoverModel {
  label: string;
  accentColor: string;
  /** The control's instance id; null for a peripheral (it has none). */
  subtitle: string | null;
  rowKey: 'pin' | 'pins' | 'bus';
  rowValue: string;
  /** True only for a device with a live panel (REGISTRY hasLiveView). */
  showPanel: boolean;
  /** Exactly what today's Remove (controls) / Disable (peripherals) posts. */
  remove: WiringWebviewMessage;
}

// `R=D15 G=D16 B=D17` for a slotted multi-pin device, `D15` otherwise.
function formatPins(pins: number[], slots: string[] | undefined): string {
  return pins.map((p, i) => (slots?.[i] ? `${slots[i]}=D${p}` : `D${p}`)).join(' ');
}

function formatBus(bus: string | null, pins: number[]): string {
  return pins.length === 0
    ? `micro USB (${bus ?? ''})`
    : [bus, pins.map(p => 'D' + p).join(', ')].filter(Boolean).join(' · ');
}

function describeControl(id: string, wiredPins: WiredPin[]): DevicePopoverModel | null {
  const pins = wiredPins.filter(wp => wp.id === id);
  const first = pins[0];
  if (!first) return null;
  const d = REGISTRY[first.deviceType];
  if (!d) return null;
  const rowValue = formatPins(pins.map(wp => wp.pinNumber), d.pinSlots);
  return {
    label: d.label,
    accentColor: d.accentColor,
    subtitle: id,
    rowKey: pins.length > 1 ? 'pins' : 'pin',
    rowValue,
    showPanel: !!d.hasLiveView,
    remove: { command: 'unwirePin', pinNumber: first.pinNumber, id },
  };
}

function describePeripheral(id: string, peripherals: PeripheralDisplayState[]): DevicePopoverModel | null {
  const p = peripherals.find(pp => pp.id === id && pp.enabled);
  const d = REGISTRY[id];
  if (!p || !d) return null;
  const rowValue = formatBus(p.bus, p.pins.map(rp => rp.pin));
  return {
    label: p.label,
    accentColor: d.accentColor,
    subtitle: null,
    rowKey: 'bus',
    rowValue,
    showPanel: !!d.hasLiveView,
    remove: { command: 'setPeripheralEnabled', peripheralId: id, enabled: false },
  };
}

export function describePlacedDevice(
  target: PopoverTarget,
  wiredPins: WiredPin[],
  peripherals: PeripheralDisplayState[],
): DevicePopoverModel | null {
  return target.kind === 'control'
    ? describeControl(target.id, wiredPins)
    : describePeripheral(target.id, peripherals);
}

/** The enabled peripheral whose resolved footprint includes `pin`, if any. */
export function peripheralOwningPin(pin: number, peripherals: PeripheralDisplayState[]): string | null {
  return peripherals.find(p => p.enabled && p.pins.some(rp => rp.pin === pin))?.id ?? null;
}

// ── Placement popover (FR-UDM-7) ─────────────────────────────────────────

export interface PlacementModel {
  label: string;
  accentColor: string;
  rowKey: 'pin' | 'pins' | 'bus';
  rowValue: string;
  /** Controls get an id field; peripherals are singletons with none. */
  needsId: boolean;
  /** The id field's pre-fill (defaultId), or null for a peripheral. */
  defaultId: string | null;
  /** FR-UDM-8: labels of every device the drop would remove (conflict mode when non-empty). */
  conflicts: string[];
  /** Wired pins the id is validated against — replaced controls' ids are free again. */
  idPool: WiredPin[];
  /** The confirm button: Replace in conflict mode, Move for a placed device, else Add. */
  action: 'Add' | 'Move' | 'Replace';
}

/**
 * What the popover shows after `deviceId` is dropped on `target`. `moving`
 * is true for a placed device being dragged elsewhere (FR-UDM-9): a moved
 * control keeps its id, so it gets no id field.
 */
export function describePlacement(
  deviceId: string, target: DropTarget, wiredPins: WiredPin[], moving = false,
): PlacementModel {
  const d = REGISTRY[deviceId];
  const isControl = target.kind === 'pin';
  const askId = isControl && !moving;
  const replaced = new Set(target.conflicts.map(c => c.id));
  const idPool = wiredPins.filter(wp => !replaced.has(wp.id));
  return {
    label: d?.label ?? deviceId,
    accentColor: d?.accentColor ?? '#9cdcfe',
    rowKey: isControl ? (target.pins.length > 1 ? 'pins' : 'pin') : 'bus',
    rowValue: isControl ? formatPins(target.pins, d?.pinSlots) : formatBus(target.bus ?? null, target.pins),
    needsId: askId,
    defaultId: askId ? defaultId(deviceId as DeviceType, idPool) : null,
    conflicts: target.conflicts.map(c => c.label),
    idPool,
    action: target.conflicts.length ? 'Replace' : moving ? 'Move' : 'Add',
  };
}

/**
 * The message *Add* posts. A control is wired from its start pin (the host
 * re-derives the rest of the footprint); a peripheral is enabled on the bus
 * of the lane it was dropped on — the lane is the bus choice.
 */
export function placementMessage(
  deviceId: string, target: DropTarget, id: string | null, moveId?: string,
): WiringWebviewMessage {
  // FR-UDM-8: Replace carries the occupant ids; the host removes them in the same edit.
  const replace = target.conflicts.length ? { replace: target.conflicts.map(c => c.id) } : {};
  if (target.kind === 'pin' && moveId !== undefined) {
    // FR-UDM-9: the host re-places `moveId` from the start pin, keeping its id.
    return { command: 'moveControl', id: moveId, pinNumber: target.pins[0] ?? -1, ...replace };
  }
  if (target.kind === 'pin') {
    return { command: 'wirePin', pinNumber: target.pins[0] ?? -1, deviceType: deviceId as DeviceType, id: id ?? '', ...replace };
  }
  return { command: 'setPeripheralEnabled', peripheralId: deviceId, enabled: true, bus: target.bus, ...replace };
}
