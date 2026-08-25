import { describe, it, expect } from 'vitest';
import { makeSimplePeripheralCodegen } from '../../../devices/codegen/shared';

describe('makeSimplePeripheralCodegen (FR-EXT-37)', () => {
  const strategy = makeSimplePeripheralCodegen({
    declLine: '  Widget ds_ide_widget;',
    initLinePrefixes: ['  ds_ide_widget.Init('],
  });

  it('declLine returns the fixed line unchanged', () => {
    expect(strategy.declLine()).toBe('  Widget ds_ide_widget;');
  });

  it('isDeclLine recognizes its own declLine() output', () => {
    expect(strategy.isDeclLine(strategy.declLine())).toBe(true);
  });

  it('isDeclLine tolerates incidental whitespace differences', () => {
    expect(strategy.isDeclLine('Widget   ds_ide_widget;')).toBe(true);
    expect(strategy.isDeclLine('  Widget ds_ide_widget;  ')).toBe(true);
  });

  it('isDeclLine rejects an unrelated line', () => {
    expect(strategy.isDeclLine('Switch3 tgl1;')).toBe(false);
  });

  it('initLines emits one line per prefix, each closed with );', () => {
    expect(strategy.initLines()).toEqual(['  ds_ide_widget.Init();']);
  });

  it('isInitLine recognizes every line initLines() produces', () => {
    for (const line of strategy.initLines()) {
      expect(strategy.isInitLine(line)).toBe(true);
    }
    expect(strategy.isInitLine('  other.Init();')).toBe(false);
  });

  it('supports multiple init-line prefixes', () => {
    const multi = makeSimplePeripheralCodegen({
      declLine: '  A a; B b;',
      initLinePrefixes: ['  a.Init(', '  b.Init('],
    });
    expect(multi.initLines()).toEqual(['  a.Init();', '  b.Init();']);
  });
});
