import { describe, it, expect } from 'vitest';
import { parseControlsConvention } from '../../../controllers/controls-convention-parser';

const src = (body: string) =>
  `// ds-ide:controls:begin\n${body}// ds-ide:controls:end\n`;

describe('parseControlsConvention', () => {
  it('returns missingBlock when no markers present', () => {
    const result = parseControlsConvention('AdcChannelConfig pot1;\n');
    expect(result.missingBlock).toBe(true);
    expect(result.controls).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('returns missingBlock when only begin marker is present', () => {
    const result = parseControlsConvention('// ds-ide:controls:begin\nAdcChannelConfig pot1;\n');
    expect(result.missingBlock).toBe(true);
  });

  it('returns missingBlock when only end marker is present', () => {
    const result = parseControlsConvention('// ds-ide:controls:end\n');
    expect(result.missingBlock).toBe(true);
  });

  it('returns missingBlock when end appears before begin', () => {
    const result = parseControlsConvention(
      '// ds-ide:controls:end\n// ds-ide:controls:begin\n',
    );
    expect(result.missingBlock).toBe(true);
  });

  it('returns empty controls for an empty block', () => {
    const result = parseControlsConvention(src(''));
    expect(result.missingBlock).toBe(false);
    expect(result.controls).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('parses a single pot annotation', () => {
    const result = parseControlsConvention(
      src('AdcChannelConfig pot1; // ds-ide: id=pot1, kind=pot, pin=15\n'),
    );
    expect(result.missingBlock).toBe(false);
    expect(result.controls).toEqual([{ id: 'pot1', kind: 'pot', pin: 15 }]);
    expect(result.errors).toEqual([]);
  });

  it('parses a single button annotation', () => {
    const result = parseControlsConvention(
      src('Switch button1; // ds-ide: id=button1, kind=button, pin=28\n'),
    );
    expect(result.controls).toEqual([{ id: 'button1', kind: 'button', pin: 28 }]);
  });

  it('parses a single led annotation', () => {
    const result = parseControlsConvention(
      src('Led led1; // ds-ide: id=led1, kind=led, pin=23\n'),
    );
    expect(result.controls).toEqual([{ id: 'led1', kind: 'led', pin: 23 }]);
  });

  it('parses multiple annotations in order', () => {
    const result = parseControlsConvention(
      src(
        'AdcChannelConfig pot1; // ds-ide: id=pot1, kind=pot, pin=15\n' +
        'Switch button1; // ds-ide: id=button1, kind=button, pin=28\n' +
        'Led led1; // ds-ide: id=led1, kind=led, pin=23\n',
      ),
    );
    expect(result.controls).toEqual([
      { id: 'pot1',    kind: 'pot',    pin: 15 },
      { id: 'button1', kind: 'button', pin: 28 },
      { id: 'led1',    kind: 'led',    pin: 23 },
    ]);
    expect(result.errors).toEqual([]);
  });

  it('records errors for lines without a valid annotation inside the block', () => {
    const result = parseControlsConvention(
      src('some random line without annotation\n'),
    );
    expect(result.controls).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/unrecognised annotation on line/);
  });

  it('collects both valid controls and errors when mixed', () => {
    const result = parseControlsConvention(
      src(
        'AdcChannelConfig pot1; // ds-ide: id=pot1, kind=pot, pin=15\n' +
        'bad line no annotation\n' +
        'Led led1; // ds-ide: id=led1, kind=led, pin=23\n',
      ),
    );
    expect(result.controls).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
  });

  it('ignores blank lines inside the block', () => {
    const result = parseControlsConvention(
      src('\n\nAdcChannelConfig pot1; // ds-ide: id=pot1, kind=pot, pin=15\n\n'),
    );
    expect(result.controls).toHaveLength(1);
    expect(result.errors).toEqual([]);
  });

  it('handles CRLF line endings', () => {
    const crlfSrc =
      '// ds-ide:controls:begin\r\n' +
      'AdcChannelConfig pot1; // ds-ide: id=pot1, kind=pot, pin=15\r\n' +
      '// ds-ide:controls:end\r\n';
    const result = parseControlsConvention(crlfSrc);
    expect(result.missingBlock).toBe(false);
    expect(result.controls).toEqual([{ id: 'pot1', kind: 'pot', pin: 15 }]);
  });

  it('tolerates trailing whitespace on marker lines', () => {
    const spaceSrc =
      '// ds-ide:controls:begin   \n' +
      'AdcChannelConfig pot1; // ds-ide: id=pot1, kind=pot, pin=15\n' +
      '// ds-ide:controls:end   \n';
    const result = parseControlsConvention(spaceSrc);
    expect(result.missingBlock).toBe(false);
    expect(result.controls).toHaveLength(1);
  });

  it('returns missingInitBlock true and empty initLines when init block absent', () => {
    const result = parseControlsConvention(src('AdcChannelConfig pot1; // ds-ide: id=pot1, kind=pot, pin=15\n'));
    expect(result.missingInitBlock).toBe(true);
    expect(result.initLines).toEqual([]);
  });
});

// ── init block parsing ────────────────────────────────────────────────────────

const srcWithInit = (declBody: string, initBody: string) =>
  `// ds-ide:controls:begin\n${declBody}// ds-ide:controls:end\n` +
  `// ds-ide:controls:init:begin\n${initBody}// ds-ide:controls:init:end\n`;

describe('parseControlsConvention — init block', () => {
  it('returns missingInitBlock false and initLines when init block is present', () => {
    const result = parseControlsConvention(
      srcWithInit(
        'AdcChannelConfig pot1; // ds-ide: id=pot1, kind=pot, pin=15\n',
        '  pot1.InitSingle(daisy::seed::A0);\n  hardware.adc.Init(pot1, 1);\n',
      ),
    );
    expect(result.missingInitBlock).toBe(false);
    expect(result.initLines).toEqual([
      '  pot1.InitSingle(daisy::seed::A0);',
      '  hardware.adc.Init(pot1, 1);',
    ]);
  });

  it('returns missingInitBlock true when only begin init marker is present', () => {
    const result = parseControlsConvention(
      src('') + '// ds-ide:controls:init:begin\n',
    );
    expect(result.missingInitBlock).toBe(true);
  });

  it('returns missingInitBlock true when init end appears before begin', () => {
    const result = parseControlsConvention(
      src('') + '// ds-ide:controls:init:end\n// ds-ide:controls:init:begin\n',
    );
    expect(result.missingInitBlock).toBe(true);
  });

  it('returns empty initLines for empty init block', () => {
    const result = parseControlsConvention(srcWithInit('', ''));
    expect(result.missingInitBlock).toBe(false);
    expect(result.initLines).toEqual([]);
  });

  it('parses multiple init lines in order', () => {
    const result = parseControlsConvention(
      srcWithInit(
        'AdcChannelConfig pot1; // ds-ide: id=pot1, kind=pot, pin=15\n' +
        'Switch button1; // ds-ide: id=button1, kind=button, pin=28\n',
        '  pot1.InitSingle(daisy::seed::A0);\n' +
        '  button1.Init(daisy::seed::D28, hardware.AudioCallbackRate());\n' +
        '  hardware.adc.Init(pot1, 1);\n',
      ),
    );
    expect(result.initLines).toEqual([
      '  pot1.InitSingle(daisy::seed::A0);',
      '  button1.Init(daisy::seed::D28, hardware.AudioCallbackRate());',
      '  hardware.adc.Init(pot1, 1);',
    ]);
  });

  it('still parses declaration block correctly when init block is also present', () => {
    const result = parseControlsConvention(
      srcWithInit(
        'AdcChannelConfig pot1; // ds-ide: id=pot1, kind=pot, pin=15\n',
        '  pot1.InitSingle(daisy::seed::A0);\n  hardware.adc.Init(pot1, 1);\n',
      ),
    );
    expect(result.controls).toEqual([{ id: 'pot1', kind: 'pot', pin: 15 }]);
    expect(result.missingBlock).toBe(false);
  });

  it('handles CRLF in init block', () => {
    const crlfSrc =
      '// ds-ide:controls:begin\r\n' +
      'AdcChannelConfig pot1; // ds-ide: id=pot1, kind=pot, pin=15\r\n' +
      '// ds-ide:controls:end\r\n' +
      '// ds-ide:controls:init:begin\r\n' +
      '  pot1.InitSingle(daisy::seed::A0);\r\n' +
      '// ds-ide:controls:init:end\r\n';
    const result = parseControlsConvention(crlfSrc);
    expect(result.missingInitBlock).toBe(false);
    expect(result.initLines).toEqual(['  pot1.InitSingle(daisy::seed::A0);']);
  });
});
