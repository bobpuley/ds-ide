import { describe, it, expect } from 'vitest';
import { targetKey, pinDragStates, previewSlots, dragLabel } from '../../../wiring/drag-view';
import type { DropTarget } from '../../../wiring/drop-targets';

const free = (pins: number[]): DropTarget => ({ kind: 'pin', pins, conflicts: [] });
const occ: DropTarget = { kind: 'pin', pins: [15], conflicts: [{ id: 'vol', label: 'vol (Pot)', kind: 'control' }] };
const spi: DropTarget = { kind: 'lane', bus: 'SPI1', pins: [7, 8, 9, 10], conflicts: [] };
const usb: DropTarget = { kind: 'usb', bus: 'INTERNAL', pins: [], conflicts: [] };

describe('targetKey', () => {
  it('keys pin targets by start pin, lanes by bus, and the usb port once', () => {
    expect(targetKey(free([15, 16, 17]))).toBe('pin:15');
    expect(targetKey(spi)).toBe('lane:SPI1');
    expect(targetKey(usb)).toBe('usb');
  });
});

describe('pinDragStates (FR-UDM-6)', () => {
  it('marks pin-target start pins free or occupied, and lane pins with their lane key', () => {
    const m = pinDragStates([free([3]), occ, spi]);
    expect(m.get(3)).toEqual({ key: 'pin:3', state: 'free' });
    expect(m.get(15)).toEqual({ key: 'pin:15', state: 'occ' });
    expect(m.get(8)).toEqual({ key: 'lane:SPI1', state: 'lane' });
    expect(m.has(4)).toBe(false);
  });

  it('only a multi-pin target\'s start pin is a drop point', () => {
    const m = pinDragStates([free([15, 16, 17])]);
    expect(m.get(15)?.key).toBe('pin:15');
    expect(m.has(16)).toBe(false);
  });
});

describe('previewSlots', () => {
  it('labels a multi-pin footprint with the device slots', () => {
    expect([...previewSlots('rgbled', free([15, 16, 17]))]).toEqual([[15, 'R'], [16, 'G'], [17, 'B']]);
    expect([...previewSlots('encoder', free([4, 6, 11]))]).toEqual([[4, 'A'], [6, 'B'], [11, 'SW']]);
  });

  it('leaves single-pin and lane footprints unlabelled', () => {
    expect([...previewSlots('button', free([3]))]).toEqual([[3, '']]);
    expect([...previewSlots('oled', spi)]).toEqual([7, 8, 9, 10].map(p => [p, '']));
  });
});

describe('dragLabel (FR-UDM-6)', () => {
  it('names the target pins, lane or port', () => {
    expect(dragLabel(free([15, 16, 17]), true)).toEqual({ text: '→ D15 · D16 · D17', tone: 'ok' });
    expect(dragLabel(spi, true)).toEqual({ text: '→ SPI1 · D7 D8 D9 D10', tone: 'ok' });
    expect(dragLabel(usb, true)).toEqual({ text: '→ micro USB (INTERNAL)', tone: 'ok' });
  });

  it('warns about what an occupied target would replace', () => {
    expect(dragLabel(occ, true)).toEqual({ text: '⚠ replaces vol (Pot) · D15', tone: 'warn' });
  });

  it('says "not a valid target here" over the board, and nothing off it', () => {
    expect(dragLabel(null, true)).toEqual({ text: '✕ not a valid target here', tone: 'no' });
    expect(dragLabel(null, false)).toEqual({ text: '', tone: 'none' });
  });
});
