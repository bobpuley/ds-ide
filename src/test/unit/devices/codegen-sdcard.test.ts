import { describe, it, expect } from 'vitest';
import { sdcardCodegen } from '../../../devices/codegen/sdcard';

describe('sdcardCodegen (FR-DEV-10)', () => {
  it('emits exactly one declaration line, with no instance list', () => {
    const decl = sdcardCodegen.declLine();
    expect(decl).toContain('SdmmcHandler');
    expect(decl).toContain('FatFSInterface');
  });

  it('isDeclLine recognizes its own declLine() output', () => {
    expect(sdcardCodegen.isDeclLine(sdcardCodegen.declLine())).toBe(true);
    expect(sdcardCodegen.isDeclLine('Switch3 tgl1; // ds-ide: id=tgl1, kind=toggle, pin=5')).toBe(false);
  });

  it('emits init lines that mount the FatFS interface', () => {
    const lines = sdcardCodegen.initLines();
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some(l => l.includes('.Init('))).toBe(true);
  });

  it('isInitLine recognizes every line initLines() produces', () => {
    for (const line of sdcardCodegen.initLines()) {
      expect(sdcardCodegen.isInitLine(line)).toBe(true);
    }
    expect(sdcardCodegen.isInitLine('  led1.Init(daisy::seed::D5, false);')).toBe(false);
  });
});
