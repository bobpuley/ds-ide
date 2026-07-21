import { describe, it, expect } from 'vitest';
import {
  resolveBusFootprint,
  resolveFootprint,
  findConflicts,
  KNOWN_CONNECTORS,
  type Attachment,
  type AttachedDevice,
} from '../../../devices/attachment';
import { PIN_DEFS } from '../../../devices/pin-table.gen';

describe('resolveBusFootprint (FR-DEV-3)', () => {
  it('resolves SPI1 to its real pins/signals from the generated pin table', () => {
    const footprint = resolveBusFootprint('SPI1');
    const pins = footprint.map(f => f.pin).sort((a, b) => a - b);
    // D7 (SPI1_NSS) and D8 (SPI1_SCK) are unambiguously SPI1-only in the pin
    // table; D9/D10 also carry SPI1 among several shared alt-functions.
    expect(pins).toContain(7);
    expect(pins).toContain(8);
    expect(footprint.find(f => f.pin === 7)?.signal).toBe('SPI1_NSS');
    expect(footprint.find(f => f.pin === 8)?.signal).toBe('SPI1_SCK');
  });

  it('resolves I2C1 to a different pin set than SPI1 (bus switch re-maps the footprint)', () => {
    const spi1 = resolveBusFootprint('SPI1').map(f => f.pin).sort((a, b) => a - b);
    const i2c1 = resolveBusFootprint('I2C1').map(f => f.pin).sort((a, b) => a - b);
    expect(spi1).not.toEqual(i2c1);
    expect(i2c1).toContain(11); // D11 = I2C1_SCL
    expect(i2c1).toContain(12); // D12 = I2C1_SDA
  });

  it('returns an empty footprint for a bus name with no matching signals', () => {
    expect(resolveBusFootprint('NOPE1')).toEqual([]);
  });

  it('is recomputed on every call rather than cached — a live pinDefs edit changes the result', () => {
    const live = [...PIN_DEFS];
    const before = resolveBusFootprint('SPI1', live);
    // Simulate the pin table changing (e.g. a regeneration) by mutating the
    // array passed in — resolveBusFootprint must re-scan, not memoize.
    const withoutD7 = live.filter(d => d.pin !== 7);
    const after = resolveBusFootprint('SPI1', withoutD7);
    expect(before.some(f => f.pin === 7)).toBe(true);
    expect(after.some(f => f.pin === 7)).toBe(false);
  });
});

describe('resolveFootprint (FR-DEV-3)', () => {
  it('resolves a pin attachment to itself', () => {
    const attachment: Attachment = { kind: 'pin', pin: 15 };
    expect(resolveFootprint(attachment)).toEqual([{ pin: 15, signal: null }]);
  });

  it('resolves a pins attachment to every listed pin', () => {
    const attachment: Attachment = { kind: 'pins', pins: [3, 4] };
    expect(resolveFootprint(attachment)).toEqual([
      { pin: 3, signal: null },
      { pin: 4, signal: null },
    ]);
  });

  it('resolves a bus attachment by delegating to resolveBusFootprint', () => {
    const attachment: Attachment = { kind: 'bus', bus: 'I2C1' };
    const footprint = resolveFootprint(attachment);
    expect(footprint.map(f => f.pin).sort((a, b) => a - b)).toContain(11);
  });

  it('resolves a connector attachment to no GPIO pins', () => {
    const attachment: Attachment = { kind: 'connector', id: 'microusb' };
    expect(resolveFootprint(attachment)).toEqual([]);
  });

  it('switching a device between buses re-maps its resolved footprint', () => {
    const onSpi1: Attachment = { kind: 'bus', bus: 'SPI1' };
    const onI2c1: Attachment = { kind: 'bus', bus: 'I2C1' };
    const spiPins = resolveFootprint(onSpi1).map(f => f.pin).sort((a, b) => a - b);
    const i2cPins = resolveFootprint(onI2c1).map(f => f.pin).sort((a, b) => a - b);
    expect(spiPins).not.toEqual(i2cPins);
  });
});

describe('KNOWN_CONNECTORS (FR-DEV-3)', () => {
  it('includes the micro USB connector as an addressable attachment target', () => {
    expect(KNOWN_CONNECTORS).toContain('microusb');
  });
});

describe('findConflicts (FR-DEV-3)', () => {
  it('reports no conflicts when every device occupies distinct pins', () => {
    const devices: AttachedDevice[] = [
      { id: 'pot1', owner: 'pot1', attachment: { kind: 'pin', pin: 15 } },
      { id: 'btn1', owner: 'btn1', attachment: { kind: 'pin', pin: 20 } },
    ];
    const report = findConflicts(devices);
    expect(report.pinConflicts).toEqual([]);
    expect(report.connectorConflicts).toEqual([]);
  });

  it('reports a peripheral-to-peripheral collision naming both owners', () => {
    const devices: AttachedDevice[] = [
      { id: 'oled1', owner: 'oled1 (SSD1306)', attachment: { kind: 'bus', bus: 'SPI1' } },
      { id: 'sd1', owner: 'sd1 (MicroSD)', attachment: { kind: 'pin', pin: 7 } }, // D7 = SPI1_NSS
    ];
    const report = findConflicts(devices);
    const d7 = report.pinConflicts.find(c => c.pin === 7);
    expect(d7).toBeDefined();
    expect(d7!.owners.sort()).toEqual(['oled1 (SSD1306)', 'sd1 (MicroSD)']);
    expect(d7!.signal).toBe('SPI1_NSS');
  });

  it('reports a peripheral-to-control collision naming both owners', () => {
    const devices: AttachedDevice[] = [
      { id: 'oled1', owner: 'oled1 (SSD1306)', attachment: { kind: 'bus', bus: 'SPI1' } },
      { id: 'vol', owner: 'vol (Pot)', attachment: { kind: 'pin', pin: 8 } }, // D8 = SPI1_SCK
    ];
    const report = findConflicts(devices);
    const d8 = report.pinConflicts.find(c => c.pin === 8);
    expect(d8).toBeDefined();
    expect(d8!.owners.sort()).toEqual(['oled1 (SSD1306)', 'vol (Pot)']);
  });

  it('reports a connector collision naming both owners', () => {
    const devices: AttachedDevice[] = [
      { id: 'midi1', owner: 'midi1 (USB MIDI)', attachment: { kind: 'connector', id: 'microusb' } },
      { id: 'dfu1', owner: 'dfu1 (DFU flash)', attachment: { kind: 'connector', id: 'microusb' } },
    ];
    const report = findConflicts(devices);
    expect(report.connectorConflicts).toEqual([
      { connectorId: 'microusb', owners: ['midi1 (USB MIDI)', 'dfu1 (DFU flash)'] },
    ]);
  });

  it('does not conflict devices on different connectors or non-overlapping buses', () => {
    const devices: AttachedDevice[] = [
      { id: 'oled1', owner: 'oled1', attachment: { kind: 'bus', bus: 'SPI1' } },
      { id: 'sd1', owner: 'sd1', attachment: { kind: 'bus', bus: 'SDMMC1' } },
    ];
    const report = findConflicts(devices);
    expect(report.pinConflicts).toEqual([]);
  });

  // FR-DEV-8: a 'pins'-attachment device (e.g. rgbled's three channels) is
  // resolved to its full pin footprint the same way a single-pin device is —
  // a collision on ANY one of its pins must be reported, naming both owners.
  it('reports a collision when a single-pin device claims one of a pins-attachment device\'s three pins', () => {
    const devices: AttachedDevice[] = [
      { id: 'rgb1', owner: 'rgb1 (RGB LED)', attachment: { kind: 'pins', pins: [5, 6, 7] } },
      { id: 'btn1', owner: 'btn1 (Button)', attachment: { kind: 'pin', pin: 6 } },
    ];
    const report = findConflicts(devices);
    const d6 = report.pinConflicts.find(c => c.pin === 6);
    expect(d6).toBeDefined();
    expect(d6!.owners.sort()).toEqual(['btn1 (Button)', 'rgb1 (RGB LED)']);
    // The other two RGB pins are unaffected — not falsely reported as conflicts.
    expect(report.pinConflicts.find(c => c.pin === 5)).toBeUndefined();
    expect(report.pinConflicts.find(c => c.pin === 7)).toBeUndefined();
  });

  it('releasing the pins-attachment device (removing it from the list) clears its conflict', () => {
    const withCollision: AttachedDevice[] = [
      { id: 'rgb1', owner: 'rgb1 (RGB LED)', attachment: { kind: 'pins', pins: [5, 6, 7] } },
      { id: 'btn1', owner: 'btn1 (Button)', attachment: { kind: 'pin', pin: 6 } },
    ];
    expect(findConflicts(withCollision).pinConflicts).not.toEqual([]);

    const afterRelease: AttachedDevice[] = [
      { id: 'btn1', owner: 'btn1 (Button)', attachment: { kind: 'pin', pin: 6 } },
    ];
    expect(findConflicts(afterRelease).pinConflicts).toEqual([]);
  });
});
