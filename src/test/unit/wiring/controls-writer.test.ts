import { describe, it, expect } from 'vitest';
import {
  declarationLine,
  insertIntoSource,
  removeFromSource,
  insertInitIntoSource,
  removeInitFromSource,
} from '../../../wiring/controls-writer';

// ── declarationLine ──────────────────────────────────────────────────────────

describe('declarationLine', () => {
  it('generates pot declaration', () => {
    expect(declarationLine('vol', 'pot', 15))
      .toBe('AdcChannelConfig vol; // ds-ide: id=vol, kind=pot, pin=15');
  });

  it('generates button declaration', () => {
    expect(declarationLine('btn1', 'button', 28))
      .toBe('Switch btn1; // ds-ide: id=btn1, kind=button, pin=28');
  });

  it('generates led declaration', () => {
    expect(declarationLine('led1', 'led', 23))
      .toBe('Led led1; // ds-ide: id=led1, kind=led, pin=23');
  });
});

// ── insertIntoSource ─────────────────────────────────────────────────────────

const WITH_BLOCK = [
  '#include "daisy_seed.h"',
  '// ds-ide:controls:begin',
  'AdcChannelConfig vol; // ds-ide: id=vol, kind=pot, pin=15',
  '// ds-ide:controls:end',
  'int main() { return 0; }',
].join('\n');

const NO_BLOCK = [
  '#include "daisy_seed.h"',
  'int main() { return 0; }',
].join('\n');

describe('insertIntoSource — block present', () => {
  it('inserts new declaration before end marker', () => {
    const result = insertIntoSource(WITH_BLOCK, 'btn1', 'button', 28);
    const lines  = result.split('\n');
    const endIdx = lines.indexOf('// ds-ide:controls:end');
    const begIdx = lines.indexOf('// ds-ide:controls:begin');
    const btnIdx = lines.findIndex(l => l.includes('id=btn1'));
    expect(btnIdx).toBeGreaterThan(begIdx);
    expect(btnIdx).toBeLessThan(endIdx);
  });

  it('preserves existing declarations', () => {
    const result = insertIntoSource(WITH_BLOCK, 'led1', 'led', 23);
    expect(result).toContain('id=vol');
    expect(result).toContain('id=led1');
  });

  it('inserted line has correct format', () => {
    const result = insertIntoSource(WITH_BLOCK, 'btn1', 'button', 28);
    expect(result).toContain('Switch btn1; // ds-ide: id=btn1, kind=button, pin=28');
  });
});

describe('insertIntoSource — block absent', () => {
  it('creates the begin and end markers', () => {
    const result = insertIntoSource(NO_BLOCK, 'vol', 'pot', 15);
    expect(result).toContain('// ds-ide:controls:begin');
    expect(result).toContain('// ds-ide:controls:end');
  });

  it('declaration is between markers', () => {
    const result = insertIntoSource(NO_BLOCK, 'vol', 'pot', 15);
    const lines  = result.split('\n');
    const begIdx = lines.indexOf('// ds-ide:controls:begin');
    const endIdx = lines.indexOf('// ds-ide:controls:end');
    const volIdx = lines.findIndex(l => l.includes('id=vol'));
    expect(volIdx).toBeGreaterThan(begIdx);
    expect(volIdx).toBeLessThan(endIdx);
  });

  it('original source content is preserved', () => {
    const result = insertIntoSource(NO_BLOCK, 'vol', 'pot', 15);
    expect(result).toContain('#include "daisy_seed.h"');
    expect(result).toContain('int main()');
  });
});

describe('insertIntoSource — malformed block (end before begin)', () => {
  it('treats it as absent and appends', () => {
    const source = '// ds-ide:controls:end\n// ds-ide:controls:begin\n';
    const result = insertIntoSource(source, 'vol', 'pot', 15);
    // Should have a complete block appended
    const lines = result.split('\n');
    const begs = lines.filter(l => l === '// ds-ide:controls:begin');
    expect(begs.length).toBeGreaterThanOrEqual(1);
    expect(result).toContain('id=vol');
  });
});

describe('insertIntoSource — CRLF line endings', () => {
  it('handles CRLF markers', () => {
    const source = '#include "a.h"\r\n// ds-ide:controls:begin\r\n// ds-ide:controls:end\r\n';
    const result = insertIntoSource(source, 'vol', 'pot', 15);
    expect(result).toContain('id=vol');
  });
});

// ── removeFromSource ─────────────────────────────────────────────────────────

const WITH_TWO = [
  '// ds-ide:controls:begin',
  'AdcChannelConfig vol; // ds-ide: id=vol, kind=pot, pin=15',
  'Switch btn1; // ds-ide: id=btn1, kind=button, pin=28',
  '// ds-ide:controls:end',
].join('\n');

describe('removeFromSource', () => {
  it('removes declaration by id', () => {
    const result = removeFromSource(WITH_TWO, 'vol');
    expect(result).not.toContain('id=vol');
  });

  it('preserves other declarations', () => {
    const result = removeFromSource(WITH_TWO, 'vol');
    expect(result).toContain('id=btn1');
  });

  it('removes only the target id when removing second', () => {
    const result = removeFromSource(WITH_TWO, 'btn1');
    expect(result).not.toContain('id=btn1');
    expect(result).toContain('id=vol');
  });

  it('is a no-op when id not found', () => {
    const result = removeFromSource(WITH_TWO, 'notexist');
    expect(result).toBe(WITH_TWO);
  });

  it('preserves begin/end markers', () => {
    const result = removeFromSource(WITH_TWO, 'vol');
    expect(result).toContain('// ds-ide:controls:begin');
    expect(result).toContain('// ds-ide:controls:end');
  });
});

// ── insertInitIntoSource ──────────────────────────────────────────────────────

const SOURCE_NO_INIT = [
  '// ds-ide:controls:begin',
  'AdcChannelConfig pot1; // ds-ide: id=pot1, kind=pot, pin=15',
  '// ds-ide:controls:end',
].join('\n');

const SOURCE_WITH_INIT = [
  '// ds-ide:controls:begin',
  'AdcChannelConfig pot1; // ds-ide: id=pot1, kind=pot, pin=15',
  '// ds-ide:controls:end',
  '// ds-ide:controls:init:begin',
  '  pot1.InitSingle(daisy::seed::A0);',
  '  hardware.adc.Init(pot1, 1);',
  '// ds-ide:controls:init:end',
].join('\n');

describe('insertInitIntoSource — init block absent', () => {
  it('creates the init block after the declaration end marker', () => {
    const result = insertInitIntoSource(SOURCE_NO_INIT, 'pot1', 'pot', 15, [{ id: 'pot1' }]);
    expect(result).toContain('// ds-ide:controls:init:begin');
    expect(result).toContain('// ds-ide:controls:init:end');
    const lines = result.split('\n');
    const initBeg = lines.indexOf('// ds-ide:controls:init:begin');
    const declEnd = lines.indexOf('// ds-ide:controls:end');
    expect(initBeg).toBeGreaterThan(declEnd);
  });

  it('pot: writes InitSingle with correct analog index', () => {
    const result = insertInitIntoSource(SOURCE_NO_INIT, 'pot1', 'pot', 15, [{ id: 'pot1' }]);
    expect(result).toContain('  pot1.InitSingle(daisy::seed::A0);');
  });

  it('pot: writes hardware.adc.Init with varname and count', () => {
    const result = insertInitIntoSource(SOURCE_NO_INIT, 'pot1', 'pot', 15, [{ id: 'pot1' }]);
    expect(result).toContain('  hardware.adc.Init(pot1, 1);');
  });

  it('button: writes Init with D-pin and AudioCallbackRate', () => {
    const src = [
      '// ds-ide:controls:begin',
      'Switch btn1; // ds-ide: id=btn1, kind=button, pin=28',
      '// ds-ide:controls:end',
    ].join('\n');
    const result = insertInitIntoSource(src, 'btn1', 'button', 28, []);
    expect(result).toContain('  btn1.Init(daisy::seed::D28, hardware.AudioCallbackRate());');
    expect(result).not.toContain('hardware.adc.Init');
  });

  it('led: writes Init with D-pin and false', () => {
    const src = [
      '// ds-ide:controls:begin',
      'Led led1; // ds-ide: id=led1, kind=led, pin=23',
      '// ds-ide:controls:end',
    ].join('\n');
    const result = insertInitIntoSource(src, 'led1', 'led', 23, []);
    expect(result).toContain('  led1.Init(daisy::seed::D23, false);');
  });
});

describe('insertInitIntoSource — init block present', () => {
  it('appends new pot InitSingle before existing adc.Init', () => {
    const src = [
      '// ds-ide:controls:begin',
      'AdcChannelConfig pot1; // ds-ide: id=pot1, kind=pot, pin=15',
      'AdcChannelConfig pot2; // ds-ide: id=pot2, kind=pot, pin=16',
      '// ds-ide:controls:end',
      '// ds-ide:controls:init:begin',
      '  pot1.InitSingle(daisy::seed::A0);',
      '  hardware.adc.Init(pot1, 1);',
      '// ds-ide:controls:init:end',
    ].join('\n');
    const result = insertInitIntoSource(src, 'pot2', 'pot', 16, [{ id: 'pot1' }, { id: 'pot2' }]);
    const lines = result.split('\n');
    const initBeg = lines.indexOf('// ds-ide:controls:init:begin');
    const initEnd = lines.indexOf('// ds-ide:controls:init:end');
    const pot1Idx = lines.findIndex(l => l.includes('pot1.InitSingle'));
    const pot2Idx = lines.findIndex(l => l.includes('pot2.InitSingle'));
    const adcIdx  = lines.findIndex(l => l.includes('hardware.adc.Init'));
    expect(pot1Idx).toBeGreaterThan(initBeg);
    expect(pot2Idx).toBeGreaterThan(initBeg);
    expect(adcIdx).toBeGreaterThan(pot1Idx);
    expect(adcIdx).toBeGreaterThan(pot2Idx);
    expect(adcIdx).toBeLessThan(initEnd);
    expect(result).toContain('  hardware.adc.Init(pot1, pot2, 2);');
  });

  it('adds button inside existing block without touching adc.Init', () => {
    const result = insertInitIntoSource(SOURCE_WITH_INIT, 'btn1', 'button', 28, [{ id: 'pot1' }]);
    expect(result).toContain('  btn1.Init(daisy::seed::D28, hardware.AudioCallbackRate());');
    expect(result).toContain('  hardware.adc.Init(pot1, 1);');
  });

  it('does not duplicate init block markers', () => {
    const result = insertInitIntoSource(SOURCE_WITH_INIT, 'btn1', 'button', 28, [{ id: 'pot1' }]);
    const begs = result.split('\n').filter(l => l === '// ds-ide:controls:init:begin');
    const ends = result.split('\n').filter(l => l === '// ds-ide:controls:init:end');
    expect(begs).toHaveLength(1);
    expect(ends).toHaveLength(1);
  });

  it('analog index A5 for pin 20', () => {
    const src = '// ds-ide:controls:begin\n// ds-ide:controls:end\n';
    const result = insertInitIntoSource(src, 'vol', 'pot', 20, [{ id: 'vol' }]);
    expect(result).toContain('  vol.InitSingle(daisy::seed::A5);');
  });

  it('analog index A6 for pin 21', () => {
    const src = '// ds-ide:controls:begin\n// ds-ide:controls:end\n';
    const result = insertInitIntoSource(src, 'vol', 'pot', 21, [{ id: 'vol' }]);
    expect(result).toContain('  vol.InitSingle(daisy::seed::A6);');
  });
});

// ── removeInitFromSource ──────────────────────────────────────────────────────

const WITH_TWO_INIT = [
  '// ds-ide:controls:begin',
  'AdcChannelConfig pot1; // ds-ide: id=pot1, kind=pot, pin=15',
  'Switch btn1; // ds-ide: id=btn1, kind=button, pin=28',
  '// ds-ide:controls:end',
  '// ds-ide:controls:init:begin',
  '  pot1.InitSingle(daisy::seed::A0);',
  '  btn1.Init(daisy::seed::D28, hardware.AudioCallbackRate());',
  '  hardware.adc.Init(pot1, 1);',
  '// ds-ide:controls:init:end',
].join('\n');

describe('removeInitFromSource', () => {
  it('removes the pot init line by id', () => {
    const result = removeInitFromSource(WITH_TWO_INIT, 'pot1', []);
    expect(result).not.toContain('pot1.InitSingle');
  });

  it('removes hardware.adc.Init when last pot is removed', () => {
    const result = removeInitFromSource(WITH_TWO_INIT, 'pot1', []);
    expect(result).not.toContain('hardware.adc.Init');
  });

  it('updates hardware.adc.Init when one of multiple pots is removed', () => {
    const src = [
      '// ds-ide:controls:begin',
      'AdcChannelConfig pot1; // ds-ide: id=pot1, kind=pot, pin=15',
      'AdcChannelConfig pot2; // ds-ide: id=pot2, kind=pot, pin=16',
      '// ds-ide:controls:end',
      '// ds-ide:controls:init:begin',
      '  pot1.InitSingle(daisy::seed::A0);',
      '  pot2.InitSingle(daisy::seed::A1);',
      '  hardware.adc.Init(pot1, pot2, 2);',
      '// ds-ide:controls:init:end',
    ].join('\n');
    const result = removeInitFromSource(src, 'pot1', [{ id: 'pot2' }]);
    expect(result).not.toContain('pot1.InitSingle');
    expect(result).toContain('  pot2.InitSingle(daisy::seed::A1);');
    expect(result).toContain('  hardware.adc.Init(pot2, 1);');
  });

  it('removes button init line and preserves other lines', () => {
    const result = removeInitFromSource(WITH_TWO_INIT, 'btn1', [{ id: 'pot1' }]);
    expect(result).not.toContain('btn1.Init');
    expect(result).toContain('  pot1.InitSingle(daisy::seed::A0);');
    expect(result).toContain('  hardware.adc.Init(pot1, 1);');
  });

  it('is a no-op when init block is absent', () => {
    const src = '// ds-ide:controls:begin\n// ds-ide:controls:end\n';
    const result = removeInitFromSource(src, 'pot1', []);
    expect(result).toBe(src);
  });

  it('preserves init block markers after removal', () => {
    const result = removeInitFromSource(WITH_TWO_INIT, 'btn1', [{ id: 'pot1' }]);
    expect(result).toContain('// ds-ide:controls:init:begin');
    expect(result).toContain('// ds-ide:controls:init:end');
  });
});
