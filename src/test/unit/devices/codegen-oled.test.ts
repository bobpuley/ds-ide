import { describe, it, expect } from 'vitest';
import { oledCodegen } from '../../../devices/codegen/oled';

describe('oledCodegen (FR-DEV-14)', () => {
  it('emits a declaration line templated on the SPI1 driver by default', () => {
    const decl = oledCodegen.declLine();
    expect(decl).toContain('OledDisplay<');
    expect(decl).toContain('Spi');
  });

  it('emits a different declaration line per selected bus', () => {
    const spi = oledCodegen.declLine('SPI1');
    const i2c = oledCodegen.declLine('I2C1');
    expect(spi).not.toBe(i2c);
    expect(spi).toContain('Spi');
    expect(i2c).toContain('I2c');
  });

  it('isDeclLine recognizes every bus variant of its own declLine() output', () => {
    expect(oledCodegen.isDeclLine(oledCodegen.declLine('SPI1'))).toBe(true);
    expect(oledCodegen.isDeclLine(oledCodegen.declLine('I2C1'))).toBe(true);
    expect(oledCodegen.isDeclLine('Switch3 tgl1; // ds-ide: id=tgl1, kind=toggle, pin=5')).toBe(false);
  });

  it('busOfDeclLine reads back which bus a declaration line encodes', () => {
    expect(oledCodegen.busOfDeclLine!(oledCodegen.declLine('SPI1'))).toBe('SPI1');
    expect(oledCodegen.busOfDeclLine!(oledCodegen.declLine('I2C1'))).toBe('I2C1');
    expect(oledCodegen.busOfDeclLine!('int main() {}')).toBeNull();
  });

  it('emits init lines that call Init() on the declared instance', () => {
    const lines = oledCodegen.initLines();
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some(l => l.includes('.Init('))).toBe(true);
  });

  it('isInitLine recognizes every line initLines() produces', () => {
    for (const line of oledCodegen.initLines()) {
      expect(oledCodegen.isInitLine(line)).toBe(true);
    }
    expect(oledCodegen.isInitLine('  led1.Init(daisy::seed::D5, false);')).toBe(false);
  });
});
