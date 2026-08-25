// Small text helpers shared across the Controls Editor's canvas modules
// (FR-EXT-32).
export function escJ(s: unknown): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// truncId/TRUNC_MAX_LEN live in ../id-truncate.ts, shared with
// controls-editor-panel.ts's host-side copy (FR-EXT-38) — re-exported here
// so existing callers in this directory don't need to change their import.
export { truncId, TRUNC_MAX_LEN } from '../id-truncate';
