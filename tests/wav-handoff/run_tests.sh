#!/usr/bin/env bash
# FR-RTS-6: WAV hand-off between the IPC thread and the audio thread, built
# and run under ThreadSanitizer and then AddressSanitizer.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_DIR="${REPO_ROOT}/emulator/runtime"
SHIM_INCLUDE="${REPO_ROOT}/emulator/shim/include"
TEST_DIR="${REPO_ROOT}/tests/wav-handoff"
BUILD_DIR="$(mktemp -d)"
trap 'rm -rf "${BUILD_DIR}"' EXIT

CXX="${CXX:-clang++}"
BASE=(-std=c++17 -O1 -g -Wall -Wextra -Wno-unused-parameter -pthread -I"${RUNTIME_DIR}" -I"${SHIM_INCLUDE}")
SOURCES=("${TEST_DIR}/test_wav_handoff.cpp"
         "${RUNTIME_DIR}/session_recorder.cpp" "${RUNTIME_DIR}/platform_file.cpp"
         "${RUNTIME_DIR}/session_player.cpp" "${RUNTIME_DIR}/wav_reader.cpp")

echo "=== WAV hand-off (FR-RTS-6) — ThreadSanitizer ==="
"${CXX}" "${BASE[@]}" -fsanitize=thread -o "${BUILD_DIR}/tsan" "${SOURCES[@]}"
TSAN_OPTIONS="halt_on_error=1 ${TSAN_OPTIONS:-}" "${BUILD_DIR}/tsan"

echo ""
echo "=== WAV hand-off (FR-RTS-6) — AddressSanitizer ==="
"${CXX}" "${BASE[@]}" -fsanitize=address,undefined -fno-omit-frame-pointer -o "${BUILD_DIR}/asan" "${SOURCES[@]}"
ASAN_OPTIONS="halt_on_error=1 detect_leaks=0 ${ASAN_OPTIONS:-}" "${BUILD_DIR}/asan"
