// Pure view maths for the Daisy Scope (FR-SCI-4, FR-SCI-5): time base, visible
// window and axis ticks. No DOM — scope-webview.ts draws from these.

export const TIME_BASES_MS = [0.5, 1, 2, 5, 10] as const;
export const DEFAULT_TIME_BASE_MS = 2;
export const DIVISIONS = 10;
/** Below this many points per division a time base is flagged as low resolution. */
export const MIN_POINTS_PER_DIV = 20;

/** Samples covering all ten divisions at the effective (decimated) rate; 0 while the rate is unknown. */
export function windowSamples(msPerDiv: number, effectiveRate: number): number {
  return Math.max(0, Math.round((msPerDiv * DIVISIONS * effectiveRate) / 1000));
}

export function pointsPerDivision(msPerDiv: number, effectiveRate: number): number {
  return (msPerDiv * effectiveRate) / 1000;
}

export function isLowResolution(msPerDiv: number, effectiveRate: number): boolean {
  return effectiveRate > 0 && pointsPerDivision(msPerDiv, effectiveRate) < MIN_POINTS_PER_DIV;
}

/** The most recent `window` samples of a capture of `total` samples (or all of it when shorter). */
export function visibleRange(total: number, window: number): { start: number; count: number } {
  const count = Math.min(total, window);
  return { start: total - count, count };
}

/** Time-axis ticks every two divisions, labelled in ms. */
export function timeTicks(msPerDiv: number): { div: number; label: string }[] {
  const ticks: { div: number; label: string }[] = [];
  for (let div = 0; div <= DIVISIONS; div += 2) ticks.push({ div, label: formatNumber(div * msPerDiv) });
  return ticks;
}

/** Amplitude-axis ticks, full scale ±1.0. */
export function amplitudeTicks(): { value: number; label: string }[] {
  return [1, 0.5, 0, -0.5, -1].map(value => ({
    value,
    label: value === 0 ? '0' : (value > 0 ? '+' : '-') + Math.abs(value).toFixed(1),
  }));
}

function formatNumber(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(2)));
}
