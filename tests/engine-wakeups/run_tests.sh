#!/usr/bin/env bash
# FR-RTS-8: engine wake-ups (config, audioDevice, shutdown) are never lost.
# Links the real IPC handlers and audio engine against the fake audio backend.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_DIR="${REPO_ROOT}/emulator/runtime"
SHIM_INCLUDE="${REPO_ROOT}/emulator/shim/include"
SHIM_SRC="${REPO_ROOT}/emulator/shim/src"
FAKE_DIR="${REPO_ROOT}/tests/audio-engine"
TEST_DIR="${REPO_ROOT}/tests/engine-wakeups"
BUILD_DIR="$(mktemp -d)"
trap 'rm -rf "${BUILD_DIR}"' EXIT

CXX="${CXX:-clang++}"
echo "=== Engine wake-ups (FR-RTS-8) ==="
"${CXX}" -std=c++17 -O0 -g -Wall -Wextra -Wno-unused-parameter -pthread \
    -I"${RUNTIME_DIR}" -I"${SHIM_INCLUDE}" -I"${FAKE_DIR}" -o "${BUILD_DIR}/test_engine_wakeups" \
    "${TEST_DIR}/test_engine_wakeups.cpp" \
    "${FAKE_DIR}/fake_audio_device.cpp" "${FAKE_DIR}/fake_audio_factory.cpp" \
    "${RUNTIME_DIR}/audio_engine.cpp" "${RUNTIME_DIR}/ipc_server.cpp" \
    "${RUNTIME_DIR}/ipc_transport_socket.cpp" "${RUNTIME_DIR}/ipc_transport_unix.cpp" \
    "${RUNTIME_DIR}/ipc_transport_tcp.cpp" "${RUNTIME_DIR}/input_generators.cpp" \
    "${RUNTIME_DIR}/wav_reader.cpp" "${RUNTIME_DIR}/session_player.cpp" \
    "${RUNTIME_DIR}/session_recorder.cpp" "${RUNTIME_DIR}/platform_file.cpp" \
    "${SHIM_SRC}/midi_event.cpp" "${SHIM_SRC}/midi_usb_handler.cpp" "${SHIM_SRC}/midi_uart_handler.cpp"
"${BUILD_DIR}/test_engine_wakeups"
