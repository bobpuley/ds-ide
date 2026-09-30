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

export interface TraceDef {
  id: 'in' | 'l' | 'r';
  label: string;
  cssVar: string;
  /** Canvas / SVG line-dash pattern; differs per trace so colour is not the only cue. */
  dash: number[];
}

/** The scope's traces: input, left output, right output (FR-SCI-6). */
export const TRACES: readonly TraceDef[] = [
  { id: 'in', label: 'In', cssVar: '--ds-trace-in', dash: [] },
  { id: 'l', label: 'Out L', cssVar: '--ds-trace-out', dash: [7, 4] },
  { id: 'r', label: 'Out R', cssVar: '--ds-trace-out-r', dash: [1.5, 3.5] },
];

export const GAIN_STEPS = [1, 2, 4] as const;
export type GainMode = 'auto' | (typeof GAIN_STEPS)[number];
export type AmpUnit = 'lin' | 'db';

const AUTO_FILL = 0.9;
const MAX_AUTO_GAIN = 64;
/** The dB scale spans this many dB below full scale. */
const DB_FLOOR = -60;
/** Positions are clamped to this, so an overdriven trace stays near the plot. */
const MAX_POSITION = 1.5;

/** Gain that fits `peak` into 90% of the plot; never below x1, capped at x64. */
export function autoGain(peak: number): number {
  if (!(peak > 0)) return 1;
  return Math.min(MAX_AUTO_GAIN, Math.max(1, AUTO_FILL / peak));
}

export function peakAbs(samples: readonly number[], start: number, count: number): number {
  let peak = 0;
  for (let i = start; i < start + count; i++) peak = Math.max(peak, Math.abs(samples[i] ?? 0));
  return peak;
}

/**
 * Vertical position of a sample as a fraction of the half-height: 0 is the
 * centre, +1 the top edge, -1 the bottom edge. Linear scales by the gain; dBFS
 * maps level in dB (after gain) onto the half-height over a 60 dB range.
 */
export function samplePosition(sample: number, gain: number, unit: AmpUnit): number {
  const pos = unit === 'lin' ? sample * gain : dbPosition(Math.abs(sample * gain)) * Math.sign(sample);
  return Math.max(-MAX_POSITION, Math.min(MAX_POSITION, pos));
}

function dbPosition(magnitude: number): number {
  if (magnitude <= 0) return 0;
  const db = Math.max(DB_FLOOR, 20 * Math.log10(magnitude));
  return (db - DB_FLOOR) / -DB_FLOOR;
}

/** Inverse of samplePosition (ignoring its clamp): the sample value drawn at a vertical position. */
export function positionToSample(pos: number, gain: number, unit: AmpUnit): number {
  if (pos === 0) return 0;
  if (unit === 'lin') return pos / gain;
  const db = Math.abs(pos) * -DB_FLOOR + DB_FLOOR;
  return (Math.sign(pos) * 10 ** (db / 20)) / gain;
}

const DB_TICKS = [0, -6, -20, -40];

/**
 * Amplitude-axis ticks. `pos` is a fraction of the half-height (see samplePosition).
 * Labels show the signal level each line represents at the current gain.
 */
export function amplitudeTicks(gain: number, unit: AmpUnit): { pos: number; label: string }[] {
  if (unit === 'db') {
    const gainDb = 20 * Math.log10(gain);
    const ticks: { pos: number; label: string }[] = [];
    for (const d of DB_TICKS) ticks.push({ pos: (d - DB_FLOOR) / -DB_FLOOR, label: `${Math.round(d - gainDb)} dB` });
    for (const d of DB_TICKS) ticks.push({ pos: -(d - DB_FLOOR) / -DB_FLOOR, label: '' });
    ticks.push({ pos: 0, label: '' });
    return ticks;
  }
  return [1, 0.5, 0, -0.5, -1].map(pos => ({ pos, label: linearLabel(pos / gain) }));
}

function linearLabel(v: number): string {
  if (v === 0) return '0';
  const sign = v > 0 ? '+' : '-';
  const a = Math.abs(v);
  return sign + (Number.isInteger(a * 10) ? a.toFixed(1) : a.toFixed(a < 0.1 ? 3 : 2));
}

/**
 * Index, within the visible window, of the sample under a horizontal position
 * (`fraction` of the plot width, 0 = left). Sample i is drawn at i / (span - 1),
 * the same mapping the webview uses when it draws. Null outside the plot or
 * where the capture has no sample.
 */
export function cursorIndex(fraction: number, span: number, count: number): number | null {
  if (fraction < 0 || fraction > 1 || span < 2 || count < 1) return null;
  const index = Math.round(fraction * (span - 1));
  return index < count ? index : null;
}

function signed(v: number): string {
  return (v >= 0 ? '+' : '-') + Math.abs(v).toFixed(3);
}

/** Cursor read-out text: time in ms and the value of each visible channel. */
export function formatReadout(timeMs: number, values: readonly { label: string; value: number }[]): string {
  return [`t ${timeMs.toFixed(2)} ms`, ...values.map(v => `${v.label} ${signed(v.value)}`)].join('   ');
}

function formatNumber(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(2)));
}
