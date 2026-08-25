import { describe, it, expect } from 'vitest';
import { escJ, truncId, TRUNC_MAX_LEN } from '../../../webview/controls/text-utils';

describe('escJ (FR-EXT-32)', () => {
  it('escapes HTML-significant characters', () => {
    expect(escJ('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  });

  it('stringifies non-string input', () => {
    expect(escJ(42)).toBe('42');
  });
});

describe('truncId (FR-EXT-32)', () => {
  it('leaves a short id unchanged', () => {
    expect(truncId('short')).toBe('short');
  });

  it('truncates an id longer than TRUNC_MAX_LEN with an ellipsis suffix', () => {
    const long = 'a'.repeat(TRUNC_MAX_LEN + 5);
    const result = truncId(long);
    expect(result.length).toBe(TRUNC_MAX_LEN);
    expect(result.endsWith('…')).toBe(true);
  });
});
