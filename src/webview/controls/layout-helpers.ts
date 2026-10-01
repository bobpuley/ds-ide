// Pure card-layout math for the Controls Editor header buttons (FR-CEH-2..4).
// DOM-free so it is unit-testable; layout-actions.ts applies the results.
export type Pos = [number, number];

export const GRID_PX = 20;

/** Nearest grid line for each coordinate; never negative. */
export function snapToGrid(pos: Pos): Pos {
  const snap = (v: number): number => Math.max(0, Math.round(v / GRID_PX) * GRID_PX);
  return [snap(pos[0]), snap(pos[1])];
}
