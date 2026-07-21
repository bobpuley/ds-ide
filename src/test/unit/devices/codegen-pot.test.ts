import { describe, it, expect } from 'vitest';
import { potCodegen, pinToAdcChannel } from '../../../devices/codegen/pot';

describe('potCodegen.declLine (FR-DEV-4)', () => {
  it('sizes the array declaration to the instance count', () => {
    expect(potCodegen.declLine([{ id: 'a', pin: 15 }])).toBe('  AdcChannelConfig ds_ide_adc_cfg[1];');
    expect(potCodegen.declLine([{ id: 'a', pin: 15 }, { id: 'b', pin: 16 }]))
      .toBe('  AdcChannelConfig ds_ide_adc_cfg[2];');
  });

  it('sizes to 0 for an empty instance list', () => {
    expect(potCodegen.declLine([])).toBe('  AdcChannelConfig ds_ide_adc_cfg[0];');
  });
});

describe('potCodegen.isDeclLine (FR-DEV-4)', () => {
  it('matches a generated array declaration', () => {
    expect(potCodegen.isDeclLine('  AdcChannelConfig ds_ide_adc_cfg[3];')).toBe(true);
  });

  it('does not match an unrelated declaration', () => {
    expect(potCodegen.isDeclLine('Switch btn1;')).toBe(false);
  });
});

describe('potCodegen.initLines (FR-DEV-4)', () => {
  it('emits nothing for an empty instance list', () => {
    expect(potCodegen.initLines([])).toEqual([]);
  });

  it('emits one InitSingle per instance, indexed by position, plus the aggregate adc.Init call', () => {
    const lines = potCodegen.initLines([{ id: 'a', pin: 15 }, { id: 'b', pin: 20 }]);
    expect(lines).toEqual([
      '  ds_ide_adc_cfg[0].InitSingle(daisy::seed::A0);',
      '  ds_ide_adc_cfg[1].InitSingle(daisy::seed::A5);',
      '  hardware.adc.Init(ds_ide_adc_cfg, 2);',
    ]);
  });
});

describe('potCodegen.isInitLine (FR-DEV-4)', () => {
  it('matches an InitSingle line', () => {
    expect(potCodegen.isInitLine('  ds_ide_adc_cfg[0].InitSingle(daisy::seed::A0);')).toBe(true);
  });

  it('matches the aggregate adc.Init call', () => {
    expect(potCodegen.isInitLine('  hardware.adc.Init(ds_ide_adc_cfg, 2);')).toBe(true);
  });

  it('does not match an unrelated init line', () => {
    expect(potCodegen.isInitLine('  btn1.Init(daisy::seed::D28, hardware.AudioCallbackRate());')).toBe(false);
  });
});

describe('pinToAdcChannel (FR-PIN-1, re-exported from controls-writer.ts)', () => {
  it('maps D15-D25 to A0-A10 and D28 to A11', () => {
    expect(pinToAdcChannel(15)).toBe(0);
    expect(pinToAdcChannel(25)).toBe(10);
    expect(pinToAdcChannel(28)).toBe(11);
  });
});
