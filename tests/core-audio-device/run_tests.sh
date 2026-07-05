#!/usr/bin/env bash
# CoreAudioDevice unit tests (M41 / FR-QA-EMU-2).
#
# Compiles the safety test harness against core_audio_device.cpp and runs it.
# macOS only (CoreAudio/AudioToolbox) — no-op pass on other platforms since
# CoreAudioDevice compiles to no-op stubs there.
#
# Exit code: 0 = all pass (or skipped on non-Apple), 1 = one or more failures.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_DIR="${REPO_ROOT}/emulator/runtime"
TEST_SRC="${REPO_ROOT}/tests/core-audio-device/test_core_audio_device.cpp"
BUILD_DIR="$(mktemp -d)"

trap 'rm -rf "${BUILD_DIR}"' EXIT

CXX="${CXX:-clang++}"
CXXFLAGS=(-std=c++17 -O0 -g -Wall -Wextra -Wno-unused-parameter -I"${RUNTIME_DIR}")
LDFLAGS=()

echo "=== CoreAudioDevice unit tests ==="
echo "Compiler: $(${CXX} --version | head -1)"
echo ""

if [[ "$(uname -s)" == "Darwin" ]]; then
    LDFLAGS+=(-framework CoreAudio -framework AudioToolbox)
fi

BIN="${BUILD_DIR}/test_core_audio_device"
"${CXX}" "${CXXFLAGS[@]}" -o "${BIN}" \
    "${TEST_SRC}" "${RUNTIME_DIR}/core_audio_device.cpp" "${LDFLAGS[@]}"

"${BIN}"
