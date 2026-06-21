import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { parseBuildLine, applyDiagnostics } from '../../../diagnostics/build-diagnostics';

describe('parseBuildLine', () => {
  it('parses a clang error line', () => {
    const d = parseBuildLine('/proj/effect.cpp:12:5: error: use of undeclared identifier \'hw\'');
    expect(d).toEqual({
      filePath: '/proj/effect.cpp',
      line: 12,
      col: 5,
      severity: 'error',
      message: 'use of undeclared identifier \'hw\'',
    });
  });

  it('parses a gcc warning line', () => {
    const d = parseBuildLine('/src/foo.cpp:3:1: warning: unused variable \'x\'');
    expect(d).toEqual({
      filePath: '/src/foo.cpp',
      line: 3,
      col: 1,
      severity: 'warning',
      message: 'unused variable \'x\'',
    });
  });

  it('parses a note line', () => {
    const d = parseBuildLine('/a/b.h:7:3: note: declared here');
    expect(d?.severity).toBe('note');
  });

  it('returns undefined for cmake progress lines', () => {
    expect(parseBuildLine('-- Configuring done')).toBeUndefined();
    expect(parseBuildLine('[100%] Linking CXX executable effect_emu')).toBeUndefined();
    expect(parseBuildLine('')).toBeUndefined();
  });

  it('returns undefined for linker error lines (no col)', () => {
    expect(parseBuildLine('Undefined symbols for architecture arm64:')).toBeUndefined();
  });

  it('handles .h and .hpp extensions', () => {
    expect(parseBuildLine('/inc/daisy.h:1:1: error: foo')).toBeDefined();
    expect(parseBuildLine('/inc/dsp.hpp:2:2: warning: bar')).toBeDefined();
  });

  it('handles a .c file', () => {
    const d = parseBuildLine('/src/util.c:5:2: error: syntax error');
    expect(d?.filePath).toBe('/src/util.c');
  });

  it('parses a Windows drive-letter path (AC-71)', () => {
    const d = parseBuildLine('C:\\Users\\dev\\project\\effect.cpp:12:5: error: undeclared identifier \'x\'');
    expect(d).toEqual({
      filePath: 'C:\\Users\\dev\\project\\effect.cpp',
      line: 12,
      col: 5,
      severity: 'error',
      message: 'undeclared identifier \'x\'',
    });
  });

  it('parses a Windows path with forward slashes (AC-71)', () => {
    const d = parseBuildLine('C:/Users/dev/project/effect.cpp:3:1: warning: unused variable');
    expect(d).toEqual({
      filePath: 'C:/Users/dev/project/effect.cpp',
      line: 3,
      col: 1,
      severity: 'warning',
      message: 'unused variable',
    });
  });
});

describe('applyDiagnostics', () => {
  let collection: { set: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    collection = { set: vi.fn(), clear: vi.fn() };
  });

  it('clears and populates the collection', () => {
    applyDiagnostics(
      collection as unknown as vscode.DiagnosticCollection,
      [{ filePath: '/proj/a.cpp', line: 1, col: 1, severity: 'error', message: 'bad' }],
      '/proj',
    );
    expect(collection.clear).toHaveBeenCalledOnce();
    expect(collection.set).toHaveBeenCalledOnce();
  });

  it('groups multiple diagnostics per file', () => {
    applyDiagnostics(
      collection as unknown as vscode.DiagnosticCollection,
      [
        { filePath: '/proj/a.cpp', line: 1, col: 1, severity: 'error', message: 'e1' },
        { filePath: '/proj/a.cpp', line: 5, col: 3, severity: 'warning', message: 'w1' },
        { filePath: '/proj/b.cpp', line: 2, col: 1, severity: 'error', message: 'e2' },
      ],
      '/proj',
    );
    // Should have called set twice (once per distinct file)
    expect(collection.set).toHaveBeenCalledTimes(2);
    const firstSetArgs = collection.set.mock.calls[0] as [vscode.Uri, vscode.Diagnostic[]];
    expect(firstSetArgs[1]).toHaveLength(2);
  });

  it('resolves relative paths against projectRoot', () => {
    applyDiagnostics(
      collection as unknown as vscode.DiagnosticCollection,
      [{ filePath: 'a.cpp', line: 1, col: 1, severity: 'error', message: 'e' }],
      '/proj',
    );
    const [uri] = collection.set.mock.calls[0] as [vscode.Uri, vscode.Diagnostic[]];
    expect(uri.fsPath).toBe('/proj/a.cpp');
  });

  it('uses correct VS Code severity', () => {
    applyDiagnostics(
      collection as unknown as vscode.DiagnosticCollection,
      [
        { filePath: '/p/a.cpp', line: 1, col: 1, severity: 'error', message: 'e' },
        { filePath: '/p/b.cpp', line: 1, col: 1, severity: 'warning', message: 'w' },
        { filePath: '/p/c.cpp', line: 1, col: 1, severity: 'note', message: 'n' },
      ],
      '/p',
    );
    const calls = collection.set.mock.calls as Array<[vscode.Uri, vscode.Diagnostic[]]>;
    const errorDiag = calls.find(([u]) => u.fsPath.endsWith('a.cpp'))![1][0]!;
    const warnDiag  = calls.find(([u]) => u.fsPath.endsWith('b.cpp'))![1][0]!;
    const noteDiag  = calls.find(([u]) => u.fsPath.endsWith('c.cpp'))![1][0]!;
    expect(errorDiag.severity).toBe(vscode.DiagnosticSeverity.Error);
    expect(warnDiag.severity).toBe(vscode.DiagnosticSeverity.Warning);
    expect(noteDiag.severity).toBe(vscode.DiagnosticSeverity.Information);
  });

  it('clears collection even when no diagnostics', () => {
    applyDiagnostics(collection as unknown as vscode.DiagnosticCollection, [], '/proj');
    expect(collection.clear).toHaveBeenCalledOnce();
    expect(collection.set).not.toHaveBeenCalled();
  });
});
