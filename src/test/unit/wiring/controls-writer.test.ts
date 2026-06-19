import { describe, it, expect } from 'vitest';
import { declarationLine, insertIntoSource, removeFromSource } from '../../../wiring/controls-writer';

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
