#!/usr/bin/env bash
# RgbLed shim unit test (M44, FR-DEV-8).
#
# Compiles the RgbLed shim with an in-process harness (its own g_state) and
# runs it. Exercises Set/Update dedup logic directly, without IPC or the
# audio engine.
#
# Exit code: 0 = all pass, 1 = one or more failures.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_DIR="${REPO_ROOT}/emulator/runtime"
SHIM_INCLUDE="${REPO_ROOT}/emulator/shim/include"
SHIM_SRC="${REPO_ROOT}/emulator/shim/src"
TEST_SRC="${REPO_ROOT}/tests/rgb-led-shim/test_rgb_led.cpp"
BUILD_DIR="$(mktemp -d)"

trap 'rm -rf "${BUILD_DIR}"' EXIT

CXX="${CXX:-clang++}"
CXXFLAGS=(-std=c++17 -O0 -g -Wall -Wextra -Wno-unused-parameter
          -I"${RUNTIME_DIR}" -I"${SHIM_INCLUDE}")

echo "=== RgbLed shim unit tests ==="
echo "Compiler : $(${CXX} --version | head -1)"
echo ""

BIN="${BUILD_DIR}/test_rgb_led"
"${CXX}" "${CXXFLAGS[@]}" -o "${BIN}" \
    "${TEST_SRC}" "${SHIM_SRC}/rgb_led.cpp" \
    "${RUNTIME_DIR}/session_recorder.cpp" "${RUNTIME_DIR}/session_player.cpp" "${RUNTIME_DIR}/wav_reader.cpp"

"${BIN}"
