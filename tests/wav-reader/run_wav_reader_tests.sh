#!/usr/bin/env bash
# WAV reader unit test (T9.1 / M9).
#
# Compiles the C4 WAV reader together with an in-memory test harness and runs
# it. No linking against the full runtime — this exercises parse_wav() in
# isolation across bit depths, channel counts, and malformed input.
#
# Exit code: 0 = all pass, 1 = one or more failures.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_DIR="${REPO_ROOT}/emulator/runtime"
TEST_SRC="${REPO_ROOT}/tests/wav-reader/test_wav_reader.cpp"
BUILD_DIR="$(mktemp -d)"

trap 'rm -rf "${BUILD_DIR}"' EXIT

CXX="${CXX:-clang++}"
CXXFLAGS=(-std=c++17 -O0 -g -Wall -Wextra -Wno-unused-parameter
          -I"${RUNTIME_DIR}")

echo "=== WAV reader unit tests ==="
echo "Compiler : $(${CXX} --version | head -1)"
echo ""

BIN="${BUILD_DIR}/test_wav_reader"
"${CXX}" "${CXXFLAGS[@]}" -o "${BIN}" \
    "${TEST_SRC}" "${RUNTIME_DIR}/wav_reader.cpp"

"${BIN}"
