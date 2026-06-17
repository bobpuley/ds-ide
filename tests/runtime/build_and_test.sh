#!/usr/bin/env bash
# M1 runtime integration tests.
# Builds bypass (+ Osc if DaisySP available) then runs all three test suites.
#
# Environment:
#   DAISYSP_DIR  — path to DaisySP Source/ directory (optional; Osc test skipped if absent)
#
# Exit code: 0 = all pass, 1 = any failure.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TESTS_DIR="${REPO_ROOT}/tests/runtime"
PYTHON="${PYTHON:-python3}"

pass=0; fail=0

run_test() {
    local label="$1"
    local script="$2"
    echo ""
    if "${PYTHON}" "${TESTS_DIR}/${script}"; then
        echo "  → ${label}: PASS"
        ((pass++)) || true
    else
        echo "  → ${label}: FAIL"
        ((fail++)) || true
    fi
}

echo "=== M1 runtime integration tests ==="
echo "Python : $("${PYTHON}" --version)"
echo "Repo   : ${REPO_ROOT}"
[ -n "${DAISYSP_DIR:-}" ] && echo "DaisySP: ${DAISYSP_DIR}" || echo "DaisySP: (not set — Osc test will auto-detect or skip)"
echo ""

run_test "bypass (out==in)"   "test_bypass.py"
run_test "determinism (NFR-6)" "test_determinism.py"
run_test "Osc (oscillator)"   "test_osc.py"

echo ""
echo "Results: ${pass} passed, ${fail} failed."
[[ "${fail}" -eq 0 ]]
