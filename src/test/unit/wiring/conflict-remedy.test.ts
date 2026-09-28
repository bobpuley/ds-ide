import { describe, it, expect } from 'vitest';
import { checkConflict, buildOccupants, formatRejection, candidateBusesFor, removeOccupantsFromSource } from '../../../wiring/conflict-remedy';
import { insertIntoSource, insertInitIntoSource, removeFromSource, removeInitFromSource } from '../../../wiring/controls-writer';
import { peripheralEditText } from '../../../wiring/peripheral-config';
import { parseControlsConvention } from '../../../controllers/controls-convention-parser';
import { isPeripheralEnabled } from '../../../wiring/peripheral-state';
import type { Occupant } from '../../../wiring/conflict-remedy';
import { PIN_DEFS } from '../../../devices/pin-table.gen';

const noAlternateBuses = () => [] as string[];

describe('checkConflict (FR-DEV-13)', () => {
  it('returns null when there is no collision', () => {
    const existing: Occupant[] = [
      { id: 'led1', label: 'led1 (LED)', kind: 'control', attachment: { kind: 'pin', pin: 20 } },
    ];
    const result = checkConflict({ kind: 'bus', bus: 'SDMMC1' }, existing, PIN_DEFS, noAlternateBuses);
    expect(result).toBeNull();
  });

  it('reports a pin conflict naming the blocking pin, signal, and control owner', () => {
    // D5 carries SDMMC1_CMD — a hand-wired LED there blocks enabling SD Card.
    const existing: Occupant[] = [
      { id: 'led1', label: 'led1 (LED)', kind: 'control', attachment: { kind: 'pin', pin: 5 } },
    ];
    const result = checkConflict({ kind: 'bus', bus: 'SDMMC1' }, existing, PIN_DEFS, noAlternateBuses);
    expect(result).not.toBeNull();
    expect(result!.blockers).toHaveLength(1);
    const blocker = result!.blockers[0]!;
    expect(blocker.kind).toBe('pin');
    if (blocker.kind === 'pin') {
      expect(blocker.pin).toBe(5);
      expect(blocker.signal).toBe('SDMMC1_CMD');
    }
    expect(blocker.occupant.label).toBe('led1 (LED)');
  });

  it('a hand-wired control blocker never receives a remedy (FR-DEV-13 guidance-only)', () => {
    const existing: Occupant[] = [
      { id: 'led1', label: 'led1 (LED)', kind: 'control', attachment: { kind: 'pin', pin: 5 } },
    ];
    const result = checkConflict({ kind: 'bus', bus: 'SDMMC1' }, existing, PIN_DEFS, noAlternateBuses);
    expect(result!.hasControlBlocker).toBe(true);
    expect(result!.remedies).toEqual([]);
  });

  it('reports a connector conflict naming the connector and owner', () => {
    const existing: Occupant[] = [
      { id: 'midiusb', label: 'MIDI USB', kind: 'peripheral', attachment: { kind: 'connector', id: 'microusb' } },
    ];
    const result = checkConflict({ kind: 'connector', id: 'microusb' }, existing, PIN_DEFS, noAlternateBuses);
    expect(result).not.toBeNull();
    expect(result!.blockers).toHaveLength(1);
    const blocker = result!.blockers[0]!;
    expect(blocker.kind).toBe('connector');
    if (blocker.kind === 'connector') expect(blocker.connectorId).toBe('microusb');
    expect(blocker.occupant.label).toBe('MIDI USB');
  });

  it('offers a one-click remedy when the blocking peripheral has a collision-free alternate bus', () => {
    // A fictional peripheral "oled" occupying D7-D10 on SPI1, with I2C1 as an
    // alternative (D11-D12) that has no collision with the SD Card candidate.
    const existing: Occupant[] = [
      { id: 'oled', label: 'OLED', kind: 'peripheral', attachment: { kind: 'bus', bus: 'SPI1' } },
    ];
    // SD Card (SDMMC1, D1-D6) doesn't actually collide with SPI1 (D7-D10) —
    // use a candidate that does collide with SPI1 to exercise the remedy path.
    const result = checkConflict(
      { kind: 'bus', bus: 'SPI1' },
      existing,
      PIN_DEFS,
      (id) => (id === 'oled' ? ['SPI1', 'I2C1'] : []),
    );
    expect(result).not.toBeNull();
    expect(result!.remedies).toHaveLength(1);
    expect(result!.remedies[0]).toMatchObject({ occupantId: 'oled', targetBus: 'I2C1' });
    expect(result!.remedies[0]!.description).toContain('OLED');
    expect(result!.remedies[0]!.description).toContain('I2C1');
  });

  it('offers no remedy when every alternate bus for the blocking peripheral also collides', () => {
    // "busy" occupies D11-D12 (I2C1) and its only alternate, D13-D14
    // (USART1... reusing a real bus name for realism), is occupied by
    // another hand-wired control.
    const existing: Occupant[] = [
      { id: 'busy', label: 'Busy Peripheral', kind: 'peripheral', attachment: { kind: 'bus', bus: 'I2C1' } },
      { id: 'btn1', label: 'btn1 (Button)', kind: 'control', attachment: { kind: 'pin', pin: 13 } },
    ];
    const result = checkConflict(
      { kind: 'bus', bus: 'I2C1' },
      existing,
      PIN_DEFS,
      (id) => (id === 'busy' ? ['I2C1', 'USART1'] : []),
    );
    expect(result).not.toBeNull();
    expect(result!.remedies).toEqual([]);
  });
});

describe('formatRejection (FR-DEV-13)', () => {
  it('names the blocking pin, signal, and owner, plus guidance for a control blocker', () => {
    const existing: Occupant[] = [
      { id: 'led1', label: 'led1 (LED)', kind: 'control', attachment: { kind: 'pin', pin: 5 } },
    ];
    const rejection = checkConflict({ kind: 'bus', bus: 'SDMMC1' }, existing, PIN_DEFS, noAlternateBuses)!;
    const message = formatRejection('SD Card', rejection);
    expect(message).toContain('SD Card');
    expect(message).toContain('D5');
    expect(message).toContain('SDMMC1_CMD');
    expect(message).toContain('led1 (LED)');
    expect(message).toMatch(/not relocated automatically|remove.*first/i);
  });

  it('includes a remedy description when one exists', () => {
    const existing: Occupant[] = [
      { id: 'oled', label: 'OLED', kind: 'peripheral', attachment: { kind: 'bus', bus: 'SPI1' } },
    ];
    const rejection = checkConflict(
      { kind: 'bus', bus: 'SPI1' },
      existing,
      PIN_DEFS,
      (id) => (id === 'oled' ? ['SPI1', 'I2C1'] : []),
    )!;
    const message = formatRejection('New Peripheral', rejection);
    expect(message).toContain('Move OLED to I2C1 instead');
  });
});

describe('buildOccupants (FR-DEV-13)', () => {
  it('builds a control occupant per wired control, and a peripheral occupant per other enabled peripheral', () => {
    const source = [
      '// ds-ide:controls:begin',
      '// ds-ide: id=led1, kind=led, pin=5',
      '// ds-ide:controls:end',
      '// ds-ide:peripherals:begin',
      '  SdmmcHandler ds_ide_sd; FatFSInterface ds_ide_fatfs;',
      '// ds-ide:peripherals:end',
    ].join('\n');
    const occupants = buildOccupants(source, 'sdcard');
    expect(occupants.some(o => o.id === 'led1' && o.kind === 'control')).toBe(true);
    // The peripheral currently being toggled ('sdcard') is excluded — it's
    // the candidate, not an existing occupant to collide against.
    expect(occupants.some(o => o.id === 'sdcard')).toBe(false);
  });

  // FR-DEV-14: oled has no static registry `bus` — its occupant attachment
  // must reflect whichever bus is actually declared in source, not a
  // registry default, or a real conflict on its I2C1 footprint would be missed.
  it('resolves a multi-bus peripheral\'s occupant attachment to its currently-declared bus, not a default', () => {
    const source = [
      '// ds-ide:peripherals:begin',
      '  OledDisplay<SSD130xI2c128x64Driver> ds_ide_oled;',
      '// ds-ide:peripherals:end',
    ].join('\n');
    const occupants = buildOccupants(source, 'sdcard');
    const oled = occupants.find(o => o.id === 'oled');
    expect(oled).toBeDefined();
    expect(oled!.attachment).toEqual({ kind: 'bus', bus: 'I2C1' });
  });

  // A new control being wired isn't toggling any peripheral, so there is
  // nothing to exclude — every enabled peripheral must count as an existing
  // occupant, or wiring a control onto a peripheral's pins would silently
  // succeed (the bug this test guards against).
  it('with no peripheral excluded, includes every enabled peripheral as an occupant', () => {
    const source = [
      '// ds-ide:peripherals:begin',
      '  SdmmcHandler ds_ide_sd; FatFSInterface ds_ide_fatfs;',
      '  OledDisplay<SSD130x4WireSpi128x64Driver> ds_ide_oled;',
      '// ds-ide:peripherals:end',
    ].join('\n');
    const occupants = buildOccupants(source);
    expect(occupants.some(o => o.id === 'sdcard')).toBe(true);
    expect(occupants.some(o => o.id === 'oled')).toBe(true);
  });
});

describe('candidateBusesFor (FR-DEV-13/14)', () => {
  it('returns the single fixed bus for a single-bus peripheral', () => {
    expect(candidateBusesFor('sdcard')).toEqual(['SDMMC1']);
  });

  it('returns every candidate bus for a multi-bus peripheral', () => {
    expect(candidateBusesFor('oled')).toEqual(['SPI1', 'I2C1']);
  });

  it('returns an empty list for an id with no bus at all', () => {
    expect(candidateBusesFor('pot')).toEqual([]);
    expect(candidateBusesFor('not-a-real-id')).toEqual([]);
  });
});

describe('removeOccupantsFromSource (FR-UDM-8)', () => {
  // Builds source text the same way the wire handler does.
  function wire(src: string, id: string, kind: 'pot' | 'button' | 'led', pin: number): string {
    const afterDecl = insertIntoSource(src, id, kind, pin);
    const pots = parseControlsConvention(afterDecl).controls.filter(c => c.kind === 'pot');
    return insertInitIntoSource(afterDecl, id, kind, pin, pots);
  }
  const base = 'int main() {}\n';

  it('a replaced control is removed exactly as Remove would remove it', () => {
    const src = wire(wire(base, 'vol', 'pot', 15), 'gain', 'pot', 16);
    const afterDecl = removeFromSource(src, 'vol');
    const pots = parseControlsConvention(afterDecl).controls.filter(c => c.kind === 'pot');
    expect(removeOccupantsFromSource(src, ['vol'])).toBe(removeInitFromSource(afterDecl, 'vol', pots));
  });

  it('clears every control on a peripheral lane so the peripheral no longer conflicts', () => {
    const src = wire(wire(base, 'b1', 'button', 11), 'l1', 'led', 12);
    expect(checkConflict({ kind: 'bus', bus: 'I2C1' }, buildOccupants(src), PIN_DEFS, candidateBusesFor)).not.toBeNull();
    const cleared = removeOccupantsFromSource(src, ['b1', 'l1']);
    expect(parseControlsConvention(cleared).controls).toEqual([]);
    expect(checkConflict({ kind: 'bus', bus: 'I2C1' }, buildOccupants(cleared), PIN_DEFS, candidateBusesFor)).toBeNull();
  });

  it('a replaced peripheral is disabled', () => {
    const src = peripheralEditText(base, 'oled', true, 'I2C1');
    const cleared = removeOccupantsFromSource(src, ['oled']);
    expect(isPeripheralEnabled(cleared, 'oled')).toBe(false);
    expect(cleared).toBe(peripheralEditText(src, 'oled', false));
  });

  it('an id that is no longer on the board changes nothing (stale replace)', () => {
    const src = wire(base, 'gain', 'pot', 15);
    expect(removeOccupantsFromSource(src, ['vol'])).toBe(src);
    // …so the host's post-removal checkConflict still sees gain on D15.
    const r = checkConflict({ kind: 'pin', pin: 15 }, buildOccupants(removeOccupantsFromSource(src, ['vol'])), PIN_DEFS, candidateBusesFor);
    expect(r?.blockers[0]?.occupant.id).toBe('gain');
  });
});
