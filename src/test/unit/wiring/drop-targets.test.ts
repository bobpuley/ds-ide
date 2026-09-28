import { describe, it, expect } from 'vitest';
import { computeDropTargets, occupancyFromSource, type DropTarget, type Occupancy } from '../../../wiring/drop-targets';
import { PIN_DEFS } from '../../../devices/pin-table.gen';
import { resolveBusFootprint } from '../../../devices/attachment';
import { REGISTRY } from '../../../devices/registry';
import { computePeripheralDisplayStates } from '../../../wiring/peripheral-state';
import type { PeripheralDisplayState } from '../../../wiring/peripheral-state';
import type { WiredPin } from '../../../wiring/wiring-panel';

const EMPTY: Occupancy = { wiredPins: [], peripherals: [] };
const assignable = PIN_DEFS.filter(d => d.pin !== null).map(d => d.pin!).sort((a, b) => a - b);
const adcPins = PIN_DEFS.filter(d => d.pin !== null && d.adc).map(d => d.pin!).sort((a, b) => a - b);

function enabled(id: string, bus: string): PeripheralDisplayState {
  return { id, label: REGISTRY[id]!.label, enabled: true, bus, pins: resolveBusFootprint(bus) };
}

function startPins(targets: DropTarget[]): number[] {
  return targets.map(t => t.pins[0]!).sort((a, b) => a - b);
}

function byStart(targets: DropTarget[], pin: number): DropTarget | undefined {
  return targets.find(t => t.kind === 'pin' && t.pins[0] === pin);
}

describe('computeDropTargets (FR-UDM-6)', () => {
  describe('single-pin controls', () => {
    it('pot targets every ADC pin, nothing else', () => {
      const t = computeDropTargets('pot', PIN_DEFS, EMPTY);
      expect(t.every(x => x.kind === 'pin' && x.pins.length === 1 && x.conflicts.length === 0)).toBe(true);
      expect(startPins(t)).toEqual(adcPins);
    });

    it.each(['button', 'led', 'toggle'])('%s targets every assignable pin on an empty board', id => {
      expect(startPins(computeDropTargets(id, PIN_DEFS, EMPTY))).toEqual(assignable);
    });

    it('an occupied pin stays a target with its occupant as the conflict', () => {
      const occ: Occupancy = { wiredPins: [{ pinNumber: 15, deviceType: 'pot', id: 'vol' }], peripherals: [] };
      const t = byStart(computeDropTargets('button', PIN_DEFS, occ), 15)!;
      expect(t.conflicts).toEqual([{ id: 'vol', label: 'vol (Pot)', kind: 'control' }]);
    });

    it('pins inside an enabled peripheral lane are not targets', () => {
      const occ: Occupancy = { wiredPins: [], peripherals: [enabled('oled', 'SPI1')] };
      const pins = startPins(computeDropTargets('led', PIN_DEFS, occ));
      for (const p of [7, 8, 9, 10]) expect(pins).not.toContain(p);
      expect(pins).toContain(11);
    });

    it('exclude treats the moving control\'s own pin as free', () => {
      const occ: Occupancy = { wiredPins: [{ pinNumber: 3, deviceType: 'button', id: 'b1' }], peripherals: [] };
      expect(byStart(computeDropTargets('button', PIN_DEFS, occ, 'b1'), 3)!.conflicts).toEqual([]);
    });
  });

  describe('multi-pin controls', () => {
    it.each(['rgbled', 'encoder'])('%s claims three pins from each start pin', id => {
      const t = computeDropTargets(id, PIN_DEFS, EMPTY);
      expect(byStart(t, 15)!.pins).toEqual([15, 16, 17]);
      // D28 is the last start with two assignable pins after it.
      expect(startPins(t).at(-1)).toBe(28);
      expect(t.every(x => x.conflicts.length === 0)).toBe(true);
    });

    it('the footprint skips occupied pins and enabled peripheral lanes', () => {
      const occ: Occupancy = {
        wiredPins: [{ pinNumber: 5, deviceType: 'button', id: 'b1' }],
        peripherals: [enabled('oled', 'SPI1')],
      };
      const t = computeDropTargets('rgbled', PIN_DEFS, occ);
      expect(byStart(t, 4)!.pins).toEqual([4, 6, 11]);
      expect(byStart(t, 5)).toBeUndefined();
      expect(byStart(t, 7)).toBeUndefined();
    });

    it('a multi-pin device with no room has no targets', () => {
      const wiredPins: WiredPin[] = assignable.slice(0, -2).map(p => ({ pinNumber: p, deviceType: 'led', id: `l${p}` }));
      expect(computeDropTargets('encoder', PIN_DEFS, { wiredPins, peripherals: [] })).toEqual([]);
    });

    it('exclude frees the moving device\'s own three pins', () => {
      const wiredPins: WiredPin[] = [15, 16, 17].map(p => ({ pinNumber: p, deviceType: 'rgbled', id: 'rgb' }));
      const t = computeDropTargets('rgbled', PIN_DEFS, { wiredPins, peripherals: [] }, 'rgb');
      expect(byStart(t, 15)!.pins).toEqual([15, 16, 17]);
    });
  });

  describe('bus peripherals', () => {
    it('sdcard has one SDMMC1 lane', () => {
      expect(computeDropTargets('sdcard', PIN_DEFS, EMPTY)).toEqual([
        { kind: 'lane', bus: 'SDMMC1', pins: [1, 2, 3, 4, 5, 6], conflicts: [] },
      ]);
    });

    it('oled has one lane per candidate bus', () => {
      const t = computeDropTargets('oled', PIN_DEFS, EMPTY);
      expect(t.map(x => [x.kind, x.bus, x.pins])).toEqual([
        ['lane', 'SPI1', [7, 8, 9, 10]],
        ['lane', 'I2C1', [11, 12]],
      ]);
    });

    it('midiTrs has one USART1 lane', () => {
      expect(computeDropTargets('midiTrs', PIN_DEFS, EMPTY).map(x => [x.kind, x.bus, x.pins]))
        .toEqual([['lane', 'USART1', [13, 14]]]);
    });

    it('midiUsb INTERNAL is the usb target; USB_HS_D is a lane', () => {
      const t = computeDropTargets('midiUsb', PIN_DEFS, EMPTY);
      expect(t.map(x => [x.kind, x.bus, x.pins])).toEqual([
        ['usb', 'INTERNAL', []],
        ['lane', 'USB_HS_D', [30, 29]],
      ]);
    });

    it('an occupied lane names every control on it, once each', () => {
      const occ: Occupancy = {
        wiredPins: [
          { pinNumber: 11, deviceType: 'button', id: 'b1' },
          { pinNumber: 12, deviceType: 'led', id: 'l1' },
        ],
        peripherals: [],
      };
      const i2c = computeDropTargets('oled', PIN_DEFS, occ).find(x => x.bus === 'I2C1')!;
      expect(i2c.conflicts).toEqual([
        { id: 'b1', label: 'b1 (Button)', kind: 'control' },
        { id: 'l1', label: 'l1 (LED)', kind: 'control' },
      ]);
    });

    it('a multi-pin control on a lane is named once', () => {
      const wiredPins: WiredPin[] = [7, 8, 9].map(p => ({ pinNumber: p, deviceType: 'encoder', id: 'enc' }));
      const spi = computeDropTargets('oled', PIN_DEFS, { wiredPins, peripherals: [] }).find(x => x.bus === 'SPI1')!;
      expect(spi.conflicts).toEqual([{ id: 'enc', label: 'enc (Encoder)', kind: 'control' }]);
    });

    it('an already-placed peripheral offers only its other buses (a move)', () => {
      const occ: Occupancy = { wiredPins: [], peripherals: [enabled('oled', 'SPI1')] };
      expect(computeDropTargets('oled', PIN_DEFS, occ).map(x => x.bus)).toEqual(['I2C1']);
      const sd: Occupancy = { wiredPins: [], peripherals: [enabled('sdcard', 'SDMMC1')] };
      expect(computeDropTargets('sdcard', PIN_DEFS, sd)).toEqual([]);
    });

    it('a disabled peripheral in the display states does not count as occupying', () => {
      const off = { ...enabled('oled', 'SPI1'), enabled: false };
      expect(computeDropTargets('oled', PIN_DEFS, { wiredPins: [], peripherals: [off] }).map(x => x.bus))
        .toEqual(['SPI1', 'I2C1']);
      expect(startPins(computeDropTargets('led', PIN_DEFS, { wiredPins: [], peripherals: [off] }))).toContain(7);
    });
  });

  it('every registry device yields at least one target on an empty board', () => {
    for (const id of Object.keys(REGISTRY)) {
      expect(computeDropTargets(id, PIN_DEFS, EMPTY).length, id).toBeGreaterThan(0);
    }
  });

  it('an unknown device has no targets', () => {
    expect(computeDropTargets('servo', PIN_DEFS, EMPTY)).toEqual([]);
  });
});

describe('occupancyFromSource', () => {
  it('reads wired controls and peripheral states from source text', () => {
    const src = [
      '// ds-ide:controls:begin',
      'RgbLed rgb1; // ds-ide: id=rgb1, kind=rgbled, pin=5, pins=5,6,7',
      '// ds-ide:controls:end',
    ].join('\n');
    const occ = occupancyFromSource(src);
    expect(occ.peripherals).toEqual(computePeripheralDisplayStates(src));
    expect(occ.wiredPins).toEqual([5, 6, 7].map(p => ({ pinNumber: p, deviceType: 'rgbled', id: 'rgb1' })));
  });
});
