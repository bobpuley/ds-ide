/// <reference lib="dom" />
// Runtime shape validation for JSON.parse'd webview data-island content
// (FR-EXT-28). Config/state the extension host embeds into
// `<script type="application/json">` data islands was previously parsed and
// cast straight to its TypeScript type with no check — malformed JSON threw
// during webview module init (blank panel, no diagnostic) and an
// unexpected-but-parseable shape silently propagated into later
// array/property access instead of failing loudly at the lookup site.
//
// `readDataIsland`'s parse+validate step takes no DOM input (a raw string
// in, a result out), so it's unit-testable directly; `showDataIslandError`
// is the DOM-touching half that surfaces a visible banner, kept in the same
// module since both only ever run together in a webview context. The `dom`
// lib reference (mirrors dom-lookup.ts) keeps this file type-checking under
// the Node-only main tsconfig that its vitest test is compiled under.

export interface DataIslandResult<T> {
  value: T;
  error: string | null;
}

// `isValid` is a light structural check (e.g. "is this an array of
// objects with the expected field types"), not exhaustive validation —
// good enough to catch a serialization bug or a corrupted DOM without
// re-implementing full schema validation in a webview script.
export function readDataIsland<T>(
  raw: string,
  isValid: (value: unknown) => value is T,
  fallback: T,
): DataIslandResult<T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { value: fallback, error: `malformed JSON (${err instanceof Error ? err.message : String(err)})` };
  }
  if (!isValid(parsed)) {
    return { value: fallback, error: 'unexpected shape after JSON.parse' };
  }
  return { value: parsed, error: null };
}

export function showDataIslandError(context: string, reason: string): void {
  const banner = document.createElement('div');
  banner.className = 'ds-data-island-error';
  banner.setAttribute('role', 'alert');
  banner.textContent = `ds-ide: failed to load "${context}" (${reason}) — some data may be missing or stale.`;
  document.body.prepend(banner);
}
