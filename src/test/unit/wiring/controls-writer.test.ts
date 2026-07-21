import { describe, it, expect } from 'vitest';
import {
  declarationLine,
  insertIntoSource,
  removeFromSource,
  insertInitIntoSource,
  removeInitFromSource,
  pinToAdcChannel,
} from '../../../wiring/controls-writer';
import { parseControlsConvention } from '../../../controllers/controls-convention-parser';

// ── declarationLine ──────────────────────────────────────────────────────────

describe('declarationLine', () => {
  it('generates a marker-only comment for a pot (no per-pot AdcChannelConfig — FR-CODEGEN-1)', () => {
    expect(declarationLine('vol', 'pot', 15))
      .toBe('// ds-ide: id=vol, kind=pot, pin=15');
  });

  it('generates button declaration', () => {
    expect(declarationLine('btn1', 'button', 28))
      .toBe('Switch btn1; // ds-ide: id=btn1, kind=button, pin=28');
  });

  it('generates led declaration', () => {
    expect(declarationLine('led1', 'led', 23))
      .toBe('Led led1; // ds-ide: id=led1, kind=led, pin=23');
  });

  it('generates toggle declaration (FR-DEV-7)', () => {
    expect(declarationLine('sw1', 'toggle', 5))
      .toBe('Switch3 sw1; // ds-ide: id=sw1, kind=toggle, pin=5');
  });

  it('generates rgbled declaration with a pins= suffix carrying all three pins (FR-DEV-8)', () => {
    expect(declarationLine('rgb1', 'rgbled', 5, [5, 6, 7]))
      .toBe('RgbLed rgb1; // ds-ide: id=rgb1, kind=rgbled, pin=5, pins=5,6,7');
  });
});

// ── insertIntoSource ─────────────────────────────────────────────────────────

const WITH_BLOCK = [
  '#include "daisy_seed.h"',
  '// ds-ide:controls:begin',
  '  AdcChannelConfig ds_ide_adc_cfg[1];',
  '// ds-ide: id=vol, kind=pot, pin=15',
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

  it('inserted button line has correct format', () => {
    const result = insertIntoSource(WITH_BLOCK, 'btn1', 'button', 28);
    expect(result).toContain('Switch btn1; // ds-ide: id=btn1, kind=button, pin=28');
  });

  it('inserting a second pot regenerates the array declaration to size 2', () => {
    const result = insertIntoSource(WITH_BLOCK, 'pot2', 'pot', 16);
    expect(result).toContain('AdcChannelConfig ds_ide_adc_cfg[2];');
    expect(result).not.toContain('ds_ide_adc_cfg[1];');
    expect(result).toContain('id=vol');
    expect(result).toContain('id=pot2');
  });

  it('does not declare a separate AdcChannelConfig per pot', () => {
    const result = insertIntoSource(WITH_BLOCK, 'pot2', 'pot', 16);
    expect(result).not.toMatch(/AdcChannelConfig\s+pot2\s*;/);
  });
});

describe('insertIntoSource / removeFromSource — toggle (FR-DEV-7)', () => {
  it('inserts a toggle declaration', () => {
    const result = insertIntoSource(WITH_BLOCK, 'sw1', 'toggle', 5);
    expect(result).toContain('Switch3 sw1; // ds-ide: id=sw1, kind=toggle, pin=5');
  });

  it('removes a toggle declaration by id, preserving others', () => {
    const withToggle = insertIntoSource(WITH_BLOCK, 'sw1', 'toggle', 5);
    const result = removeFromSource(withToggle, 'sw1');
    expect(result).not.toContain('id=sw1');
    expect(result).toContain('id=vol');
  });
});

describe('insertIntoSource / removeFromSource — rgbled three-pin (FR-DEV-8)', () => {
  it('inserts an rgbled declaration carrying all three pins', () => {
    const result = insertIntoSource(WITH_BLOCK, 'rgb1', 'rgbled', 5, [5, 6, 7]);
    expect(result).toContain('RgbLed rgb1; // ds-ide: id=rgb1, kind=rgbled, pin=5, pins=5,6,7');
  });

  it('a single removeFromSource(id) removes the whole three-pin declaration (releases all three)', () => {
    const withRgb = insertIntoSource(WITH_BLOCK, 'rgb1', 'rgbled', 5, [5, 6, 7]);
    const result = removeFromSource(withRgb, 'rgb1');
    expect(result).not.toContain('id=rgb1');
    expect(result).toContain('id=vol');
  });

  it('parseControlsConvention recovers the full pins list for an rgbled instance', () => {
    const withRgb = insertIntoSource(WITH_BLOCK, 'rgb1', 'rgbled', 5, [5, 6, 7]);
    const { controls } = parseControlsConvention(withRgb);
    const rgb = controls.find(c => c.id === 'rgb1')!;
    expect(rgb.pin).toBe(5);
    expect(rgb.pins).toEqual([5, 6, 7]);
  });
});

describe('insertInitIntoSource — rgbled three-pin Init (FR-DEV-8)', () => {
  it('emits Init() with three D-pin args and no extra initArgs', () => {
    const src = [
      '// ds-ide:controls:begin',
      'RgbLed rgb1; // ds-ide: id=rgb1, kind=rgbled, pin=5, pins=5,6,7',
      '// ds-ide:controls:end',
    ].join('\n');
    const result = insertInitIntoSource(src, 'rgb1', 'rgbled', 5, [], [5, 6, 7]);
    expect(result).toContain('  rgb1.Init(daisy::seed::D5, daisy::seed::D6, daisy::seed::D7);');
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

  it('a first pot gets an array declaration sized 1', () => {
    const result = insertIntoSource(NO_BLOCK, 'vol', 'pot', 15);
    expect(result).toContain('AdcChannelConfig ds_ide_adc_cfg[1];');
  });

  it('a button with no pots does not add an array declaration', () => {
    const result = insertIntoSource(NO_BLOCK, 'btn1', 'button', 28);
    expect(result).not.toContain('ds_ide_adc_cfg');
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
  '  AdcChannelConfig ds_ide_adc_cfg[1];',
  '// ds-ide: id=vol, kind=pot, pin=15',
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

  it('removes the array declaration entirely when the last pot is removed', () => {
    const result = removeFromSource(WITH_TWO, 'vol');
    expect(result).not.toContain('ds_ide_adc_cfg');
  });

  it('shrinks the array declaration when one of several pots is removed', () => {
    const src = [
      '// ds-ide:controls:begin',
      '  AdcChannelConfig ds_ide_adc_cfg[2];',
      '// ds-ide: id=pot1, kind=pot, pin=15',
      '// ds-ide: id=pot2, kind=pot, pin=16',
      '// ds-ide:controls:end',
    ].join('\n');
    const result = removeFromSource(src, 'pot1');
    expect(result).toContain('AdcChannelConfig ds_ide_adc_cfg[1];');
    expect(result).not.toContain('id=pot1');
    expect(result).toContain('id=pot2');
  });
});

// ── insertInitIntoSource ──────────────────────────────────────────────────────

const SOURCE_NO_INIT = [
  '// ds-ide:controls:begin',
  '  AdcChannelConfig ds_ide_adc_cfg[1];',
  '// ds-ide: id=pot1, kind=pot, pin=15',
  '// ds-ide:controls:end',
].join('\n');

const SOURCE_WITH_INIT = [
  '// ds-ide:controls:begin',
  '  AdcChannelConfig ds_ide_adc_cfg[1];',
  '// ds-ide: id=pot1, kind=pot, pin=15',
  '// ds-ide:controls:end',
  '// ds-ide:controls:init:begin',
  '  ds_ide_adc_cfg[0].InitSingle(daisy::seed::A0);',
  '  hardware.adc.Init(ds_ide_adc_cfg, 1);',
  '// ds-ide:controls:init:end',
].join('\n');

describe('insertInitIntoSource — init block absent', () => {
  it('creates the init block after the declaration end marker', () => {
    const result = insertInitIntoSource(SOURCE_NO_INIT, 'pot1', 'pot', 15, [{ id: 'pot1', pin: 15 }]);
    expect(result).toContain('// ds-ide:controls:init:begin');
    expect(result).toContain('// ds-ide:controls:init:end');
    const lines = result.split('\n');
    const initBeg = lines.indexOf('// ds-ide:controls:init:begin');
    const declEnd = lines.indexOf('// ds-ide:controls:end');
    expect(initBeg).toBeGreaterThan(declEnd);
  });

  it('pot: writes array-indexed InitSingle with correct analog index', () => {
    const result = insertInitIntoSource(SOURCE_NO_INIT, 'pot1', 'pot', 15, [{ id: 'pot1', pin: 15 }]);
    expect(result).toContain('  ds_ide_adc_cfg[0].InitSingle(daisy::seed::A0);');
  });

  it('pot: writes hardware.adc.Init with the array and count (real libDaisy signature)', () => {
    const result = insertInitIntoSource(SOURCE_NO_INIT, 'pot1', 'pot', 15, [{ id: 'pot1', pin: 15 }]);
    expect(result).toContain('  hardware.adc.Init(ds_ide_adc_cfg, 1);');
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

  it('toggle: writes a bare single-arg Init (initArgs: null — FR-DEV-7)', () => {
    const src = [
      '// ds-ide:controls:begin',
      'Switch3 sw1; // ds-ide: id=sw1, kind=toggle, pin=5',
      '// ds-ide:controls:end',
    ].join('\n');
    const result = insertInitIntoSource(src, 'sw1', 'toggle', 5, []);
    expect(result).toContain('  sw1.Init(daisy::seed::D5);');
  });
});

describe('insertInitIntoSource — init block present', () => {
  it('adding a second pot regenerates both InitSingle lines and adc.Init with the array', () => {
    const src = [
      '// ds-ide:controls:begin',
      '  AdcChannelConfig ds_ide_adc_cfg[2];',
      '// ds-ide: id=pot1, kind=pot, pin=15',
      '// ds-ide: id=pot2, kind=pot, pin=16',
      '// ds-ide:controls:end',
      '// ds-ide:controls:init:begin',
      '  ds_ide_adc_cfg[0].InitSingle(daisy::seed::A0);',
      '  hardware.adc.Init(ds_ide_adc_cfg, 1);',
      '// ds-ide:controls:init:end',
    ].join('\n');
    const result = insertInitIntoSource(src, 'pot2', 'pot', 16, [{ id: 'pot1', pin: 15 }, { id: 'pot2', pin: 16 }]);
    const lines = result.split('\n');
    const initBeg = lines.indexOf('// ds-ide:controls:init:begin');
    const initEnd = lines.indexOf('// ds-ide:controls:init:end');
    const idx0 = lines.findIndex(l => l.includes('ds_ide_adc_cfg[0].InitSingle'));
    const idx1 = lines.findIndex(l => l.includes('ds_ide_adc_cfg[1].InitSingle'));
    const adcIdx  = lines.findIndex(l => l.includes('hardware.adc.Init'));
    expect(idx0).toBeGreaterThan(initBeg);
    expect(idx1).toBeGreaterThan(initBeg);
    expect(adcIdx).toBeGreaterThan(idx0);
    expect(adcIdx).toBeGreaterThan(idx1);
    expect(adcIdx).toBeLessThan(initEnd);
    expect(result).toContain('  hardware.adc.Init(ds_ide_adc_cfg, 2);');
  });

  it('adds button inside existing block without touching adc.Init', () => {
    const result = insertInitIntoSource(SOURCE_WITH_INIT, 'btn1', 'button', 28, [{ id: 'pot1', pin: 15 }]);
    expect(result).toContain('  btn1.Init(daisy::seed::D28, hardware.AudioCallbackRate());');
    expect(result).toContain('  hardware.adc.Init(ds_ide_adc_cfg, 1);');
  });

  it('does not duplicate init block markers', () => {
    const result = insertInitIntoSource(SOURCE_WITH_INIT, 'btn1', 'button', 28, [{ id: 'pot1', pin: 15 }]);
    const begs = result.split('\n').filter(l => l === '// ds-ide:controls:init:begin');
    const ends = result.split('\n').filter(l => l === '// ds-ide:controls:init:end');
    expect(begs).toHaveLength(1);
    expect(ends).toHaveLength(1);
  });

  it('analog index A5 for pin 20', () => {
    const src = '// ds-ide:controls:begin\n// ds-ide:controls:end\n';
    const result = insertInitIntoSource(src, 'vol', 'pot', 20, [{ id: 'vol', pin: 20 }]);
    expect(result).toContain('  ds_ide_adc_cfg[0].InitSingle(daisy::seed::A5);');
  });

  it('analog index A6 for pin 21', () => {
    const src = '// ds-ide:controls:begin\n// ds-ide:controls:end\n';
    const result = insertInitIntoSource(src, 'vol', 'pot', 21, [{ id: 'vol', pin: 21 }]);
    expect(result).toContain('  ds_ide_adc_cfg[0].InitSingle(daisy::seed::A6);');
  });
});

// ── removeInitFromSource ──────────────────────────────────────────────────────

const WITH_TWO_INIT = [
  '// ds-ide:controls:begin',
  '  AdcChannelConfig ds_ide_adc_cfg[1];',
  '// ds-ide: id=pot1, kind=pot, pin=15',
  'Switch btn1; // ds-ide: id=btn1, kind=button, pin=28',
  '// ds-ide:controls:end',
  '// ds-ide:controls:init:begin',
  '  ds_ide_adc_cfg[0].InitSingle(daisy::seed::A0);',
  '  btn1.Init(daisy::seed::D28, hardware.AudioCallbackRate());',
  '  hardware.adc.Init(ds_ide_adc_cfg, 1);',
  '// ds-ide:controls:init:end',
].join('\n');

describe('removeInitFromSource', () => {
  it('removes the pot InitSingle line when the last pot is removed', () => {
    const result = removeInitFromSource(WITH_TWO_INIT, 'pot1', []);
    expect(result).not.toContain('InitSingle');
  });

  it('removes hardware.adc.Init when last pot is removed', () => {
    const result = removeInitFromSource(WITH_TWO_INIT, 'pot1', []);
    expect(result).not.toContain('hardware.adc.Init');
  });

  it('re-indexes the remaining pot InitSingle line when one of multiple pots is removed', () => {
    const src = [
      '// ds-ide:controls:begin',
      '  AdcChannelConfig ds_ide_adc_cfg[2];',
      '// ds-ide: id=pot1, kind=pot, pin=15',
      '// ds-ide: id=pot2, kind=pot, pin=16',
      '// ds-ide:controls:end',
      '// ds-ide:controls:init:begin',
      '  ds_ide_adc_cfg[0].InitSingle(daisy::seed::A0);',
      '  ds_ide_adc_cfg[1].InitSingle(daisy::seed::A1);',
      '  hardware.adc.Init(ds_ide_adc_cfg, 2);',
      '// ds-ide:controls:init:end',
    ].join('\n');
    const result = removeInitFromSource(src, 'pot1', [{ id: 'pot2', pin: 16 }]);
    expect(result).toContain('  ds_ide_adc_cfg[0].InitSingle(daisy::seed::A1);');
    expect(result).not.toContain('ds_ide_adc_cfg[1]');
    expect(result).toContain('  hardware.adc.Init(ds_ide_adc_cfg, 1);');
  });

  it('removes button init line and preserves pot lines', () => {
    const result = removeInitFromSource(WITH_TWO_INIT, 'btn1', [{ id: 'pot1', pin: 15 }]);
    expect(result).not.toContain('btn1.Init');
    expect(result).toContain('  ds_ide_adc_cfg[0].InitSingle(daisy::seed::A0);');
    expect(result).toContain('  hardware.adc.Init(ds_ide_adc_cfg, 1);');
  });

  it('is a no-op when init block is absent', () => {
    const src = '// ds-ide:controls:begin\n// ds-ide:controls:end\n';
    const result = removeInitFromSource(src, 'pot1', []);
    expect(result).toBe(src);
  });

  it('preserves init block markers after removal', () => {
    const result = removeInitFromSource(WITH_TWO_INIT, 'btn1', [{ id: 'pot1', pin: 15 }]);
    expect(result).toContain('// ds-ide:controls:init:begin');
    expect(result).toContain('// ds-ide:controls:init:end');
  });
});

// ── FR-EQ-8 edge cases ────────────────────────────────────────────────────────

describe('insertInitIntoSource — init absent, declaration block present, extra content after (FR-EQ-8a)', () => {
  it('inserts init block immediately after controls:end even when source has content after the block', () => {
    const src = [
      '// ds-ide:controls:begin',
      '  AdcChannelConfig ds_ide_adc_cfg[1];',
      '// ds-ide: id=vol, kind=pot, pin=15',
      '// ds-ide:controls:end',
      'void init() { /* user code */ }',
      'void loop() {}',
    ].join('\n');
    const result = insertInitIntoSource(src, 'vol', 'pot', 15, [{ id: 'vol', pin: 15 }]);
    const lines = result.split('\n');
    const declEndIdx = lines.indexOf('// ds-ide:controls:end');
    const initBegIdx = lines.indexOf('// ds-ide:controls:init:begin');
    expect(initBegIdx).toBe(declEndIdx + 1);
    // Content after the decl block must still be present
    expect(result).toContain('void init()');
    expect(result).toContain('void loop()');
  });
});

describe('removeInitFromSource — init block has lines from other controls that must be preserved (FR-EQ-8b)', () => {
  it('preserves second button init line and pot adc.Init when removing first button', () => {
    const src = [
      '// ds-ide:controls:init:begin',
      '  ds_ide_adc_cfg[0].InitSingle(daisy::seed::A0);',
      '  btn1.Init(daisy::seed::D28, hardware.AudioCallbackRate());',
      '  btn2.Init(daisy::seed::D29, hardware.AudioCallbackRate());',
      '  hardware.adc.Init(ds_ide_adc_cfg, 1);',
      '// ds-ide:controls:init:end',
    ].join('\n');
    const result = removeInitFromSource(src, 'btn1', [{ id: 'pot1', pin: 15 }]);
    expect(result).not.toContain('btn1.Init');
    expect(result).toContain('  btn2.Init(daisy::seed::D29, hardware.AudioCallbackRate());');
    expect(result).toContain('  ds_ide_adc_cfg[0].InitSingle(daisy::seed::A0);');
    expect(result).toContain('  hardware.adc.Init(ds_ide_adc_cfg, 1);');
  });
});

describe('adcInitLine regeneration — partially removed pots (FR-EQ-8c)', () => {
  it('regenerates adc.Init with 2 remaining pots (re-indexed) after removing one of three', () => {
    const src = [
      '// ds-ide:controls:init:begin',
      '  ds_ide_adc_cfg[0].InitSingle(daisy::seed::A0);',
      '  ds_ide_adc_cfg[1].InitSingle(daisy::seed::A1);',
      '  ds_ide_adc_cfg[2].InitSingle(daisy::seed::A2);',
      '  hardware.adc.Init(ds_ide_adc_cfg, 3);',
      '// ds-ide:controls:init:end',
    ].join('\n');
    const result = removeInitFromSource(src, 'pot3', [{ id: 'pot1', pin: 15 }, { id: 'pot2', pin: 16 }]);
    expect(result).toContain('  ds_ide_adc_cfg[0].InitSingle(daisy::seed::A0);');
    expect(result).toContain('  ds_ide_adc_cfg[1].InitSingle(daisy::seed::A1);');
    expect(result).not.toContain('ds_ide_adc_cfg[2]');
    expect(result).toContain('  hardware.adc.Init(ds_ide_adc_cfg, 2);');
  });
});

describe('insertIntoSource — duplicate id annotation (FR-EQ-8d)', () => {
  it('removeFromSource removes all duplicate annotations for the same id', () => {
    const srcWithDuplicate = [
      '// ds-ide:controls:begin',
      '  AdcChannelConfig ds_ide_adc_cfg[2];',
      '// ds-ide: id=vol, kind=pot, pin=15',
      '// ds-ide: id=vol, kind=pot, pin=15',
      '// ds-ide:controls:end',
    ].join('\n');
    const result = removeFromSource(srcWithDuplicate, 'vol');
    // Both duplicate lines must be removed
    expect(result).not.toContain('id=vol');
    // Block markers remain
    expect(result).toContain('// ds-ide:controls:begin');
    expect(result).toContain('// ds-ide:controls:end');
  });
});

// ── pinToAdcChannel (FR-PIN-1) ────────────────────────────────────────────────

describe('pinToAdcChannel', () => {
  it('maps D15 to A0', () => expect(pinToAdcChannel(15)).toBe(0));
  it('maps D16 to A1', () => expect(pinToAdcChannel(16)).toBe(1));
  it('maps D25 to A10', () => expect(pinToAdcChannel(25)).toBe(10));
  it('maps D28 to A11 (not A13)', () => expect(pinToAdcChannel(28)).toBe(11));
  it('returns 0 for unknown pins', () => expect(pinToAdcChannel(0)).toBe(0));
});

describe('insertInitIntoSource — D28 generates A11 (FR-PIN-1)', () => {
  it('pot on pin 28 generates daisy::seed::A11', () => {
    const src = '// ds-ide:controls:begin\n// ds-ide:controls:end\n';
    const result = insertInitIntoSource(src, 'cv', 'pot', 28, [{ id: 'cv', pin: 28 }]);
    expect(result).toContain('  ds_ide_adc_cfg[0].InitSingle(daisy::seed::A11);');
    expect(result).not.toContain('A13');
  });
});

describe('removeInitFromSource — strict id prefix collision (AC-81)', () => {
  it('removing id "btn" does not delete the "button1.Init" line when both exist in the init block', () => {
    const src = [
      '// ds-ide:controls:begin',
      'Switch btn; // ds-ide: id=btn, kind=button, pin=27',
      'Switch button1; // ds-ide: id=button1, kind=button, pin=28',
      '// ds-ide:controls:end',
      'void Init() {',
      '// ds-ide:controls:init:begin',
      '  btn.Init(daisy::seed::D27, hardware.AudioCallbackRate());',
      '  button1.Init(daisy::seed::D28, hardware.AudioCallbackRate());',
      '// ds-ide:controls:init:end',
      '}',
    ].join('\n');

    const result = removeInitFromSource(src, 'btn', []);

    expect(result).not.toContain('btn.Init');
    expect(result).toContain('button1.Init(daisy::seed::D28, hardware.AudioCallbackRate())');
  });
});

// ── FR-CODEGEN-1: real libDaisy AdcHandle::Init signature ────────────────────

describe('generated code matches real libDaisy AdcHandle::Init(cfg*, count) — FR-CODEGEN-1', () => {
  it('never generates the non-portable variadic call shape (multiple named args before count)', () => {
    const src = '// ds-ide:controls:begin\n// ds-ide:controls:end\n';
    let text = insertIntoSource(src, 'pot1', 'pot', 15);
    text = insertInitIntoSource(text, 'pot1', 'pot', 15, [{ id: 'pot1', pin: 15 }]);
    text = insertIntoSource(text, 'pot2', 'pot', 16);
    text = insertInitIntoSource(text, 'pot2', 'pot', 16, [{ id: 'pot1', pin: 15 }, { id: 'pot2', pin: 16 }]);

    expect(text).toContain('AdcChannelConfig ds_ide_adc_cfg[2];');
    expect(text).toContain('hardware.adc.Init(ds_ide_adc_cfg, 2);');
    // The old bug: separate named args passed directly to Init().
    expect(text).not.toMatch(/hardware\.adc\.Init\(pot1,\s*pot2,/);
  });
});
