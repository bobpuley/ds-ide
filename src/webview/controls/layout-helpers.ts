// Pure card-layout math for the Controls Editor header buttons (FR-CEH-2..4).
// DOM-free so it is unit-testable; layout-actions.ts applies the results.
export type Pos = [number, number];

export const GRID_PX = 20;

/** Nearest grid line for each coordinate; never negative. */
export function snapToGrid(pos: Pos): Pos {
  const snap = (v: number): number => Math.max(0, Math.round(v / GRID_PX) * GRID_PX);
  return [snap(pos[0]), snap(pos[1])];
}

/** Cell size of the default cascade and of auto-arrange (card min-width 132 px + gap). */
export const CARD_COL_PITCH = 190;
export const CARD_ROW_PITCH = 170;
const MARGIN = 20;

/**
 * Positions for `count` cards laid out in rows, left to right, wrapping when
 * the next card would not fit the canvas width (always at least one column).
 * `rowPitch` can be raised to the tallest card's height + gap to avoid overlap.
 */
export function arrangeInRows(count: number, canvasWidth: number, rowPitch: number = CARD_ROW_PITCH): Pos[] {
  const cols = Math.max(1, Math.floor((canvasWidth - MARGIN) / CARD_COL_PITCH));
  return Array.from({ length: count }, (_, i): Pos => [
    MARGIN + (i % cols) * CARD_COL_PITCH,
    MARGIN + Math.floor(i / cols) * rowPitch,
  ]);
}
