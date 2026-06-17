import * as vscode from 'vscode';
import * as path from 'path';

// clang/gcc:  /abs/path/file.cpp:12:5: error: undeclared identifier 'x'
// also:       /abs/path/file.cpp:12:5: note: ...
const DIAG_RE = /^(.+\.(?:cpp|c|h|hpp)):(\d+):(\d+):\s+(error|warning|note):\s+(.*)$/;

export type DiagnosticSeverity = 'error' | 'warning' | 'note';

export interface ParsedDiagnostic {
  filePath: string;
  line: number;       // 1-based
  col: number;        // 1-based
  severity: DiagnosticSeverity;
  message: string;
}

export function parseBuildLine(line: string): ParsedDiagnostic | undefined {
  const m = DIAG_RE.exec(line);
  if (!m) return undefined;
  return {
    filePath: m[1]!,
    line: parseInt(m[2]!, 10),
    col: parseInt(m[3]!, 10),
    severity: m[4] as DiagnosticSeverity,
    message: m[5]!,
  };
}

export function applyDiagnostics(
  collection: vscode.DiagnosticCollection,
  parsed: ParsedDiagnostic[],
  projectRoot: string,
): void {
  const map = new Map<string, vscode.Diagnostic[]>();

  for (const d of parsed) {
    // Resolve to absolute path if needed
    const absPath = path.isAbsolute(d.filePath)
      ? d.filePath
      : path.resolve(projectRoot, d.filePath);

    const severity =
      d.severity === 'error'
        ? vscode.DiagnosticSeverity.Error
        : d.severity === 'warning'
          ? vscode.DiagnosticSeverity.Warning
          : vscode.DiagnosticSeverity.Information;

    // Convert 1-based line/col to 0-based VS Code range
    const range = new vscode.Range(d.line - 1, d.col - 1, d.line - 1, d.col - 1);
    const diag = new vscode.Diagnostic(range, d.message, severity);
    diag.source = 'ds-ide';

    const existing = map.get(absPath) ?? [];
    existing.push(diag);
    map.set(absPath, existing);
  }

  collection.clear();
  for (const [filePath, diags] of map) {
    collection.set(vscode.Uri.file(filePath), diags);
  }
}
