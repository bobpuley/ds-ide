import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { findStaleReferences } = require('../../../../scripts/check-doc-commands.js') as {
  findStaleReferences: (
    docs: Array<{ file: string; text: string }>,
    commands: Array<{ command: string; title: string; category?: string }>,
  ) => Array<{ file: string; line: number; ref: string }>;
};

const commands = [
  { command: 'ds-ide.runEffect', title: 'Run Daisy Effect', category: 'Daisy IDE' },
  { command: 'ds-ide.focusWiring', title: 'Focus Wiring Editor', category: 'Daisy IDE' },
  { command: 'ds-ide.buildAndFlash', title: 'Build & Flash to Daisy Seed', category: 'Daisy IDE' },
];

describe('findStaleReferences (FR-RCH-4)', () => {
  it('accepts a Daisy IDE title and a command link that exist', () => {
    const text = 'Use **Daisy IDE: Run Daisy Effect**.\n[x](command:ds-ide.focusWiring)';
    expect(findStaleReferences([{ file: 'a.md', text }], commands)).toEqual([]);
  });

  it('reports a Daisy IDE title that is not in the manifest, with file and line', () => {
    const text = 'ok\nOpen with **Daisy IDE: Open Wiring Editor**.';
    expect(findStaleReferences([{ file: 'README.md', text }], commands))
      .toEqual([{ file: 'README.md', line: 2, ref: 'Daisy IDE: Open Wiring Editor' }]);
  });

  it('accepts a title that contains an ampersand, and reports a stale one (FR-DOC-4)', () => {
    const ok = 'Run **Daisy IDE: Build & Flash to Daisy Seed** to do both.';
    expect(findStaleReferences([{ file: 'a.md', text: ok }], commands)).toEqual([]);
    const stale = 'Run **Daisy IDE: Build & Burn the Board**.';
    expect(findStaleReferences([{ file: 'a.md', text: stale }], commands))
      .toEqual([{ file: 'a.md', line: 1, ref: 'Daisy IDE: Build & Burn the Board' }]);
  });

  it('reports a command: link to an unknown command id', () => {
    const text = '[x](command:ds-ide.gone)';
    expect(findStaleReferences([{ file: 'w.md', text }], commands))
      .toEqual([{ file: 'w.md', line: 1, ref: 'command:ds-ide.gone' }]);
  });

  it('does not treat ds-ide.* settings or state keys in prose as command references', () => {
    const text = '| `ds-ide.effectSource` | string |';
    expect(findStaleReferences([{ file: 'README.md', text }], commands)).toEqual([]);
  });
});

describe('the shipped README and walkthrough (FR-RCH-4)', () => {
  it('reference no command missing from package.json', () => {
    const root = path.join(__dirname, '../../../..');
    const { findStaleReferences: find } = require(path.join(root, 'scripts/check-doc-commands.js'));
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const files = ['README.md', ...fs.readdirSync(path.join(root, 'media/walkthrough')).map((f) => `media/walkthrough/${f}`)];
    const docs = files.map((file) => ({ file, text: fs.readFileSync(path.join(root, file), 'utf8') }));
    expect(find(docs, pkg.contributes.commands)).toEqual([]);
  });
});
