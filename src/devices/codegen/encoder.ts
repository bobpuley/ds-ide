// Encoder value semantics (FR-DEV-9). The wire carries an *accumulated
// position*, not a level or a delta — confirming the M43 assumption in
// docs/02_assumptions-and-risks.md that delta semantics fit
// controlValue{id,value} without a new message kind. Both the webview (which
// accumulates drag detents into a position) and the emulator shim (which
// derives a per-callback delta by diffing two accumulated positions) share
// this modulus and wrap math, so they can never disagree on what "wrapped"
// means.
export const ENCODER_POSITION_MODULUS = 1024;

// Wraps a raw accumulated position into [0, ENCODER_POSITION_MODULUS).
export function wrapEncoderPosition(raw: number): number {
  const m = ENCODER_POSITION_MODULUS;
  return ((Math.trunc(raw) % m) + m) % m;
}

// Shortest-path delta from `previous` to `current` (both already wrapped
// into [0, ENCODER_POSITION_MODULUS)), correctly handling the wraparound
// boundary — e.g. previous=1023, current=0 is a delta of +1 (one detent
// forward), not -1023.
export function encoderDelta(previous: number, current: number): number {
  const m = ENCODER_POSITION_MODULUS;
  let raw = current - previous;
  if (raw > m / 2) raw -= m;
  else if (raw < -m / 2) raw += m;
  return raw;
}
