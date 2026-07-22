import { describe, it, expect } from 'vitest';
import { checkConflict, buildOccupants, formatRejection } from '../../../wiring/conflict-remedy';
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
});
