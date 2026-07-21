import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { PIN_DEFS } from '../../../devices/pin-table.gen';
import { PIN_DEFS as PIN_DEFS_FROM_WIRING_PANEL } from '../../../wiring/wiring-panel';

// FR-DEV-3 — the pin/signal table is generated from the Rev4 pinout CSV
// (resources/Daisy_Seed_Rev4_Pinout.csv) rather than hand-maintained. These
// assertions mirror wiring-panel.test.ts's PIN_DEFS invariants to prove the
// generated table is byte-identical to the table it replaces.

describe('PIN_DEFS (generated)', () => {
  it('has exactly 40 entries', () => {
    expect(PIN_DEFS).toHaveLength(40);
  });

  it('has 20 left-side and 20 right-side entries', () => {
    expect(PIN_DEFS.filter(d => d.side === 'L')).toHaveLength(20);
    expect(PIN_DEFS.filter(d => d.side === 'R')).toHaveLength(20);
  });

  it('contains all D0-D30 exactly once', () => {
    const pins = PIN_DEFS.filter(d => d.pin !== null).map(d => d.pin as number);
    for (let p = 0; p <= 30; p++) {
      expect(pins.filter(x => x === p)).toHaveLength(1);
    }
  });

  it('marks D15-D25 (A0-A10) and D28 (A11) as ADC-capable', () => {
    const adcPins = PIN_DEFS.filter(d => d.adc).map(d => d.pin);
    for (let p = 15; p <= 25; p++) expect(adcPins).toContain(p);
    expect(adcPins).toContain(28);
  });

  it('does not mark D0-D14, D26, D27, D29, D30 as ADC-capable', () => {
    const nonAdcDigital = PIN_DEFS.filter(d => d.pin !== null && !d.adc).map(d => d.pin as number);
    for (let p = 0; p <= 14; p++) expect(nonAdcDigital).toContain(p);
    expect(nonAdcDigital).toContain(26);
    expect(nonAdcDigital).toContain(27);
    expect(nonAdcDigital).toContain(29);
    expect(nonAdcDigital).toContain(30);
  });

  it('D26 is not ADC-capable and D28 is A11', () => {
    const d26 = PIN_DEFS.find(d => d.pin === 26)!;
    const d28 = PIN_DEFS.find(d => d.pin === 28)!;
    expect(d26.adc).toBe(false);
    expect(d26.aLabel).toBeNull();
    expect(d28.adc).toBe(true);
    expect(d28.aLabel).toBe('A11');
  });

  it('left row 0 is D0, right row 3 is D30 (AC-57 ordering preserved)', () => {
    const left = PIN_DEFS.filter(d => d.side === 'L').sort((a, b) => a.row - b.row);
    const right = PIN_DEFS.filter(d => d.side === 'R').sort((a, b) => a.row - b.row);
    expect(left[0]).toMatchObject({ label: 'D0', pin: 0 });
    expect(right[0]).toMatchObject({ label: 'GND', pin: null });
    expect(right[3]).toMatchObject({ label: 'D30', pin: 30 });
  });

  it('carries per-pin I2C/UART/SPI/SDMMC bus signal names', () => {
    const d11 = PIN_DEFS.find(d => d.pin === 11)!; // I2C1_SCL
    expect(d11.i2c).toContain('I2C1_SCL');
    const d13 = PIN_DEFS.find(d => d.pin === 13)!; // USART1_TX
    expect(d13.uart).toContain('USART1_TX');
    const d7 = PIN_DEFS.find(d => d.pin === 7)!; // SPI1_NSS
    expect(d7.spi).toContain('SPI1_NSS');
    const d1 = PIN_DEFS.find(d => d.pin === 1)!; // SDMMC1_D3 (SCH name)
    expect(d1.sdmmc).toBe('SDMMC1_D3');
  });

  it('has no bus signals for non-GPIO/power pins', () => {
    const gnd = PIN_DEFS.find(d => d.label === 'GND')!;
    expect(gnd.i2c).toBeNull();
    expect(gnd.uart).toBeNull();
    expect(gnd.spi).toBeNull();
    expect(gnd.sdmmc).toBeNull();
  });

  it('carries a do-not-edit header on the generated module', () => {
    const src = readFileSync(join(__dirname, '../../../devices/pin-table.gen.ts'), 'utf8');
    expect(src).toMatch(/GENERATED FILE.*DO NOT EDIT/i);
  });
});

describe('wiring-panel.ts', () => {
  it('imports PIN_DEFS from the generated table rather than a hand-maintained literal', () => {
    expect(PIN_DEFS_FROM_WIRING_PANEL).toBe(PIN_DEFS);
  });
});
