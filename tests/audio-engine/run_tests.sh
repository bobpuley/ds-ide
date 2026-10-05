#!/usr/bin/env bash
# Real-time path regression tests (M79 / FR-WIN-AUD-4).
#
# Links audio_engine.cpp against a fake audio backend (no hardware, no
# CoreAudio) and drives the engine end to end.
#
# Exit code: 0 = all pass, 1 = one or more failures.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_DIR="${REPO_ROOT}/emulator/runtime"
SHIM_INCLUDE="${REPO_ROOT}/emulator/shim/include"
TEST_DIR="${REPO_ROOT}/tests/audio-engine"
BUILD_DIR="$(mktemp -d)"

trap 'rm -rf "${BUILD_DIR}"' EXIT

CXX="${CXX:-clang++}"
CXXFLAGS=(
    -std=c++17 -O0 -g -Wall -Wextra -Wno-unused-parameter
    -I"${RUNTIME_DIR}" -I"${SHIM_INCLUDE}" -I"${TEST_DIR}"
)

echo "=== Real-time path regression tests (M79) ==="
echo "Compiler: $(${CXX} --version | head -1)"
echo ""

BIN="${BUILD_DIR}/test_realtime_path"

SOURCES=(
    "${TEST_DIR}/test_realtime_path.cpp"
    "${TEST_DIR}/fake_core_audio_device.cpp"
    "${RUNTIME_DIR}/audio_engine.cpp"
    "${RUNTIME_DIR}/wav_reader.cpp"
    "${RUNTIME_DIR}/session_player.cpp"
    "${RUNTIME_DIR}/session_recorder.cpp"
    "${RUNTIME_DIR}/platform_file.cpp"
    "${RUNTIME_DIR}/input_generators.cpp"
)

"${CXX}" "${CXXFLAGS[@]}" -pthread -o "${BIN}" "${SOURCES[@]}"

"${BIN}"
