import { describe, it, expect } from 'vitest';
import { midiUsbCodegen } from '../../../devices/codegen/midi-usb';

describe('midiUsbCodegen (FR-DEV-17)', () => {
  it('emits one mode-invariant declaration line regardless of bus argument', () => {
    const decl = midiUsbCodegen.declLine('INTERNAL');
    expect(decl).toContain('MidiUsbHandler');
    expect(decl).toBe(midiUsbCodegen.declLine('USB_HS_D'));
    expect(decl).toBe(midiUsbCodegen.declLine());
  });

  it('isDeclLine recognizes its own declLine() output', () => {
    expect(midiUsbCodegen.isDeclLine(midiUsbCodegen.declLine())).toBe(true);
    expect(midiUsbCodegen.isDeclLine('OledDisplay<SSD130x4WireSpi128x64Driver> ds_ide_oled;')).toBe(false);
  });

  it('initLines(INTERNAL) configures the internal USB FS peripheral', () => {
    const lines = midiUsbCodegen.initLines('INTERNAL');
    expect(lines.join('\n')).toContain('MidiUsbTransport::Config::INTERNAL');
    expect(lines.some(l => l.includes('.Init('))).toBe(true);
  });

  it('initLines(USB_HS_D) configures the external USB HS peripheral', () => {
    const lines = midiUsbCodegen.initLines('USB_HS_D');
    expect(lines.join('\n')).toContain('MidiUsbTransport::Config::EXTERNAL');
    expect(lines.some(l => l.includes('.Init('))).toBe(true);
  });

  it('isInitLine recognizes every line initLines() produces for either mode', () => {
    for (const bus of ['INTERNAL', 'USB_HS_D']) {
      for (const line of midiUsbCodegen.initLines(bus)) {
        expect(midiUsbCodegen.isInitLine(line)).toBe(true);
      }
    }
    expect(midiUsbCodegen.isInitLine('  led1.Init(daisy::seed::D5, false);')).toBe(false);
  });

  it('busOfDeclLine reads the mode back from an INTERNAL init line', () => {
    const lines = midiUsbCodegen.initLines('INTERNAL');
    const modeLine = lines.find(l => midiUsbCodegen.busOfDeclLine!(l) !== null);
    expect(modeLine).toBeDefined();
    expect(midiUsbCodegen.busOfDeclLine!(modeLine!)).toBe('INTERNAL');
  });

  it('busOfDeclLine reads the mode back from a USB_HS_D init line', () => {
    const lines = midiUsbCodegen.initLines('USB_HS_D');
    const modeLine = lines.find(l => midiUsbCodegen.busOfDeclLine!(l) !== null);
    expect(modeLine).toBeDefined();
    expect(midiUsbCodegen.busOfDeclLine!(modeLine!)).toBe('USB_HS_D');
  });

  it('busOfDeclLine returns null for an unrelated line', () => {
    expect(midiUsbCodegen.busOfDeclLine!('  MidiUsbHandler ds_ide_midi_usb;')).toBeNull();
  });

  // FR-EXT-31: unrecognized mode is structurally-impossible input (only
  // registry.ts's own busChoices should ever reach here) — throws instead
  // of silently falling back to the default mode.
  it('initLines throws a descriptive error for an unrecognized mode', () => {
    expect(() => midiUsbCodegen.initLines('BLUETOOTH')).toThrow(/BLUETOOTH/);
  });
});
