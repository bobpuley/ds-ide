#!/usr/bin/env bash
# Build-flag unit test (M41 / FR-QA-EMU-8).
#
# Exit code: 0 = all pass, 1 = one or more failures.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PYTHON="${PYTHON:-python3}"

echo "=== Build-flag unit tests (M41 / FR-QA-EMU-8) ==="
echo ""

"${PYTHON}" "${REPO_ROOT}/tests/build-flags/check_compile_flags.py"
