// Edge trigger for the Daisy Scope (FR-SCI-9). Pure — no DOM.
//
// A trigger picks where in the capture the plot starts, so a periodic wave is
// drawn from the same phase every frame and stands still.

export type TriggerMode = 'free' | 'rise' | 'fall';
export type TriggerSource = 'in' | 'l';

export interface TriggerResult {
  /** Index in the capture where the plot starts. */
  start: number;
  /** True when an edge was found; false for free run. */
  locked: boolean;
}

/**
 * Where the plot should start for a window of `window` samples.
 *
 * Free run shows the newest window. An edge mode takes the latest crossing that
 * still leaves a full window — so the display shows current data — or, when the
 * capture is shorter than the window, the earliest crossing. Returns null when
 * no crossing exists. A crossing needs a sample before it, so index 0 never triggers.
 */
export function triggerStart(
  samples: readonly number[], window: number, mode: TriggerMode, level: number,
): TriggerResult | null {
  const n = samples.length;
  if (mode === 'free') return { start: Math.max(0, n - window), locked: false };
  const crosses = (i: number): boolean => {
    const prev = samples[i - 1] ?? 0;
    const cur = samples[i] ?? 0;
    return mode === 'rise' ? prev < level && cur >= level : prev > level && cur <= level;
  };
  if (n <= window) {
    for (let i = 1; i < n; i++) if (crosses(i)) return { start: i, locked: true };
    return null;
  }
  for (let i = n - window; i >= 1; i--) if (crosses(i)) return { start: i, locked: true };
  return null;
}
