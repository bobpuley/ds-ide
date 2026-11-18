import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// FR-EXM-2/7: everything under examples/ ships in the .vsix, so every example
// must be a complete, standalone, meaningfully named project that the editors
// can read, and the index must list exactly what is there.

const examplesDir = path.join(__dirname, '../../../../examples');
const exampleNames = fs.readdirSync(examplesDir, { withFileTypes: true })
  .filter(e => e.isDirectory())
  .map(e => e.name)
  .sort();

// The effect source is the .cpp at the project root (the layout the extension
// auto-detects for a plain example).
function effectSource(name: string): string | undefined {
  const dir = path.join(examplesDir, name);
  return fs.readdirSync(dir).find(f => f.endsWith('.cpp'));
}

describe('shipped examples (FR-EXM-2, FR-EXM-7)', () => {
  it('there are examples to check', () => {
    expect(exampleNames.length).toBeGreaterThan(0);
  });

  it.each(exampleNames)('%s: has a README, CMakeLists.txt and controllers.yaml', (name) => {
    for (const file of ['README.md', 'CMakeLists.txt', 'controllers.yaml']) {
      expect(fs.existsSync(path.join(examplesDir, name, file)), `${name}/${file}`).toBe(true);
    }
  });

  it.each(exampleNames)('%s: has an effect source with a ds-ide:controls block', (name) => {
    const cpp = effectSource(name);
    expect(cpp, `${name} has no .cpp at its root`).toBeDefined();
    const text = fs.readFileSync(path.join(examplesDir, name, cpp!), 'utf8');
    expect(text).toContain('// ds-ide:controls:begin');
    expect(text).toContain('// ds-ide:controls:end');
  });

  it.each(exampleNames)('%s: README is not a stub', (name) => {
    const readme = fs.readFileSync(path.join(examplesDir, name, 'README.md'), 'utf8');
    expect(readme.split('\n').length).toBeGreaterThan(15);
    expect(readme).toMatch(/what you will learn/i);
  });

  it.each(exampleNames)('%s: name does not refer to a milestone', (name) => {
    expect(name).not.toMatch(/(^|[-_])m\d+/i);
    const cpp = effectSource(name);
    if (cpp) expect(cpp).not.toMatch(/(^|[-_])m\d+/i);
  });

  it('only real examples live in examples/ (no loose or leftover files)', () => {
    const entries = fs.readdirSync(examplesDir, { withFileTypes: true });
    const loose = entries.filter(e => !e.isDirectory()).map(e => e.name).filter(n => n !== 'README.md');
    expect(loose).toEqual([]);
  });

  it('examples/README.md lists exactly the examples that exist', () => {
    const index = fs.readFileSync(path.join(examplesDir, 'README.md'), 'utf8');
    const listed = [...index.matchAll(/\]\(([\w-]+)\/\)/g)].map(m => m[1]!).sort();
    expect(listed).toEqual(exampleNames);
  });
});
