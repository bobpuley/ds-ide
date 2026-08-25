import { describe, it, expect } from 'vitest';
import { truncId, TRUNC_MAX_LEN } from '../../../webview/id-truncate';

describe('truncId (FR-EXT-38)', () => {
  it('leaves an id at or under TRUNC_MAX_LEN unchanged', () => {
    expect(truncId('short')).toBe('short');
    expect(truncId('exactly15chars!')).toBe('exactly15chars!');
  });

  it('truncates an id longer than TRUNC_MAX_LEN to TRUNC_MAX_LEN chars with an ellipsis suffix', () => {
    const result = truncId('tap_tempo_sync_btn');
    expect(result.length).toBe(TRUNC_MAX_LEN);
    expect(result.endsWith('…')).toBe(true);
  });
});
