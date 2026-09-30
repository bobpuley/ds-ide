// Per-channel level meters for the Daisy Scope (FR-SCI-8). Pure — no DOM.
//
// Fed one scope snapshot at a time. The stream is decimated, so a clipped sample
// that falls between kept samples is not seen; M72's full-rate capture closes
// that gap (02_assumptions-and-risks.md).

import type { ScopeChannel } from './scope-capture';

/** A sample at or above this magnitude counts as full scale. */
export const CLIP_LEVEL = 0.999;
/** The bar spans this many dB below full scale. */
const BAR_FLOOR_DB = -60;

export function measure(samples: readonly number[]): { peak: number; rms: number } {
  if (samples.length === 0) return { peak: 0, rms: 0 };
  let peak = 0;
  let sumSquares = 0;
  for (const s of samples) {
    peak = Math.max(peak, Math.abs(s));
    sumSquares += s * s;
  }
  return { peak, rms: Math.sqrt(sumSquares / samples.length) };
}

export function toDb(linear: number): number {
  return linear > 0 ? 20 * Math.log10(linear) : -Infinity;
}

export function formatDb(db: number): string {
  return Number.isFinite(db) ? db.toFixed(1) : '−∞';
}

/** Bar fill, 0..1, for a level in dBFS on a -60..0 dB scale. */
export function meterPosition(db: number): number {
  if (!Number.isFinite(db)) return 0;
  return Math.max(0, Math.min(1, (db - BAR_FLOOR_DB) / -BAR_FLOOR_DB));
}

export interface MeterState {
  peakDb: number;
  rmsDb: number;
  holdDb: number;
  clipped: boolean;
}

const CHANNELS: readonly ScopeChannel[] = ['in', 'l', 'r'];

function silent(): MeterState {
  return { peakDb: -Infinity, rmsDb: -Infinity, holdDb: -Infinity, clipped: false };
}

export class Meters {
  private readonly channels: Record<ScopeChannel, MeterState> = { in: silent(), l: silent(), r: silent() };

  update(ch: ScopeChannel, samples: readonly number[]): void {
    if (samples.length === 0) return;
    const { peak, rms } = measure(samples);
    const m = this.channels[ch];
    m.peakDb = toDb(peak);
    m.rmsDb = toDb(rms);
    m.holdDb = Math.max(m.holdDb, m.peakDb);
    if (peak >= CLIP_LEVEL) m.clipped = true;
  }

  state(ch: ScopeChannel): Readonly<MeterState> {
    return this.channels[ch];
  }

  clearClip(ch: ScopeChannel): void {
    this.channels[ch].clipped = false;
  }

  /** Clears the peak holds and every clip latch. */
  resetPeaks(): void {
    for (const ch of CHANNELS) {
      this.channels[ch].holdDb = -Infinity;
      this.channels[ch].clipped = false;
    }
  }

  /** Distance of the loudest current peak from 0 dBFS; null while everything is silent. */
  headroomDb(): number | null {
    const worst = Math.max(...CHANNELS.map(ch => this.channels[ch].peakDb));
    return Number.isFinite(worst) ? -worst : null;
  }
}
