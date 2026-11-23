#!/usr/bin/env bash
# FR-RTS-7: replay restart/stop vs the audio thread's popBlock(), under TSAN.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_DIR="${REPO_ROOT}/emulator/runtime"
SHIM_INCLUDE="${REPO_ROOT}/emulator/shim/include"
TEST_DIR="${REPO_ROOT}/tests/replay-handoff"
BUILD_DIR="$(mktemp -d)"
trap 'rm -rf "${BUILD_DIR}"' EXIT

CXX="${CXX:-clang++}"
echo "=== Replay hand-off (FR-RTS-7) — ThreadSanitizer ==="
"${CXX}" -std=c++17 -O1 -g -Wall -Wextra -Wno-unused-parameter -pthread -fsanitize=thread \
    -I"${RUNTIME_DIR}" -I"${SHIM_INCLUDE}" -o "${BUILD_DIR}/test_replay_handoff" \
    "${TEST_DIR}/test_replay_handoff.cpp" \
    "${RUNTIME_DIR}/session_recorder.cpp" "${RUNTIME_DIR}/platform_file.cpp" \
    "${RUNTIME_DIR}/session_player.cpp" "${RUNTIME_DIR}/wav_reader.cpp"
TSAN_OPTIONS="halt_on_error=1 ${TSAN_OPTIONS:-}" "${BUILD_DIR}/test_replay_handoff"
