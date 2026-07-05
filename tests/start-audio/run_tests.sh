#!/usr/bin/env bash
# DaisySeed::StartAudio() unit tests (M41 / FR-QA-EMU-3).
#
# Compiles the shim's daisy_seed.cpp (+ led.cpp, its only link dependency)
# against a test harness and runs it. No CoreAudio dependency.
#
# Exit code: 0 = all pass, 1 = one or more failures.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_DIR="${REPO_ROOT}/emulator/runtime"
SHIM_SRC_DIR="${REPO_ROOT}/emulator/shim/src"
SHIM_INCLUDE="${REPO_ROOT}/emulator/shim/include"
TEST_SRC="${REPO_ROOT}/tests/start-audio/test_start_audio.cpp"
BUILD_DIR="$(mktemp -d)"

trap 'rm -rf "${BUILD_DIR}"' EXIT

CXX="${CXX:-clang++}"
CXXFLAGS=(
    -std=c++17 -O0 -g -Wall -Wextra -Wno-unused-parameter
    -I"${RUNTIME_DIR}"
    -I"${SHIM_INCLUDE}"
)

echo "=== DaisySeed::StartAudio unit tests ==="
echo "Compiler: $(${CXX} --version | head -1)"
echo ""

BIN="${BUILD_DIR}/test_start_audio"
"${CXX}" "${CXXFLAGS[@]}" -pthread -o "${BIN}" \
    "${TEST_SRC}" "${SHIM_SRC_DIR}/daisy_seed.cpp" "${SHIM_SRC_DIR}/led.cpp" \
    "${RUNTIME_DIR}/session_recorder.cpp" "${RUNTIME_DIR}/session_player.cpp"

"${BIN}"
