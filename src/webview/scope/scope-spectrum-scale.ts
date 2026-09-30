// Axis maths for the Daisy Scope's spectrum (FR-SCI-11). Pure — no DOM.

export type FreqScale = 'lin' | 'log';
export type LevelMode = 'rel' | 'abs';

/** Left edge of the log frequency axis. */
export const MIN_LOG_HZ = 20;

// The emulator's FFT (magnitude_spectrum in audio_engine.cpp) applies a Hann
// window and scales by 2/N, so a full-scale sine reads 0.5. Absolute dBFS
// undoes the window's coherent gain so that sine reads 0 dBFS.
const HANN_COHERENT_GAIN = 2;

/** Horizontal position, 0..1, of a frequency on the axis. */
export function freqPosition(hz: number, scale: FreqScale, maxHz: number): number {
  if (scale === 'lin') return Math.max(0, Math.min(1, hz / maxHz));
  if (hz <= MIN_LOG_HZ) return 0;
  return Math.max(0, Math.min(1, Math.log(hz / MIN_LOG_HZ) / Math.log(maxHz / MIN_LOG_HZ)));
}

const LIN_TICKS = [0, 5000, 10000, 15000, 20000];
const LOG_TICKS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];

function hzLabel(hz: number): string {
  return hz >= 1000 ? `${hz / 1000}k` : String(hz);
}

export function freqTicks(scale: FreqScale, maxHz: number): { hz: number; label: string }[] {
  return (scale === 'lin' ? LIN_TICKS : LOG_TICKS)
    .filter(hz => hz <= maxHz)
    .map(hz => ({ hz, label: hzLabel(hz) }));
}

/**
 * Level in dB for a magnitude from the emulator's FFT. Absolute mode is dBFS;
 * relative mode is dB below the running peak of the visible bins.
 */
export function levelToDb(magnitude: number, mode: LevelMode, peak: number): number {
  if (!(magnitude > 0)) return -Infinity;
  if (mode === 'abs') return 20 * Math.log10(magnitude * HANN_COHERENT_GAIN);
  return peak > 0 ? 20 * Math.log10(magnitude / peak) : -Infinity;
}

/** How many dB below 0 the vertical axis spans. */
export function dbRange(mode: LevelMode): number {
  return mode === 'abs' ? 90 : 60;
}

/** Vertical position, 0 (top, 0 dB) .. 1 (bottom, the floor). */
export function dbPosition(db: number, range: number): number {
  if (!Number.isFinite(db)) return 1;
  return Math.max(0, Math.min(1, -db / range));
}

export function dbTicks(range: number): number[] {
  const ticks: number[] = [];
  for (let db = 0; db >= -range; db -= 20) ticks.push(db);
  return ticks;
}
