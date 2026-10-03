import { describe, it, expect } from 'vitest';
import {
  CHIPS, chipLabel, isDefault, defaultState, isGroupDisabled, placePopover, type ChipId,
} from '../../../webview/scope/scope-chips';

const chip = (id: ChipId) => CHIPS.find(c => c.id === id)!;

describe('scope chips (FR-SCI-15)', () => {
  it('defines the five chips in toolbar order', () => {
    expect(CHIPS.map(c => c.id)).toEqual(['gain', 'scale', 'trigger', 'faxis', 'lmode']);
  });

  it('labels every Gain, Scale, frequency-axis and level-mode value', () => {
    expect(['1', '2', '4', 'auto'].map(v => chipLabel(chip('gain'), { gain: v }))).toEqual(['×1', '×2', '×4', 'Auto']);
    expect(['lin', 'db'].map(v => chipLabel(chip('scale'), { unit: v }))).toEqual(['Linear', 'dBFS']);
    expect(['lin', 'log'].map(v => chipLabel(chip('faxis'), { fscale: v }))).toEqual(['Lin Hz', 'Log Hz']);
    expect(['rel', 'abs'].map(v => chipLabel(chip('lmode'), { lmode: v }))).toEqual(['Relative', 'Absolute dBFS']);
  });

  it('labels the Trigger chip Free, or edge glyph plus source', () => {
    const t = chip('trigger');
    expect(chipLabel(t, { edge: 'free', source: 'in' })).toBe('Free');
    expect(chipLabel(t, { edge: 'free', source: 'l' })).toBe('Free');
    expect(chipLabel(t, { edge: 'rise', source: 'in' })).toBe('↗ In');
    expect(chipLabel(t, { edge: 'fall', source: 'l' })).toBe('↘ L');
  });

  it('gives the Trigger menu Edge and Source groups, Source disabled while Free', () => {
    const t = chip('trigger');
    expect(t.groups.map(g => g.title)).toEqual(['Edge', 'Source']);
    expect(isGroupDisabled(t, 'source', { edge: 'free', source: 'in' })).toBe(true);
    expect(isGroupDisabled(t, 'source', { edge: 'rise', source: 'in' })).toBe(false);
    expect(isGroupDisabled(t, 'edge', { edge: 'free', source: 'in' })).toBe(false);
  });

  it('is at default exactly at Gain ×1, Linear, Free, Log Hz and Absolute dBFS', () => {
    expect(isDefault(chip('gain'), { gain: '1' })).toBe(true);
    expect(isDefault(chip('gain'), { gain: 'auto' })).toBe(false);
    expect(isDefault(chip('scale'), { unit: 'lin' })).toBe(true);
    expect(isDefault(chip('scale'), { unit: 'db' })).toBe(false);
    expect(isDefault(chip('trigger'), { edge: 'free', source: 'in' })).toBe(true);
    expect(isDefault(chip('trigger'), { edge: 'rise', source: 'in' })).toBe(false);
    expect(isDefault(chip('faxis'), { fscale: 'log' })).toBe(true);
    expect(isDefault(chip('faxis'), { fscale: 'lin' })).toBe(false);
    expect(isDefault(chip('lmode'), { lmode: 'abs' })).toBe(true);
    expect(isDefault(chip('lmode'), { lmode: 'rel' })).toBe(false);
  });

  it('treats Free with the L source as default, since the source has no effect while Free', () => {
    expect(isDefault(chip('trigger'), { edge: 'free', source: 'l' })).toBe(true);
  });

  it('defaultState seeds every group with its default value', () => {
    expect(defaultState()).toEqual({
      gain: '1', unit: 'lin', edge: 'free', source: 'in', fscale: 'log', lmode: 'abs',
    });
  });

  describe('placePopover (FR-SCI-16)', () => {
    const view = { width: 600, height: 400 };
    const size = { width: 120, height: 100 };
    it('opens below the chip, left-aligned', () => {
      expect(placePopover({ left: 50, top: 20, bottom: 40 }, size, view)).toEqual({ left: 50, top: 42, flipped: false });
    });
    it('flips above when it would leave the viewport at the bottom', () => {
      expect(placePopover({ left: 50, top: 340, bottom: 360 }, size, view)).toEqual({ left: 50, top: 238, flipped: true });
    });
    it('stays below when there is no room above either', () => {
      expect(placePopover({ left: 50, top: 60, bottom: 80 }, { width: 120, height: 400 }, view).flipped).toBe(false);
    });
    it('shifts left to stay within the viewport width', () => {
      expect(placePopover({ left: 540, top: 20, bottom: 40 }, size, view).left).toBe(600 - 120 - 4);
    });
    it('never goes past the left edge', () => {
      expect(placePopover({ left: -30, top: 20, bottom: 40 }, size, view).left).toBe(4);
    });
  });
});
