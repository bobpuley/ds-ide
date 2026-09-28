import { describe, it, expect } from 'vitest';
import { safeJson, escapeHtml } from '../../../webview/html-safe';

describe('safeJson (FR-EXT-26)', () => {
  it('serializes a plain object to JSON', () => {
    expect(safeJson({ a: 1, b: 'two' })).toBe('{"a":1,"b":"two"}');
  });

  it('escapes </script>-breakout characters so embedded JSON cannot close the surrounding tag', () => {
    const out = safeJson({ label: '</script><script>alert(1)</script>' });
    expect(out).not.toContain('</script>');
    expect(out).not.toContain('<script>');
    expect(out).toContain('\\u003c');
    expect(out).toContain('\\u003e');
  });

  it('escapes ampersands', () => {
    expect(safeJson({ a: 'x & y' })).toContain('\\u0026');
  });
});

describe('escapeHtml', () => {
  it('escapes markup and quote characters', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`))
      .toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  });
});
