import { describe, it, expect } from 'vitest';
import { GRID_PX, snapToGrid } from '../../../webview/controls/layout-helpers';

describe('snapToGrid (FR-CEH-2)', () => {
  it('uses a 20 px grid', () => {
    expect(GRID_PX).toBe(20);
  });

  it('rounds each coordinate to the nearest grid line', () => {
    expect(snapToGrid([29, 31])).toEqual([20, 40]);
    expect(snapToGrid([30, 50])).toEqual([40, 60]);
    expect(snapToGrid([11, 9])).toEqual([20, 0]);
  });

  it('leaves an already-aligned position unchanged', () => {
    expect(snapToGrid([40, 120])).toEqual([40, 120]);
  });

  it('never returns a negative coordinate', () => {
    expect(snapToGrid([-30, -5])).toEqual([0, 0]);
  });
});
