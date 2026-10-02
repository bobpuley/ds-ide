// Capture ring for the Daisy Scope (FR-SCI-3). Pure — no DOM, no VS Code API.
//
// The emulator sends one decimated snapshot per 33 audio blocks, so a single
// snapshot spans only 33 × frames of signal: about 2.75 ms at a 4-frame block.
// Consecutive snapshots are contiguous in time (the drain thread accumulates
// every block and resets on emit), so stitching them gives a window that does
// not depend on the block size. See 04_architecture.md "Scope as an instrument".

export type ScopeChannel = 'in' | 'l' | 'r';

export interface ScopeSnapshot {
  in: readonly number[];
  out: readonly number[];
  outR?: readonly number[];
  /** Decimation factor the emulator applied (FR-SCI-2). Absent on older emulators. */
  step?: number;
}

// Mirrors ScopeState::accumulate in emulator/runtime/audio_engine.cpp.
const STEP_BASE = 4;
const STEP_BASE_FRAMES = 256;

/** Decimation the emulator uses for a block size; fallback when a snapshot carries no `step`. */
export function deriveStep(blockSize: number): number {
  return blockSize > STEP_BASE_FRAMES ? Math.floor((STEP_BASE * blockSize) / STEP_BASE_FRAMES) : STEP_BASE;
}

/**
 * Ring length: the widest time base (20 ms/div × 10 divisions = 200 ms) plus 100 ms,
 * so a trigger crossing still has a full window of data after it.
 */
export const DEFAULT_WINDOW_MS = 300;

export class ScopeCapture {
  private sampleRate = 0;
  private blockSize = 0;
  private step = STEP_BASE;
  private bufIn: number[] = [];
  private bufL: number[] = [];
  private bufR: number[] = [];

  /** @param windowMs how much signal the ring keeps (the largest time base plus trigger headroom). */
  constructor(private readonly windowMs = DEFAULT_WINDOW_MS) {}

  /**
   * Record the emulator configuration. Returns true — and clears the ring — when
   * the sample rate or block size changed, since older samples are at a stale rate.
   */
  setConfig(sampleRate: number, blockSize: number): boolean {
    if (sampleRate === this.sampleRate && blockSize === this.blockSize) return false;
    this.sampleRate = sampleRate;
    this.blockSize = blockSize;
    this.step = deriveStep(blockSize);
    this.clear();
    return true;
  }

  push(snap: ScopeSnapshot): void {
    const step = snap.step ?? deriveStep(this.blockSize);
    if (step !== this.step) {
      this.step = step;
      this.clear();
    }
    this.bufIn.push(...snap.in);
    this.bufL.push(...snap.out);
    if (snap.outR) this.bufR.push(...snap.outR);
    const cap = Math.max(this.windowCapacity(), snap.in.length);
    this.bufIn = trimTo(this.bufIn, cap);
    this.bufL = trimTo(this.bufL, cap);
    this.bufR = trimTo(this.bufR, cap);
  }

  clear(): void {
    this.bufIn = [];
    this.bufL = [];
    this.bufR = [];
  }

  /** Samples per second of the stored (decimated) signal; 0 until the sample rate is known. */
  get effectiveRate(): number {
    return this.sampleRate > 0 ? this.sampleRate / this.step : 0;
  }

  get length(): number {
    return this.bufIn.length;
  }

  channel(ch: ScopeChannel): readonly number[] {
    return ch === 'in' ? this.bufIn : ch === 'l' ? this.bufL : this.bufR;
  }

  private windowCapacity(): number {
    return Math.ceil((this.effectiveRate * this.windowMs) / 1000);
  }
}

function trimTo(buf: number[], cap: number): number[] {
  return buf.length > cap ? buf.slice(buf.length - cap) : buf;
}
