#!/usr/bin/env bash
# Switch shim unit test (T10.2 / M10).
#
# Compiles the C5 Switch shim with an in-process harness (its own g_state) and
# runs it. Exercises press/edge logic against the virtual button state directly,
# without IPC or the audio engine.
#
# Exit code: 0 = all pass, 1 = one or more failures.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_DIR="${REPO_ROOT}/emulator/runtime"
SHIM_INCLUDE="${REPO_ROOT}/emulator/shim/include"
SHIM_SRC="${REPO_ROOT}/emulator/shim/src"
TEST_SRC="${REPO_ROOT}/tests/switch-shim/test_switch.cpp"
BUILD_DIR="$(mktemp -d)"

trap 'rm -rf "${BUILD_DIR}"' EXIT

CXX="${CXX:-clang++}"
CXXFLAGS=(-std=c++17 -O0 -g -Wall -Wextra -Wno-unused-parameter
          -I"${RUNTIME_DIR}" -I"${SHIM_INCLUDE}")

echo "=== Switch shim unit tests ==="
echo "Compiler : $(${CXX} --version | head -1)"
echo ""

BIN="${BUILD_DIR}/test_switch"
"${CXX}" "${CXXFLAGS[@]}" -o "${BIN}" \
    "${TEST_SRC}" "${SHIM_SRC}/switch.cpp"

"${BIN}"
