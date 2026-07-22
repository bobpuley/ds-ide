import { describe, it, expect } from 'vitest';
import {
  peripheralIds,
  isPeripheralEnabled,
  computePeripheralDisplayStates,
} from '../../../wiring/peripheral-state';

describe('peripheralIds (FR-DEV-11)', () => {
  it('includes sdcard', () => {
    expect(peripheralIds()).toContain('sdcard');
  });

  it('excludes every pin/pins-attached device', () => {
    const ids = peripheralIds();
    expect(ids).not.toContain('pot');
    expect(ids).not.toContain('button');
    expect(ids).not.toContain('led');
    expect(ids).not.toContain('toggle');
    expect(ids).not.toContain('rgbled');
    expect(ids).not.toContain('encoder');
  });
});

describe('isPeripheralEnabled (FR-DEV-11)', () => {
  it('is false when the peripheral declaration is absent', () => {
    expect(isPeripheralEnabled('void Init() {}', 'sdcard')).toBe(false);
  });

  it('is true once the peripheral declaration line is present', () => {
    const source = [
      '// ds-ide:peripherals:begin',
      '  SdmmcHandler ds_ide_sd; FatFSInterface ds_ide_fatfs;',
      '// ds-ide:peripherals:end',
    ].join('\n');
    expect(isPeripheralEnabled(source, 'sdcard')).toBe(true);
  });

  it('is false for an unknown peripheral id', () => {
    expect(isPeripheralEnabled('anything', 'not-a-real-id')).toBe(false);
  });
});

describe('computePeripheralDisplayStates (FR-DEV-11)', () => {
  it('reports sdcard disabled with its resolved SDMMC1 footprint (pin + signal) when absent from source', () => {
    const states = computePeripheralDisplayStates('void Init() {}');
    const sd = states.find(s => s.id === 'sdcard');
    expect(sd).toBeDefined();
    expect(sd!.enabled).toBe(false);
    expect(sd!.label).toBe('SD Card');
    const pins = [...sd!.pins].sort((a, b) => a.pin - b.pin);
    expect(pins.map(p => p.pin)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(pins.find(p => p.pin === 5)!.signal).toBe('SDMMC1_CMD');
  });

  it('reports sdcard enabled once its declaration is present in source', () => {
    const source = [
      '// ds-ide:peripherals:begin',
      '  SdmmcHandler ds_ide_sd; FatFSInterface ds_ide_fatfs;',
      '// ds-ide:peripherals:end',
    ].join('\n');
    const states = computePeripheralDisplayStates(source);
    expect(states.find(s => s.id === 'sdcard')!.enabled).toBe(true);
  });

  // FR-DEV-14: oled is the first peripheral with more than one candidate
  // bus, so its current bus must be read back from which declLine() variant
  // is present in source — never a static registry field, since there isn't
  // one to read.
  it('defaults oled to its first bus choice (SPI1) when never enabled', () => {
    const states = computePeripheralDisplayStates('void Init() {}');
    const oled = states.find(s => s.id === 'oled');
    expect(oled).toBeDefined();
    expect(oled!.enabled).toBe(false);
    expect(oled!.bus).toBe('SPI1');
    const pins = [...oled!.pins].sort((a, b) => a.pin - b.pin);
    expect(pins.map(p => p.pin)).toEqual([7, 8, 9, 10]);
  });

  it('reads back I2C1 as oled\'s current bus once its I2C1 declaration is present', () => {
    const source = [
      '// ds-ide:peripherals:begin',
      '  OledDisplay<SSD130xI2c128x64Driver> ds_ide_oled;',
      '// ds-ide:peripherals:end',
    ].join('\n');
    const states = computePeripheralDisplayStates(source);
    const oled = states.find(s => s.id === 'oled')!;
    expect(oled.enabled).toBe(true);
    expect(oled.bus).toBe('I2C1');
    const pins = [...oled.pins].sort((a, b) => a.pin - b.pin);
    expect(pins.map(p => p.pin)).toEqual([11, 12]);
  });

  // FR-DEV-17: midiUsb's mode selection lives in its init line (the declared
  // type is mode-invariant, unlike oled's bus-specific template type) — its
  // 'INTERNAL' default resolves to zero pins (the micro USB connector,
  // modeled as a zero-pin pseudo-bus rather than a true connector kind).
  it('defaults midiUsb to INTERNAL (zero pins) when never enabled', () => {
    const states = computePeripheralDisplayStates('void Init() {}');
    const midiUsb = states.find(s => s.id === 'midiUsb');
    expect(midiUsb).toBeDefined();
    expect(midiUsb!.enabled).toBe(false);
    expect(midiUsb!.bus).toBe('INTERNAL');
    expect(midiUsb!.pins).toEqual([]);
  });

  it('reads back USB_HS_D (D29/D30) as midiUsb\'s current mode once its EXTERNAL init line is present', () => {
    const source = [
      '// ds-ide:peripherals:begin',
      '  MidiUsbHandler ds_ide_midi_usb;',
      '// ds-ide:peripherals:end',
      '// ds-ide:peripherals:init:begin',
      '  MidiUsbHandler::Config ds_ide_midi_usb_cfg;',
      '  ds_ide_midi_usb_cfg.transport_config.periph = MidiUsbTransport::Config::EXTERNAL;',
      '  ds_ide_midi_usb.Init(ds_ide_midi_usb_cfg);',
      '// ds-ide:peripherals:init:end',
    ].join('\n');
    const states = computePeripheralDisplayStates(source);
    const midiUsb = states.find(s => s.id === 'midiUsb')!;
    expect(midiUsb.enabled).toBe(true);
    expect(midiUsb.bus).toBe('USB_HS_D');
    const pins = [...midiUsb.pins].sort((a, b) => a.pin - b.pin);
    expect(pins.map(p => p.pin)).toEqual([29, 30]);
  });
});
