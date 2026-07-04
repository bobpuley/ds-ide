#!/usr/bin/env bash
# Emulator runtime safety unit tests (M25 / M31).
#
# Compiles the safety test harness against the emulator runtime units under test
# and runs the resulting binary. No CoreAudio or AudioUnit linking required.
#
# Exit code: 0 = all pass, 1 = one or more failures.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_DIR="${REPO_ROOT}/emulator/runtime"
SHIM_INCLUDE="${REPO_ROOT}/emulator/shim/include"
TEST_SRC="${REPO_ROOT}/tests/emulator-safety/test_emulator_safety.cpp"
BUILD_DIR="$(mktemp -d)"

trap 'rm -rf "${BUILD_DIR}"' EXIT

CXX="${CXX:-clang++}"
CXXFLAGS=(
    -std=c++17 -O0 -g -Wall -Wextra -Wno-unused-parameter
    -I"${RUNTIME_DIR}"
    -I"${SHIM_INCLUDE}"
)

echo "=== Emulator safety unit tests (M25) ==="
echo "Compiler: $(${CXX} --version | head -1)"
echo ""

BIN="${BUILD_DIR}/test_emulator_safety"

# Units under test (no CoreAudio dependency):
SOURCES=(
    "${TEST_SRC}"
    "${RUNTIME_DIR}/wav_reader.cpp"
    "${RUNTIME_DIR}/session_player.cpp"
    "${RUNTIME_DIR}/session_recorder.cpp"
    "${RUNTIME_DIR}/ipc_server.cpp"
)

"${CXX}" "${CXXFLAGS[@]}" -pthread -o "${BIN}" "${SOURCES[@]}"

"${BIN}"
