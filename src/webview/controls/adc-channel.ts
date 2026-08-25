// Webview-local ADC channel mapping (FR-EXT-32, extracted from
// controls-webview.ts) — mirrors codegen/pot.ts's pinToAdcChannel but
// degrades to channel 0 for a non-ADC pin instead of throwing: this only
// ever drives a visual channel-number label, and a pin momentarily out of
// range mid-render must not crash the whole Controls Editor panel the way a
// codegen-time error legitimately should (FR-EXT-31 draws that same
// distinction from the other side).
export function adcChannelFromPin(pin: number): number {
  if (pin >= 15 && pin <= 25) return pin - 15;
  if (pin === 28) return 11;
  return 0;
}
