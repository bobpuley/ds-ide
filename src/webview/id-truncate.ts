// Shared id-truncation helper (FR-EXT-38) — previously defined twice, once
// exported from controls-editor-panel.ts (host side) and once re-declared
// unexported inside controls-webview.ts (webview side), because the two run
// under different tsconfigs (tsconfig.json vs tsconfig.webview.json). No DOM
// access, so — like sd-viewer.ts/html-safe.ts — this compiles under both and
// is importable from either side.
export const TRUNC_MAX_LEN = 15;
const TRUNC_SUFFIX = '…';

export function truncId(id: string): string {
  return id.length > TRUNC_MAX_LEN ? id.slice(0, TRUNC_MAX_LEN - 1) + TRUNC_SUFFIX : id;
}
