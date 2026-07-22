#!/usr/bin/env bash
# MIDI shim unit test (M47, FR-DEV-16).
#
# Compiles the shared MIDI event parser and MidiUartHandler shim with an
# in-process harness (its own g_state) and runs it. Exercises byte-triplet
# parsing, MidiInQueue's bounded FIFO, and a concurrent producer/consumer
# stress test — without IPC or the audio engine.
#
# Exit code: 0 = all pass, 1 = one or more failures.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_DIR="${REPO_ROOT}/emulator/runtime"
SHIM_INCLUDE="${REPO_ROOT}/emulator/shim/include"
SHIM_SRC="${REPO_ROOT}/emulator/shim/src"
TEST_SRC="${REPO_ROOT}/tests/midi-shim/test_midi.cpp"
BUILD_DIR="$(mktemp -d)"

trap 'rm -rf "${BUILD_DIR}"' EXIT

CXX="${CXX:-clang++}"
CXXFLAGS=(-std=c++17 -O0 -g -Wall -Wextra -Wno-unused-parameter
          -I"${RUNTIME_DIR}" -I"${SHIM_INCLUDE}")

echo "=== MIDI shim unit tests ==="
echo "Compiler : $(${CXX} --version | head -1)"
echo ""

BIN="${BUILD_DIR}/test_midi"
"${CXX}" "${CXXFLAGS[@]}" -pthread -o "${BIN}" \
    "${TEST_SRC}" "${SHIM_SRC}/midi_event.cpp" "${SHIM_SRC}/midi_uart_handler.cpp" \
    "${RUNTIME_DIR}/session_recorder.cpp" "${RUNTIME_DIR}/session_player.cpp" "${RUNTIME_DIR}/wav_reader.cpp"

"${BIN}"
