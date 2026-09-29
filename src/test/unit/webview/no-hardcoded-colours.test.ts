import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// FR-THM-6: webview code must take colours from the theme layer. This scans
// the webview-facing sources for hex / rgb() / hsl() literals and fails naming
// each file and line, so a hardcoded colour can't creep back in unnoticed.

const ROOT = join(__dirname, '..', '..', '..', '..');
const SCAN_DIRS = ['src/webview', 'src/sidebar', 'src/wiring'];

// Hardware depictions keep fixed colours (FR-THM-4) and the accent palette
// lives in devices/registry.ts (outside the scanned folders); nothing else may
// hold a literal.
const ALLOW_LIST = new Set([
  'src/wiring/board-art.ts',
  'src/wiring/device-icons.ts',
]);

// `(?<![&\w])` skips HTML entities such as `&#9679;` and identifiers.
const COLOUR_LITERAL = /(?<![&\w])#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;

export interface Violation { file: string; line: number; text: string }

function isCommentLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

export function findColourLiterals(file: string, source: string): Violation[] {
  const out: Violation[] = [];
  source.split('\n').forEach((text, i) => {
    if (!isCommentLine(text) && COLOUR_LITERAL.test(text)) {
      out.push({ file, line: i + 1, text: text.trim().slice(0, 120) });
    }
  });
  return out;
}

function listTsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return listTsFiles(p);
    return e.name.endsWith('.ts') && !e.name.endsWith('.d.ts') ? [p] : [];
  });
}

describe('no hardcoded colours in webview code (FR-THM-6)', () => {
  it('finds no hex / rgb() / hsl() literal outside the allow-list', () => {
    const violations = SCAN_DIRS
      .flatMap(d => listTsFiles(join(ROOT, d)))
      .map(p => relative(ROOT, p))
      .filter(f => !ALLOW_LIST.has(f))
      .flatMap(f => findColourLiterals(f, readFileSync(join(ROOT, f), 'utf8')));
    const report = violations.map(v => `${v.file}:${v.line}  ${v.text}`).join('\n');
    expect(report).toBe('');
  });

  it('keeps every allow-listed file real', () => {
    for (const f of ALLOW_LIST) expect(() => readFileSync(join(ROOT, f), 'utf8')).not.toThrow();
  });

  describe('detector', () => {
    it.each([
      ['a 6-digit hex', "const c = '#1e1e1e';"],
      ['a 3-digit hex', 'a { color: #fff; }'],
      ['an 8-digit hex', 'a { color: #11223344; }'],
      ['rgb()', "el.style.color = 'rgb(1,2,3)';"],
      ['rgba()', 'box-shadow: 0 0 1px rgba(0,0,0,.5);'],
      ['hsl()', 'color: hsl(10 20% 30%);'],
    ])('flags %s and names file and line', (_n, line) => {
      const v = findColourLiterals('fixture.ts', `const ok = 1;\n${line}\n`);
      expect(v).toHaveLength(1);
      expect(v[0]).toMatchObject({ file: 'fixture.ts', line: 2 });
    });

    it.each([
      ['var() colours', 'a { color: var(--ds-text); }'],
      ['HTML entities', '<span>&#9679; &#x2139;</span>'],
      ['id selectors', "querySelector('#pinout')"],
      ['comment lines', '// was #4ec9b0'],
    ])('ignores %s', (_n, line) => {
      expect(findColourLiterals('fixture.ts', line)).toEqual([]);
    });
  });
});
