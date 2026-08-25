// Shared codegen strategy helper (FR-EXT-37) — sdcard.ts, midi-trs.ts,
// midi-usb.ts, and oled.ts previously each redeclared the same shape (a
// handle-name constant, a decl regex, an init-prefix constant, and the
// strategy object) with ~70% identical boilerplate. `makeSimplePeripheralCodegen`
// factors out the fully bus-invariant case (sdcard, midi-trs: one fixed decl
// line, one or more fixed `${prefix});` init lines); midi-usb.ts and oled.ts
// call it for whichever half of their strategy (decl or init) is
// bus-invariant, then spread+override the bus-variant half.
import type { PeripheralCodegenStrategy } from './types';

// Builds a regex that recognizes `canonical` tolerantly of incidental
// whitespace differences (extra/collapsed spaces, leading/trailing
// whitespace) — mirrors the flexibility each hand-written DECL_RE already
// had, without hand-writing a new regex per peripheral.
function toFlexibleLineRegex(canonical: string): RegExp {
  const escaped = canonical
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+');
  return new RegExp(`^\\s*${escaped}\\s*$`);
}

export interface SimplePeripheralCodegenSpec {
  /** The single, bus-invariant declaration-block line. */
  declLine: string;
  /** One prefix per emitted init-block line; each line is `${prefix});`. */
  initLinePrefixes: string[];
}

export function makeSimplePeripheralCodegen(spec: SimplePeripheralCodegenSpec): PeripheralCodegenStrategy {
  const declLineRe = toFlexibleLineRegex(spec.declLine);
  return {
    declLine: () => spec.declLine,
    isDeclLine: (line) => declLineRe.test(line),
    initLines: () => spec.initLinePrefixes.map((prefix) => `${prefix});`),
    isInitLine: (line) => spec.initLinePrefixes.some((prefix) => line.startsWith(prefix)),
  };
}
