// Small text helpers shared across the Controls Editor's canvas modules
// (FR-EXT-32). `truncId`/`TRUNC_MAX_LEN` duplicate controls-editor-panel.ts's
// host-side copy — unifying them into one cross-tsconfig-importable module is
// FR-EXT-38's job, not this split's; this file exists so that follow-up has
// one obvious import site to repoint instead of five.
export function escJ(s: unknown): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export const TRUNC_MAX_LEN = 15;
const TRUNC_SUFFIX = '…';
export function truncId(id: string): string {
  return id.length > TRUNC_MAX_LEN ? id.slice(0, TRUNC_MAX_LEN - 1) + TRUNC_SUFFIX : id;
}
