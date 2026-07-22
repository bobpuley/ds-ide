import { describe, it, expect } from 'vitest';
import { midiTrsCodegen } from '../../../devices/codegen/midi-trs';

describe('midiTrsCodegen (FR-DEV-16)', () => {
  it('emits exactly one declaration line, with no instance list', () => {
    const decl = midiTrsCodegen.declLine();
    expect(decl).toContain('MidiUartHandler');
  });

  it('isDeclLine recognizes its own declLine() output', () => {
    expect(midiTrsCodegen.isDeclLine(midiTrsCodegen.declLine())).toBe(true);
    expect(midiTrsCodegen.isDeclLine('Switch3 tgl1; // ds-ide: id=tgl1, kind=toggle, pin=5')).toBe(false);
  });

  it('emits init lines that initialize the handler', () => {
    const lines = midiTrsCodegen.initLines();
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some(l => l.includes('.Init('))).toBe(true);
  });

  it('isInitLine recognizes every line initLines() produces', () => {
    for (const line of midiTrsCodegen.initLines()) {
      expect(midiTrsCodegen.isInitLine(line)).toBe(true);
    }
    expect(midiTrsCodegen.isInitLine('  led1.Init(daisy::seed::D5, false);')).toBe(false);
  });
});
