#!/usr/bin/env bash
# Audio measurement statistics unit tests (M80 / FR-WIN-AUD-7).
# The measurements themselves are run by run_measurements.sh on real hardware.
#
# Exit code: 0 = all pass, 1 = one or more failures.

set -euo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="$(mktemp -d)"
trap 'rm -rf "${BUILD_DIR}"' EXIT

CXX="${CXX:-clang++}"
echo "=== Audio measurement stats tests (M80) ==="
echo "Compiler: $(${CXX} --version | head -1)"
echo ""

"${CXX}" -std=c++17 -O0 -g -Wall -Wextra -I"${TEST_DIR}" \
    -o "${BUILD_DIR}/test_measure_stats" "${TEST_DIR}/test_measure_stats.cpp"
"${BUILD_DIR}/test_measure_stats"
