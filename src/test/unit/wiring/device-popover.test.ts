import { describe, it, expect } from 'vitest';
import { describePlacedDevice, peripheralOwningPin, describePlacement, placementMessage } from '../../../wiring/device-popover';
import type { DropTarget } from '../../../wiring/drop-targets';
import type { WiredPin } from '../../../wiring/wiring-panel';
import type { PeripheralDisplayState } from '../../../wiring/peripheral-state';

const wired: WiredPin[] = [
  { pinNumber: 15, deviceType: 'pot', id: 'vol' },
  { pinNumber: 20, deviceType: 'rgbled', id: 'rgb1' },
  { pinNumber: 21, deviceType: 'rgbled', id: 'rgb1' },
  { pinNumber: 22, deviceType: 'rgbled', id: 'rgb1' },
  { pinNumber: 5, deviceType: 'encoder', id: 'enc1' },
  { pinNumber: 6, deviceType: 'encoder', id: 'enc1' },
  { pinNumber: 7, deviceType: 'encoder', id: 'enc1' },
];

const periphs: PeripheralDisplayState[] = [
  { id: 'oled', label: 'OLED', enabled: true, bus: 'I2C1', pins: [{ pin: 11, signal: 'I2C1_SCL' }, { pin: 12, signal: 'I2C1_SDA' }] },
  { id: 'sdcard', label: 'SD Card', enabled: true, bus: 'SDMMC1', pins: [1, 2, 3, 4, 5, 6].map(pin => ({ pin, signal: null })) },
  { id: 'midiUsb', label: 'MIDI USB', enabled: true, bus: 'INTERNAL', pins: [] },
  { id: 'midiTrs', label: 'MIDI TRS', enabled: false, bus: 'USART1', pins: [{ pin: 13, signal: 'USART1_TX' }, { pin: 14, signal: 'USART1_RX' }] },
];

describe('describePlacedDevice (FR-UDM-3)', () => {
  it('describes a single-pin control with its id, pin and no Show panel', () => {
    const m = describePlacedDevice({ kind: 'control', id: 'vol' }, wired, periphs)!;
    expect(m.label).toBe('Pot');
    expect(m.accentColor).toBe('var(--ds-accent-pot)');
    expect(m.subtitle).toBe('vol');
    expect(m.rowKey).toBe('pin');
    expect(m.rowValue).toBe('D15');
    expect(m.showPanel).toBe(false);
    expect(m.remove).toEqual({ command: 'unwirePin', pinNumber: 15, id: 'vol' });
  });

  it('labels a multi-pin control\'s pins with registry slot names', () => {
    expect(describePlacedDevice({ kind: 'control', id: 'rgb1' }, wired, periphs)!.rowValue).toBe('R=D20 G=D21 B=D22');
    const enc = describePlacedDevice({ kind: 'control', id: 'enc1' }, wired, periphs)!;
    expect(enc.rowKey).toBe('pins');
    expect(enc.rowValue).toBe('A=D5 B=D6 SW=D7');
  });

  it('describes a bus peripheral with its bus and resolved pins; Show panel only with a live view', () => {
    const oled = describePlacedDevice({ kind: 'peripheral', id: 'oled' }, wired, periphs)!;
    expect(oled.subtitle).toBeNull();
    expect(oled.rowKey).toBe('bus');
    expect(oled.rowValue).toBe('I2C1 · D11, D12');
    expect(oled.showPanel).toBe(true);
    expect(oled.remove).toEqual({ command: 'setPeripheralEnabled', peripheralId: 'oled', enabled: false });

    const sd = describePlacedDevice({ kind: 'peripheral', id: 'sdcard' }, wired, periphs)!;
    expect(sd.showPanel).toBe(false);
  });

  it('describes a connector peripheral on INTERNAL as the micro USB port', () => {
    const m = describePlacedDevice({ kind: 'peripheral', id: 'midiUsb' }, wired, periphs)!;
    expect(m.rowValue).toBe('micro USB (INTERNAL)');
    expect(m.showPanel).toBe(true);
  });

  it('returns null for an unknown control, a disabled peripheral or an unknown id', () => {
    expect(describePlacedDevice({ kind: 'control', id: 'nope' }, wired, periphs)).toBeNull();
    expect(describePlacedDevice({ kind: 'peripheral', id: 'midiTrs' }, wired, periphs)).toBeNull();
    expect(describePlacedDevice({ kind: 'peripheral', id: 'servo' }, wired, periphs)).toBeNull();
  });
});

describe('peripheralOwningPin (FR-UDM-3)', () => {
  it('finds the enabled peripheral whose footprint contains a pin', () => {
    expect(peripheralOwningPin(11, periphs)).toBe('oled');
    expect(peripheralOwningPin(3, periphs)).toBe('sdcard');
  });

  it('ignores disabled peripherals and unowned pins', () => {
    expect(peripheralOwningPin(13, periphs)).toBeNull();
    expect(peripheralOwningPin(28, periphs)).toBeNull();
  });
});

describe('describePlacement (FR-UDM-7)', () => {
  const pin = (pins: number[]): DropTarget => ({ kind: 'pin', pins, conflicts: [] });

  it('a single-pin control shows its pin and asks for an id pre-filled by defaultId', () => {
    const m = describePlacement('pot', pin([16]), wired);
    expect(m.label).toBe('Pot');
    expect(m.accentColor).toBe('var(--ds-accent-pot)');
    expect(m.rowKey).toBe('pin');
    expect(m.rowValue).toBe('D16');
    expect(m.needsId).toBe(true);
    expect(m.defaultId).toMatch(/^pot\d+$/);
  });

  it('a multi-pin control shows slot names', () => {
    const m = describePlacement('rgbled', pin([23, 24, 25]), wired);
    expect(m.rowKey).toBe('pins');
    expect(m.rowValue).toBe('R=D23 G=D24 B=D25');
  });

  it('a peripheral shows the lane it was dropped on and needs no id', () => {
    const m = describePlacement('oled', { kind: 'lane', bus: 'I2C1', pins: [11, 12], conflicts: [] }, wired);
    expect(m.rowKey).toBe('bus');
    expect(m.rowValue).toBe('I2C1 · D11, D12');
    expect(m.needsId).toBe(false);
    expect(m.defaultId).toBeNull();
  });

  it('the usb target is described as the micro-USB connector', () => {
    const m = describePlacement('midiUsb', { kind: 'usb', bus: 'INTERNAL', pins: [], conflicts: [] }, wired);
    expect(m.rowValue).toBe('micro USB (INTERNAL)');
  });
});

describe('placementMessage (FR-UDM-7)', () => {
  it('a control drop wires its start pin with the chosen id', () => {
    expect(placementMessage('encoder', { kind: 'pin', pins: [4, 6, 11], conflicts: [] }, 'enc2'))
      .toEqual({ command: 'wirePin', pinNumber: 4, deviceType: 'encoder', id: 'enc2' });
  });

  it('a peripheral drop enables it on the lane it was dropped on', () => {
    expect(placementMessage('oled', { kind: 'lane', bus: 'I2C1', pins: [11, 12], conflicts: [] }, null))
      .toEqual({ command: 'setPeripheralEnabled', peripheralId: 'oled', enabled: true, bus: 'I2C1' });
  });
});

describe('placement conflict mode (FR-UDM-8)', () => {
  const occupied: DropTarget = { kind: 'pin', pins: [15], conflicts: [{ id: 'vol', label: 'vol (Pot)', kind: 'control' }] };
  const lane: DropTarget = {
    kind: 'lane', bus: 'I2C1', pins: [11, 12],
    conflicts: [{ id: 'b1', label: 'b1 (Button)', kind: 'control' }, { id: 'l1', label: 'l1 (LED)', kind: 'control' }],
  };

  it('names every device the drop would remove', () => {
    expect(describePlacement('button', occupied, wired).conflicts).toEqual(['vol (Pot)']);
    expect(describePlacement('oled', lane, wired).conflicts).toEqual(['b1 (Button)', 'l1 (LED)']);
    expect(describePlacement('button', { kind: 'pin', pins: [3], conflicts: [] }, wired).conflicts).toEqual([]);
  });

  it('the replaced ids are free for the new device\'s id', () => {
    expect(describePlacement('pot', occupied, wired).idPool.map(wp => wp.id)).not.toContain('vol');
  });

  it('Replace posts the occupant ids alongside the add', () => {
    expect(placementMessage('button', occupied, 'bypass'))
      .toEqual({ command: 'wirePin', pinNumber: 15, deviceType: 'button', id: 'bypass', replace: ['vol'] });
    expect(placementMessage('oled', lane, null))
      .toEqual({ command: 'setPeripheralEnabled', peripheralId: 'oled', enabled: true, bus: 'I2C1', replace: ['b1', 'l1'] });
  });
});

describe('placement move mode (FR-UDM-9)', () => {
  const to20: DropTarget = { kind: 'pin', pins: [20], conflicts: [] };

  it('the action reads Add, Move or Replace', () => {
    expect(describePlacement('pot', to20, wired).action).toBe('Add');
    expect(describePlacement('pot', to20, wired, true).action).toBe('Move');
    const occ: DropTarget = { kind: 'pin', pins: [16], conflicts: [{ id: 'gain', label: 'gain (Pot)', kind: 'control' }] };
    expect(describePlacement('pot', occ, wired, true).action).toBe('Replace');
  });

  it('a moved control keeps its id, so there is no id field', () => {
    const m = describePlacement('pot', to20, wired, true);
    expect(m.needsId).toBe(false);
    expect(m.defaultId).toBeNull();
  });

  it('a control move posts moveControl with its id (and any replaced occupants)', () => {
    expect(placementMessage('pot', to20, null, 'vol')).toEqual({ command: 'moveControl', id: 'vol', pinNumber: 20 });
    const occ: DropTarget = { kind: 'pin', pins: [16], conflicts: [{ id: 'gain', label: 'gain (Pot)', kind: 'control' }] };
    expect(placementMessage('pot', occ, null, 'vol')).toEqual({ command: 'moveControl', id: 'vol', pinNumber: 16, replace: ['gain'] });
  });

  it('a peripheral move is an enable on the new lane', () => {
    const i2c: DropTarget = { kind: 'lane', bus: 'I2C1', pins: [11, 12], conflicts: [] };
    expect(describePlacement('oled', i2c, wired, true).action).toBe('Move');
    expect(placementMessage('oled', i2c, null)).toEqual({ command: 'setPeripheralEnabled', peripheralId: 'oled', enabled: true, bus: 'I2C1' });
  });
});
