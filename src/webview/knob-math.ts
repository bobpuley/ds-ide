// Pure geometry for the Controls Editor's pot knob SVG — no DOM access, so it
// can be unit-tested directly instead of only through a browser (FR-IPC-6).

const CENTER = 26;
const TRACK_RADIUS = 20;
const DOT_RADIUS = 14;
const START_DEG = -225;
const RANGE_DEG = 270;

export const KNOB_SVG_SIZE = 52;

export interface KnobGeometry {
  clampedValue: number;
  trackPath: string;
  // null when the value arc is too short to render (span <= 0.1deg).
  valuePath: string | null;
  dotX: number;
  dotY: number;
}

function toRad(deg: number): number {
  return deg * Math.PI / 180;
}

function fmt(n: number): string {
  return n.toFixed(2);
}

export function computeKnobGeometry(value: number): KnobGeometry {
  const clampedValue = Math.max(0, Math.min(1, value));
  const svgAngle = toRad(START_DEG + clampedValue * RANGE_DEG);

  const x0 = CENTER + TRACK_RADIUS * Math.cos(toRad(START_DEG));
  const y0 = CENTER + TRACK_RADIUS * Math.sin(toRad(START_DEG));
  const x1 = CENTER + TRACK_RADIUS * Math.cos(toRad(START_DEG + RANGE_DEG));
  const y1 = CENTER + TRACK_RADIUS * Math.sin(toRad(START_DEG + RANGE_DEG));
  const xa = CENTER + TRACK_RADIUS * Math.cos(svgAngle);
  const ya = CENTER + TRACK_RADIUS * Math.sin(svgAngle);
  const dotX = CENTER + DOT_RADIUS * Math.cos(svgAngle);
  const dotY = CENTER + DOT_RADIUS * Math.sin(svgAngle);

  const span = clampedValue * RANGE_DEG;
  const largeArc = span > 180 ? 1 : 0;

  const trackPath = `M ${fmt(x0)} ${fmt(y0)} A ${TRACK_RADIUS} ${TRACK_RADIUS} 0 1 1 ${fmt(x1)} ${fmt(y1)}`;
  const valuePath = span > 0.1
    ? `M ${fmt(x0)} ${fmt(y0)} A ${TRACK_RADIUS} ${TRACK_RADIUS} 0 ${largeArc} 1 ${fmt(xa)} ${fmt(ya)}`
    : null;

  return { clampedValue, trackPath, valuePath, dotX, dotY };
}
