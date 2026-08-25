/// <reference lib="dom" />
// Shared DOM-lookup helper for webview-context scripts (FR-EXT-27). Every
// webview entry point previously redeclared its own `el<T>()` that cast away
// `document.getElementById`'s `| null` return type without checking it, so a
// markup/id typo surfaced as a cryptic "cannot read properties of null"
// deep inside unrelated code instead of a clear error at the lookup site.
//
// `getById` is injected (defaulting to `document.getElementById`) so this is
// unit-testable without a DOM, mirroring raf-coalesce.ts's injected-scheduler
// pattern.
export function el<T extends HTMLElement>(
  id: string,
  getById: (id: string) => HTMLElement | null = (lookupId) => document.getElementById(lookupId),
): T {
  const found = getById(id);
  if (found === null) {
    throw new Error(`ds-ide webview: expected element with id "${id}" not found in the DOM`);
  }
  return found as T;
}
