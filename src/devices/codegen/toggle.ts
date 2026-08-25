// Toggle switch value semantics (FR-DEV-7). Switch3 reports an integer
// position — 0, 1, or 2 — rather than pot's continuous [0,1] or button's
// boolean. Shared by the extension-host webview handler (ToggleStore.set)
// and anything else that accepts a raw position value, so a stray
// fractional or out-of-range value never reaches Switch3::Read() (the
// TS-side counterpart to the C++ dispatcher's own range check).
export const TOGGLE_POSITIONS = 3;

// FR-EXT-31: the "fall back only for values with a genuinely intended
// default" half of the shared codegen error contract (see pot.ts's
// pinToAdcChannel and midi-usb.ts's initLines() for the "throw for
// structurally-impossible input" half) — clamping a continuous position
// into Switch3's valid range is the real dispatcher's own documented
// behavior, not a masked bug, so this deliberately does not throw.
export function clampTogglePosition(raw: number): number {
  const rounded = Math.round(raw);
  return Math.min(TOGGLE_POSITIONS - 1, Math.max(0, rounded));
}
