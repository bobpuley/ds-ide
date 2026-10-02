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

const CASCADE_WRAP_X = 580;

/**
 * The default layout for cards with no stored position: left to right in
 * 190 px steps, wrapping 170 px down once the next x would pass 580. Shared
 * by the canvas's first render and the Reset positions button (FR-CEH-4).
 */
export function createCascade(): () => Pos {
  let x = MARGIN;
  let y = MARGIN;
  return (): Pos => {
    const p: Pos = [x, y];
    x += CARD_COL_PITCH;
    if (x > CASCADE_WRAP_X) { x = MARGIN; y += CARD_ROW_PITCH; }
    return p;
  };
}

export function cascadePositions(count: number): Pos[] {
  const next = createCascade();
  return Array.from({ length: count }, () => next());
}
