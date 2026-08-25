#!/usr/bin/env bash
set -euo pipefail

# Guards against the FR-UX-4/FR-UX-6 regression class: workspace-scoped code
# reading vscode.workspace.workspaceFolders by direct index instead of
# routing through resolveActiveFolder() (src/workspace/active-folder.ts).
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

MATCHES=$(grep -rnE 'workspaceFolders(\?\.)?\[' src --include='*.ts' \
  | grep -v '^src/workspace/active-folder\.ts:' \
  | grep -v '^src/test/' || true)

if [ -n "$MATCHES" ]; then
  echo "error: direct indexed access to vscode.workspace.workspaceFolders found outside src/workspace/active-folder.ts:" >&2
  echo "$MATCHES" >&2
  echo "" >&2
  echo "Use resolveActiveFolder(workspaceState) from src/workspace/active-folder.ts instead (FR-UX-6)." >&2
  exit 1
fi

exit 0
