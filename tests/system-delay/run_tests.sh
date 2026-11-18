#!/usr/bin/env bash
# System::Delay unit tests (M41 / FR-QA-EMU-4).
#
# Compiles the shim's system.cpp against a timing/shutdown-responsiveness
# test harness and runs it. No CoreAudio dependency.
#
# Exit code: 0 = all pass, 1 = one or more failures.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_DIR="${REPO_ROOT}/emulator/runtime"
SHIM_SRC_DIR="${REPO_ROOT}/emulator/shim/src"
SHIM_INCLUDE="${REPO_ROOT}/emulator/shim/include"
TEST_SRC="${REPO_ROOT}/tests/system-delay/test_system_delay.cpp"
BUILD_DIR="$(mktemp -d)"

trap 'rm -rf "${BUILD_DIR}"' EXIT

CXX="${CXX:-clang++}"
CXXFLAGS=(
    -std=c++17 -O0 -g -Wall -Wextra -Wno-unused-parameter
    -I"${RUNTIME_DIR}"
    -I"${SHIM_INCLUDE}"
)

echo "=== System::Delay unit tests ==="
echo "Compiler: $(${CXX} --version | head -1)"
echo ""

BIN="${BUILD_DIR}/test_system_delay"
"${CXX}" "${CXXFLAGS[@]}" -pthread -o "${BIN}" \
    "${TEST_SRC}" "${SHIM_SRC_DIR}/system.cpp" \
    "${RUNTIME_DIR}/session_recorder.cpp" "${RUNTIME_DIR}/platform_file.cpp" "${RUNTIME_DIR}/session_player.cpp"

"${BIN}"
