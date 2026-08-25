// Pure id allocation/validation for the Wiring Editor popup — no DOM access,
// so it can be unit-tested directly instead of only through a browser (FR-IPC-6).
import { WiredPin, DeviceType } from './wiring-panel';

export function defaultId(kind: DeviceType, wiredPins: WiredPin[]): string {
  const used = new Set(wiredPins.filter((wp) => wp.deviceType === kind).map((wp) => wp.id));
  for (let n = 1; ; n++) {
    const candidate = kind + n;
    if (!used.has(candidate)) return candidate;
  }
}

// FR-EXT-11: the id is interpolated unescaped into generated C++
// declaration/init lines (controls-writer.ts) — a value that isn't a valid
// C++ identifier could otherwise corrupt the generated source.
const CPP_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

// C++17 keywords: syntactically valid identifiers but reserved by the
// language, so using one as a wired-control id would generate
// non-compiling (or, if it happens to also be a valid statement, silently
// wrong) C++ declarations.
const CPP_KEYWORDS = new Set([
  'alignas', 'alignof', 'and', 'and_eq', 'asm', 'auto', 'bitand', 'bitor',
  'bool', 'break', 'case', 'catch', 'char', 'char8_t', 'char16_t', 'char32_t',
  'class', 'compl', 'concept', 'const', 'consteval', 'constexpr', 'constinit',
  'const_cast', 'continue', 'co_await', 'co_return', 'co_yield', 'decltype',
  'default', 'delete', 'do', 'double', 'dynamic_cast', 'else', 'enum',
  'explicit', 'export', 'extern', 'false', 'float', 'for', 'friend', 'goto',
  'if', 'inline', 'int', 'long', 'mutable', 'namespace', 'new', 'noexcept',
  'not', 'not_eq', 'nullptr', 'operator', 'or', 'or_eq', 'private',
  'protected', 'public', 'register', 'reinterpret_cast', 'requires',
  'return', 'short', 'signed', 'sizeof', 'static', 'static_assert',
  'static_cast', 'struct', 'switch', 'template', 'this', 'thread_local',
  'throw', 'true', 'try', 'typedef', 'typeid', 'typename', 'union',
  'unsigned', 'using', 'virtual', 'void', 'volatile', 'wchar_t', 'while',
  'xor', 'xor_eq',
]);

export function validateId(val: string, wiredPins: WiredPin[]): string | null {
  const trimmed = val.trim();
  if (!trimmed) return 'id cannot be empty';
  if (!CPP_IDENTIFIER.test(trimmed)) {
    return 'id must be a valid C++ identifier (letters, digits, underscore; cannot start with a digit)';
  }
  if (CPP_KEYWORDS.has(trimmed)) return `id '${trimmed}' is a reserved C++ keyword`;
  const existing = wiredPins.find((wp) => wp.id === trimmed);
  if (existing) return `id already used by pin ${existing.pinNumber}`;
  return null;
}
