import { describe, it, expect, vi } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { collectUrls, findBrokenUrls } = require('../../../../scripts/check-published-links.js') as {
  collectUrls: (readme: string, pkg: Record<string, unknown>) => string[];
  findBrokenUrls: (urls: string[], fetchStatus: (url: string) => Promise<number>) => Promise<Array<{ url: string; status: number | string }>>;
};

const pkg = {
  repository: { type: 'git', url: 'https://github.com/o/r' },
  bugs: { url: 'https://github.com/o/r/issues' },
  homepage: 'https://github.com/o/r#readme',
};

describe('collectUrls (FR-MKT-3)', () => {
  it('includes repository, bugs and homepage', () => {
    expect(collectUrls('', pkg)).toEqual(
      expect.arrayContaining(['https://github.com/o/r', 'https://github.com/o/r/issues', 'https://github.com/o/r#readme']));
  });

  it('includes absolute URLs from links and bare text, without trailing punctuation', () => {
    const urls = collectUrls('See [x](https://example.org/a) and https://example.org/b. Also <https://example.org/c>.', pkg);
    expect(urls).toEqual(expect.arrayContaining(['https://example.org/a', 'https://example.org/b', 'https://example.org/c']));
  });

  it('turns a relative image into the raw URL vsce publishes, and a relative link into the blob URL', () => {
    const urls = collectUrls('![a](media/shot.png)\n[l](LICENSE)\n[d](examples/README.md)', pkg);
    expect(urls).toContain('https://github.com/o/r/raw/HEAD/media/shot.png');
    expect(urls).toContain('https://github.com/o/r/blob/HEAD/LICENSE');
    expect(urls).toContain('https://github.com/o/r/blob/HEAD/examples/README.md');
  });

  it('ignores in-page anchors, command: links, localhost, and duplicates', () => {
    const urls = collectUrls('[a](#known-issues) [c](command:ds-ide.runEffect) http://localhost:3000/x [d](LICENSE) [e](LICENSE)', pkg);
    expect(urls.some((u) => u.includes('known-issues') || u.includes('command:') || u.includes('localhost'))).toBe(false);
    expect(urls.filter((u) => u.endsWith('/LICENSE'))).toHaveLength(1);
  });
});

describe('findBrokenUrls (FR-MKT-3)', () => {
  it('reports every URL that does not answer 200, with its status', async () => {
    const status = vi.fn(async (u: string) => (u.endsWith('/ok') ? 200 : 404));
    const broken = await findBrokenUrls(['https://x/ok', 'https://x/gone'], status);
    expect(broken).toEqual([{ url: 'https://x/gone', status: 404 }]);
  });

  it('reports a request that throws as broken, with the error text', async () => {
    const broken = await findBrokenUrls(['https://x/a'], async () => { throw new Error('ENOTFOUND'); });
    expect(broken).toEqual([{ url: 'https://x/a', status: 'ENOTFOUND' }]);
  });

  it('reports nothing when everything answers 200', async () => {
    expect(await findBrokenUrls(['https://x/a'], async () => 200)).toEqual([]);
  });
});
