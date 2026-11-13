// Pure SD Card content-viewer helpers (FR-SD-1) — no DOM/fs access,
// unit-testable directly (FR-IPC-6's convention, mirroring midi-monitor.ts).
// Shared between the extension host (size cap, .txt detection when deciding
// whether to attempt a preview read) and the Controls Editor webview (size
// formatting, .txt detection when rendering rows).

export interface SdEntry {
  name: string;
  size: number;
}

// Preview reads are capped so a large file can't be pulled entirely into
// memory / the webview just to show a snippet (FR-SD-1's "size-capped").
export const SD_PREVIEW_MAX_BYTES = 8192;

export function isTxtEntryName(name: string): boolean {
  return name.toLowerCase().endsWith('.txt');
}

// Matches the mockup's B/KB/MB display convention (docs/mockups/m48-io-monitors.html).
export function formatSdSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function sortSdEntries(entries: readonly SdEntry[]): SdEntry[] {
  return [...entries].sort((a, b) => a.name.localeCompare(b.name));
}

/** Same names and sizes in the same order — used to skip a re-render (and so keep the user's scroll position) when nothing changed (FR-EXM-9). */
export function sdListingsEqual(a: readonly SdEntry[], b: readonly SdEntry[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((e, i) => e.name === b[i]!.name && e.size === b[i]!.size);
}

/** Files present in both listings whose size changed: their cached preview no longer matches the file (FR-EXM-9). */
export function sdStalePreviews(prev: readonly SdEntry[], next: readonly SdEntry[]): string[] {
  const before = new Map(prev.map(e => [e.name, e.size]));
  return next.filter(e => before.has(e.name) && before.get(e.name) !== e.size).map(e => e.name);
}
