// Detects linker "undefined symbol / undefined reference" errors that arise when
// effect source uses hardware-only APIs not provided by the host shim (FR-BU-5).

// clang/ld64:   "Undefined symbols for architecture …" then "  \"_symbolName\", …"
// gold/lld:     "undefined reference to `symbolName'"
const UNDEF_CLANG_RE = /^\s+"(_\w+)",\s+referenced from:/;
const UNDEF_GNU_RE   = /undefined reference to `([^']+)'/;

export function detectNonPortableSymbol(buildLines: string[]): string[] {
  const syms: string[] = [];
  for (const line of buildLines) {
    const m = UNDEF_CLANG_RE.exec(line) ?? UNDEF_GNU_RE.exec(line);
    if (m) {
      // Strip leading underscore (macOS name-mangling) for display
      syms.push(m[1]!.replace(/^_/, ''));
    }
  }
  return syms;
}
