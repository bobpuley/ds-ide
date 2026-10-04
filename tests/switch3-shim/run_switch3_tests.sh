#!/usr/bin/env bash
# Switch3 (toggle switch) shim unit test (M44, FR-DEV-7).
#
# Compiles the Switch3 shim with an in-process harness (its own g_state) and
# runs it. Exercises position round-trip logic against the virtual toggle
# state directly, without IPC or the audio engine.
#
# Exit code: 0 = all pass, 1 = one or more failures.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_DIR="${REPO_ROOT}/emulator/runtime"
SHIM_INCLUDE="${REPO_ROOT}/emulator/shim/include"
SHIM_SRC="${REPO_ROOT}/emulator/shim/src"
TEST_SRC="${REPO_ROOT}/tests/switch3-shim/test_switch3.cpp"
BUILD_DIR="$(mktemp -d)"

trap 'rm -rf "${BUILD_DIR}"' EXIT

CXX="${CXX:-clang++}"
CXXFLAGS=(-std=c++17 -O0 -g -Wall -Wextra -Wno-unused-parameter
          -I"${RUNTIME_DIR}" -I"${SHIM_INCLUDE}")

echo "=== Switch3 shim unit tests ==="
echo "Compiler : $(${CXX} --version | head -1)"
echo ""

BIN="${BUILD_DIR}/test_switch3"
"${CXX}" "${CXXFLAGS[@]}" -o "${BIN}" \
    "${TEST_SRC}" "${SHIM_SRC}/switch3.cpp" \
    "${RUNTIME_DIR}/session_recorder.cpp" "${RUNTIME_DIR}/platform_file.cpp" "${RUNTIME_DIR}/session_player.cpp" "${RUNTIME_DIR}/wav_reader.cpp"

"${BIN}"
