#!/usr/bin/env bash
# FR-EMU-13: LED/RGB/MIDI output from two threads, under ThreadSanitizer.
# Exit code: 0 = all pass and no race reported, non-zero otherwise.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_DIR="${REPO_ROOT}/emulator/runtime"
SHIM_INCLUDE="${REPO_ROOT}/emulator/shim/include"
SHIM_SRC="${REPO_ROOT}/emulator/shim/src"
TEST_DIR="${REPO_ROOT}/tests/telemetry-threads"
BUILD_DIR="$(mktemp -d)"
trap 'rm -rf "${BUILD_DIR}"' EXIT

CXX="${CXX:-clang++}"
CXXFLAGS=(-std=c++17 -O1 -g -Wall -Wextra -Wno-unused-parameter -fsanitize=thread
          -I"${RUNTIME_DIR}" -I"${SHIM_INCLUDE}")

echo "=== Telemetry from two threads, under TSAN (FR-EMU-13) ==="
echo "Compiler : $(${CXX} --version | head -1)"

BIN="${BUILD_DIR}/test_telemetry_threads"
"${CXX}" "${CXXFLAGS[@]}" -pthread -o "${BIN}" \
    "${TEST_DIR}/test_telemetry_threads.cpp" \
    "${SHIM_SRC}/led.cpp" "${SHIM_SRC}/rgb_led.cpp" "${SHIM_SRC}/daisy_seed.cpp" \
    "${SHIM_SRC}/midi_uart_handler.cpp" "${SHIM_SRC}/midi_usb_handler.cpp" "${SHIM_SRC}/midi_event.cpp" \
    "${RUNTIME_DIR}/session_recorder.cpp" "${RUNTIME_DIR}/platform_file.cpp" \
    "${RUNTIME_DIR}/session_player.cpp" "${RUNTIME_DIR}/wav_reader.cpp"

TSAN_OPTIONS="halt_on_error=1 ${TSAN_OPTIONS:-}" "${BIN}"
