// When the Scope asks the emulator for a full-rate triggered window (FR-SCI-14d). Pure — no DOM.
//
// The live scope stays on the decimated stream. A capture is requested only for
// an armed 1× Single and for a time base too fine for the stream (FR-SCI-4), and
// only with an edge trigger — the emulator's window is triggered, so free-run has
// nothing to ask for.

import type { TriggerMode, TriggerSource } from './scope-trigger';

/** At most ~5 new requests per second after a reply. */
export const MIN_REQUEST_INTERVAL_MS = 200;
/** An unanswered request is sent again: the emulator drops its arm on a config change. */
export const REARM_AFTER_MS = 2000;

export interface CaptureParams {
  source: TriggerSource;
  edge: 'rise' | 'fall';
  level: number;
}

export type CaptureCommand =
  | ({ action: 'arm' } & CaptureParams)
  | { action: 'cancel' };

export function wantsEmulatorCapture(s: {
  trigMode: TriggerMode; singleArmed: boolean; lowRes: boolean;
}): boolean {
  return s.trigMode !== 'free' && (s.singleArmed || s.lowRes);
}

export interface CapturePlanInput {
  wants: boolean;
  params: CaptureParams;
  /** The parameters of the request awaiting a reply, or null. */
  armed: CaptureParams | null;
  nowMs: number;
  /** When the last arm was sent. */
  lastArmMs: number;
}

const sameParams = (a: CaptureParams, b: CaptureParams): boolean =>
  a.source === b.source && a.edge === b.edge && a.level === b.level;

/** The message to send now, or null. */
export function planCapture(s: CapturePlanInput): CaptureCommand | null {
  if (!s.wants) return s.armed ? { action: 'cancel' } : null;
  const since = s.nowMs - s.lastArmMs;
  if (s.armed) {
    const changed = !sameParams(s.armed, s.params);
    if (!changed && since < REARM_AFTER_MS) return null;
    if (changed && since < MIN_REQUEST_INTERVAL_MS) return null;
  } else if (since < MIN_REQUEST_INTERVAL_MS) {
    return null;
  }
  return { action: 'arm', ...s.params };
}
