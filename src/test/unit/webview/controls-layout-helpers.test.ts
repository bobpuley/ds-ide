import { describe, it, expect } from 'vitest';
import { GRID_PX, snapToGrid, arrangeInRows, CARD_COL_PITCH, CARD_ROW_PITCH, createCascade, cascadePositions } from '../../../webview/controls/layout-helpers';

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

describe('arrangeInRows (FR-CEH-3)', () => {
  it('fills rows left to right, in the given order, starting at 20,20', () => {
    const out = arrangeInRows(3, 3 * CARD_COL_PITCH + 20);
    expect(out).toEqual([[20, 20], [20 + CARD_COL_PITCH, 20], [20 + 2 * CARD_COL_PITCH, 20]]);
  });

  it('wraps to a new row when the canvas width is full', () => {
    const out = arrangeInRows(5, 2 * CARD_COL_PITCH + 20);
    expect(out.map(p => p[1])).toEqual([20, 20, 20 + CARD_ROW_PITCH, 20 + CARD_ROW_PITCH, 20 + 2 * CARD_ROW_PITCH]);
    expect(out.map(p => p[0])).toEqual([20, 20 + CARD_COL_PITCH, 20, 20 + CARD_COL_PITCH, 20]);
  });

  it('uses at least one column however narrow the canvas is', () => {
    const out = arrangeInRows(3, 10);
    expect(out.map(p => p[0])).toEqual([20, 20, 20]);
    expect(out.map(p => p[1])).toEqual([20, 20 + CARD_ROW_PITCH, 20 + 2 * CARD_ROW_PITCH]);
  });

  it('honours a taller row pitch so tall cards do not overlap', () => {
    const out = arrangeInRows(2, 10, 260);
    expect(out[1]![1] - out[0]![1]).toBe(260);
  });

  it('never places two cards at the same position', () => {
    const out = arrangeInRows(23, 700);
    expect(new Set(out.map(p => p.join(','))).size).toBe(23);
  });

  it('returns nothing for no cards', () => {
    expect(arrangeInRows(0, 700)).toEqual([]);
  });
});

describe('default cascade (FR-CEH-4)', () => {
  it('starts at 20,20 and steps 190 px right, wrapping 170 px down after three columns', () => {
    expect(cascadePositions(5)).toEqual([[20, 20], [210, 20], [400, 20], [20, 190], [210, 190]]);
  });

  it('createCascade() hands out the same sequence one position at a time', () => {
    const next = createCascade();
    expect([next(), next(), next(), next()]).toEqual(cascadePositions(4));
  });

  it('never repeats a position', () => {
    expect(new Set(cascadePositions(30).map(p => p.join(','))).size).toBe(30);
  });
});
