// Toggle switch value semantics (FR-DEV-7). Switch3 reports an integer
// position — 0, 1, or 2 — rather than pot's continuous [0,1] or button's
// boolean. Shared by the extension-host webview handler (ToggleStore.set)
// and anything else that accepts a raw position value, so a stray
// fractional or out-of-range value never reaches Switch3::Read() (the
// TS-side counterpart to the C++ dispatcher's own range check).
export const TOGGLE_POSITIONS = 3;

export function clampTogglePosition(raw: number): number {
  const rounded = Math.round(raw);
  return Math.min(TOGGLE_POSITIONS - 1, Math.max(0, rounded));
}
