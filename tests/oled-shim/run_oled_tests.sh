#!/usr/bin/env bash
# OLED shim unit test (M46, FR-DEV-14).
#
# Compiles the OledDisplay shim with an in-process harness (its own g_state)
# and runs it. Exercises the SSD1306 page-based framebuffer layout, pixel
# primitives, and Update()'s frame emission into the dedicated oled_queue —
# without IPC or the audio engine.
#
# Exit code: 0 = all pass, 1 = one or more failures.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_DIR="${REPO_ROOT}/emulator/runtime"
SHIM_INCLUDE="${REPO_ROOT}/emulator/shim/include"
SHIM_SRC="${REPO_ROOT}/emulator/shim/src"
TEST_SRC="${REPO_ROOT}/tests/oled-shim/test_oled.cpp"
BUILD_DIR="$(mktemp -d)"

trap 'rm -rf "${BUILD_DIR}"' EXIT

CXX="${CXX:-clang++}"
CXXFLAGS=(-std=c++17 -O0 -g -Wall -Wextra -Wno-unused-parameter
          -I"${RUNTIME_DIR}" -I"${SHIM_INCLUDE}")

echo "=== OLED shim unit tests ==="
echo "Compiler : $(${CXX} --version | head -1)"
echo ""

BIN="${BUILD_DIR}/test_oled"
"${CXX}" "${CXXFLAGS[@]}" -pthread -o "${BIN}" \
    "${TEST_SRC}" "${SHIM_SRC}/oled_display.cpp" \
    "${RUNTIME_DIR}/session_recorder.cpp" "${RUNTIME_DIR}/session_player.cpp" "${RUNTIME_DIR}/wav_reader.cpp"

"${BIN}"
