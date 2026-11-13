import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// FR-DOC-6: the README is the Marketplace page, so a link or image that points
// at a file that is not there is a visible defect on day one. Images must also
// be ones the package ships (`.vscodeignore` keeps `media/*.png`, drops every
// other .png), or they would work in the repo and break once packaged.

const root = path.join(__dirname, '../../../../');

export interface Problem { line: number; target: string; reason: string }

/** Relative `[text](target)` and `![alt](target)` references, skipping URLs, anchors, mailto and command: links. */
function relativeReferences(markdown: string): Array<{ line: number; target: string; isImage: boolean }> {
  const refs: Array<{ line: number; target: string; isImage: boolean }> = [];
  let inFence = false;
  markdown.split('\n').forEach((text, i) => {
    if (/^\s*```/.test(text)) { inFence = !inFence; return; }
    if (inFence) return;
    for (const m of text.matchAll(/(!?)\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const target = m[2]!;
      if (/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(target)) continue;   // http:, command:, mailto:, #anchor
      refs.push({ line: i + 1, target: target.split('#')[0]!, isImage: m[1] === '!' });
    }
  });
  return refs;
}

export function findProblems(markdown: string, repoRoot: string): Problem[] {
  const problems: Problem[] = [];
  for (const ref of relativeReferences(markdown)) {
    if (ref.target === '') continue;
    if (!fs.existsSync(path.join(repoRoot, ref.target))) {
      problems.push({ line: ref.line, target: ref.target, reason: 'file does not exist' });
    } else if (ref.isImage && !/^media\/[^/]+\.(png|svg|gif|jpe?g)$/.test(ref.target)) {
      problems.push({ line: ref.line, target: ref.target, reason: 'image is not under media/ (the package would not ship it)' });
    }
  }
  return problems;
}

describe('README links and images (FR-DOC-6)', () => {
  it('every relative link and image in README.md resolves to a shipped file', () => {
    const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
    expect(findProblems(readme, root)).toEqual([]);
  });

  describe('the checker itself', () => {
    it('flags a link to a missing file', () => {
      const p = findProblems('See [guide](docs/nope.md).', root);
      expect(p).toEqual([{ line: 1, target: 'docs/nope.md', reason: 'file does not exist' }]);
    });

    it('flags a missing image and an image outside media/', () => {
      const p = findProblems('![a](media/not-taken-yet.png)\n![b](examples/tremolo-filter/README.md)', root);
      expect(p.map(x => x.reason)).toEqual([
        'file does not exist',
        'image is not under media/ (the package would not ship it)',
      ]);
    });

    it('accepts existing files, anchors, URLs and command: links', () => {
      const md = [
        '[ex](examples/README.md#before-you-start)',
        '![ok](media/screenshot-overview.png)',
        '[web](https://github.com/bobpuley/ds-ide)',
        '[cmd](command:ds-ide.runEffect)',
        '[top](#features)',
      ].join('\n');
      expect(findProblems(md, root)).toEqual([]);
    });

    it('ignores link-like text inside code fences', () => {
      const md = '```\n![x](media/missing.png)\n```';
      expect(findProblems(md, root)).toEqual([]);
    });
  });
});

describe('README prerequisites agree with the build (FR-DOC-2)', () => {
  it('states the same minimum CMake version as emulator/CMakeLists.txt', () => {
    const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
    const cmakeLists = fs.readFileSync(path.join(root, 'emulator/CMakeLists.txt'), 'utf8');
    const required = cmakeLists.match(/cmake_minimum_required\(VERSION\s+([\d.]+)/)![1];
    const stated = readme.match(/\*\*CMake\*\*\s+([\d.]+)/)?.[1];
    expect(stated).toBe(required);
  });
});
