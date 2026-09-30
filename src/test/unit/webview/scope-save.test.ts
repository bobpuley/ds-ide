import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { saveScopeFile, MAX_PNG_BYTES, MAX_CSV_CHARS } from '../../../webview/scope/scope-save';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pngBase64 = (extra = 4): string => Buffer.concat([PNG_MAGIC, Buffer.alloc(extra)]).toString('base64');

describe('saveScopeFile (FR-SCI-12)', () => {
  const showSave = vi.mocked(vscode.window.showSaveDialog);
  const writeFile = vi.mocked(vscode.workspace.fs.writeFile);

  beforeEach(() => {
    vi.clearAllMocks();
    showSave.mockResolvedValue({ fsPath: '/tmp/out', toString: () => '/tmp/out' } as never);
  });

  it('asks where to save a PNG, with a png filter, and writes the decoded bytes', async () => {
    await saveScopeFile('png', pngBase64());
    const opts = showSave.mock.calls[0]![0]!;
    expect(opts.filters).toEqual({ 'PNG image': ['png'] });
    expect(String(opts.defaultUri?.fsPath)).toMatch(/scope-snapshot-\d{8}-\d{6}\.png$/);
    const bytes = writeFile.mock.calls[0]![1] as Uint8Array;
    expect(Buffer.from(bytes).subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  });

  it('asks where to save a CSV and writes it as UTF-8', async () => {
    await saveScopeFile('csv', 'time_ms,In\n0.0000,0.100000\n');
    const opts = showSave.mock.calls[0]![0]!;
    expect(opts.filters).toEqual({ 'CSV file': ['csv'] });
    expect(String(opts.defaultUri?.fsPath)).toMatch(/scope-capture-\d{8}-\d{6}\.csv$/);
    expect(Buffer.from(writeFile.mock.calls[0]![1] as Uint8Array).toString('utf8')).toBe('time_ms,In\n0.0000,0.100000\n');
  });

  it('writes nothing when the user cancels the dialog', async () => {
    showSave.mockResolvedValue(undefined);
    await saveScopeFile('csv', 'a');
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('refuses a PNG payload that is not a PNG, without opening a dialog', async () => {
    await saveScopeFile('png', Buffer.from('not a png at all').toString('base64'));
    expect(showSave).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
  });

  it('refuses oversized payloads', async () => {
    await saveScopeFile('png', pngBase64(MAX_PNG_BYTES));
    await saveScopeFile('csv', 'x'.repeat(MAX_CSV_CHARS + 1));
    expect(showSave).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('reports a failed write instead of throwing', async () => {
    writeFile.mockRejectedValueOnce(new Error('EACCES'));
    await expect(saveScopeFile('csv', 'a')).resolves.toBeUndefined();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('EACCES'));
  });
});
