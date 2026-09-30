// Host side of the Scope's snapshot and export buttons (FR-SCI-12): a save
// dialog and a file write. The webview cannot touch the file system, and VS
// Code's clipboard API is text-only, so a PNG is saved to a file, not copied.
import * as vscode from 'vscode';
import * as os from 'node:os';
import * as path from 'node:path';

export const MAX_PNG_BYTES = 20 * 1024 * 1024;
export const MAX_CSV_CHARS = 50 * 1024 * 1024;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function timestamp(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// The payload comes from a webview, so it is validated before it is written.
function toBytes(kind: 'png' | 'csv', payload: string): Uint8Array | string {
  if (kind === 'csv') {
    return payload.length > MAX_CSV_CHARS ? 'The CSV is too large to save.' : Buffer.from(payload, 'utf8');
  }
  const bytes = Buffer.from(payload, 'base64');
  if (bytes.length > MAX_PNG_BYTES) return 'The snapshot is too large to save.';
  if (!PNG_MAGIC.every((b, i) => bytes[i] === b)) return 'The snapshot is not a PNG image.';
  return bytes;
}

/** Ask where to save a scope PNG or CSV, then write it. Never throws. */
export async function saveScopeFile(kind: 'png' | 'csv', payload: string): Promise<void> {
  const bytes = toBytes(kind, payload);
  if (typeof bytes === 'string') {
    void vscode.window.showErrorMessage(`Daisy Scope: ${bytes}`);
    return;
  }
  const name = kind === 'png' ? `scope-snapshot-${timestamp()}.png` : `scope-capture-${timestamp()}.csv`;
  const target = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(os.homedir(), name)),
    filters: kind === 'png' ? { 'PNG image': ['png'] } : { 'CSV file': ['csv'] },
  });
  if (!target) return;
  try {
    await vscode.workspace.fs.writeFile(target, bytes);
  } catch (err) {
    void vscode.window.showErrorMessage(`Daisy Scope: could not save the file — ${err instanceof Error ? err.message : String(err)}`);
  }
}
