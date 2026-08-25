import { describe, it, expect, vi } from 'vitest';
import { el } from '../../../webview/dom-lookup';

describe('el (FR-EXT-27)', () => {
  it('returns the found element cast to the requested type', () => {
    const fakeButton = { tagName: 'BUTTON' } as unknown as HTMLElement;
    const getById = vi.fn().mockReturnValue(fakeButton);

    const result = el<HTMLButtonElement>('btn-audio-start', getById);

    expect(result).toBe(fakeButton);
    expect(getById).toHaveBeenCalledWith('btn-audio-start');
  });

  it('throws a descriptive error instead of silently returning null', () => {
    const getById = vi.fn().mockReturnValue(null);

    expect(() => el<HTMLElement>('missing-id', getById)).toThrow(/missing-id/);
  });
});
