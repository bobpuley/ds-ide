import { describe, it, expect } from 'vitest';
import {
  insertPeripheralIntoSource,
  removePeripheralFromSource,
  insertPeripheralInitIntoSource,
  removePeripheralInitFromSource,
  peripheralEditText,
} from '../../../wiring/peripheral-config';
import { isPeripheralEnabled, currentBusOf } from '../../../wiring/peripheral-state';

describe('insertPeripheralIntoSource (FR-DEV-11)', () => {
  it('appends a new peripherals block when none exists', () => {
    const result = insertPeripheralIntoSource('int main() {}\n', 'sdcard');
    expect(isPeripheralEnabled(result, 'sdcard')).toBe(true);
    expect(result).toContain('// ds-ide:peripherals:begin');
    expect(result).toContain('// ds-ide:peripherals:end');
  });

  it('is idempotent — enabling an already-enabled peripheral changes nothing', () => {
    const once = insertPeripheralIntoSource('int main() {}\n', 'sdcard');
    const twice = insertPeripheralIntoSource(once, 'sdcard');
    expect(twice).toBe(once);
  });

  it('does nothing for an id with no peripheralCodegen', () => {
    const source = 'int main() {}\n';
    expect(insertPeripheralIntoSource(source, 'pot')).toBe(source);
  });

  // FR-DEV-14: a multi-bus peripheral's declLine() varies by bus — enabling
  // it must be able to select which variant gets written, not always the
  // codegen's own default.
  it('passes an explicit bus through to a multi-bus peripheral\'s declLine()', () => {
    const result = insertPeripheralIntoSource('int main() {}\n', 'oled', 'I2C1');
    expect(result).toContain('SSD130xI2c128x64Driver');
    expect(result).not.toContain('SSD130x4WireSpi128x64Driver');
  });

  it('defaults a multi-bus peripheral to its codegen default bus when none is given', () => {
    const result = insertPeripheralIntoSource('int main() {}\n', 'oled');
    expect(result).toContain('SSD130x4WireSpi128x64Driver');
  });
});

describe('removePeripheralFromSource (FR-DEV-11)', () => {
  it('removes the declaration line, disabling the peripheral', () => {
    const enabled = insertPeripheralIntoSource('int main() {}\n', 'sdcard');
    const disabled = removePeripheralFromSource(enabled, 'sdcard');
    expect(isPeripheralEnabled(disabled, 'sdcard')).toBe(false);
  });
});

describe('insertPeripheralInitIntoSource / removePeripheralInitFromSource (FR-DEV-11)', () => {
  it('appends an init block containing the mount call', () => {
    const withDecl = insertPeripheralIntoSource('int main() {}\n', 'sdcard');
    const withInit = insertPeripheralInitIntoSource(withDecl, 'sdcard');
    expect(withInit).toContain('// ds-ide:peripherals:init:begin');
    expect(withInit).toContain('ds_ide_sd.Init(');
    expect(withInit).toContain('ds_ide_fatfs.Init(');
  });

  it('is idempotent — a second insert does not duplicate init lines', () => {
    const withDecl = insertPeripheralIntoSource('int main() {}\n', 'sdcard');
    const once = insertPeripheralInitIntoSource(withDecl, 'sdcard');
    const twice = insertPeripheralInitIntoSource(once, 'sdcard');
    expect(twice).toBe(once);
  });

  it('removePeripheralInitFromSource strips the init lines cleanly', () => {
    const withDecl = insertPeripheralIntoSource('int main() {}\n', 'sdcard');
    const withInit = insertPeripheralInitIntoSource(withDecl, 'sdcard');
    const removed = removePeripheralInitFromSource(withInit, 'sdcard');
    expect(removed).not.toContain('ds_ide_sd.Init(');
    expect(removed).not.toContain('ds_ide_fatfs.Init(');
  });
});

describe('peripheralEditText (FR-UDM-7)', () => {
  const src = 'int main() {}\n';

  it('without a bus, writes exactly what the checkbox path wrote (current/default bus)', () => {
    for (const id of ['sdcard', 'oled', 'midiTrs', 'midiUsb']) {
      const bus = currentBusOf(src, id) ?? undefined;
      const expected = insertPeripheralInitIntoSource(insertPeripheralIntoSource(src, id, bus), id, bus);
      expect(peripheralEditText(src, id, true)).toBe(expected);
    }
  });

  it('with a dropped lane, writes that bus\'s variant', () => {
    const expected = insertPeripheralInitIntoSource(insertPeripheralIntoSource(src, 'oled', 'I2C1'), 'oled', 'I2C1');
    expect(peripheralEditText(src, 'oled', true, 'I2C1')).toBe(expected);
    expect(peripheralEditText(src, 'oled', true, 'I2C1')).toContain('SSD130xI2c128x64Driver');
    expect(peripheralEditText(src, 'midiUsb', true, 'USB_HS_D'))
      .toBe(insertPeripheralInitIntoSource(insertPeripheralIntoSource(src, 'midiUsb', 'USB_HS_D'), 'midiUsb', 'USB_HS_D'));
  });

  it('disabling removes declaration and init regardless of bus', () => {
    const on = peripheralEditText(src, 'oled', true, 'I2C1');
    expect(peripheralEditText(on, 'oled', false))
      .toBe(removePeripheralInitFromSource(removePeripheralFromSource(on, 'oled'), 'oled'));
  });
});
