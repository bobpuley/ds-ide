// FR-UDM-3: what the Wiring Editor's one #device-popover shows for a placed
// device — a pin-attached control or an enabled bus/connector peripheral.
// Pure (no DOM, no `vscode`) so the webview only renders the model and the
// content rules stay unit-testable, same convention as pin-overlay-state.ts.
import { REGISTRY } from '../devices/registry';
import type { WiredPin } from './wiring-panel';
import type { PeripheralDisplayState } from './peripheral-state';
import type { WiringWebviewMessage } from '../webview/messages';

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

function describeControl(id: string, wiredPins: WiredPin[]): DevicePopoverModel | null {
  const pins = wiredPins.filter(wp => wp.id === id);
  const first = pins[0];
  if (!first) return null;
  const d = REGISTRY[first.deviceType];
  if (!d) return null;
  const slots = d.pinSlots;
  const rowValue = pins
    .map((wp, i) => (slots?.[i] ? `${slots[i]}=D${wp.pinNumber}` : `D${wp.pinNumber}`))
    .join(' ');
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
  const rowValue = p.bus === 'INTERNAL'
    ? 'micro USB (INTERNAL)'
    : [p.bus, p.pins.map(rp => 'D' + rp.pin).join(', ')].filter(Boolean).join(' · ');
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
