#!/usr/bin/env bash
# AudioDevice contract tests (M41 / FR-QA-EMU-2, generalised in M79 / FR-WIN-AUD-1).
#
# Compiles the contract test against the platform backend (CoreAudio on macOS,
# the null backend elsewhere) via the real factory, plus the fake backend.
#
# Exit code: 0 = all pass, 1 = one or more failures.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_DIR="${REPO_ROOT}/emulator/runtime"
ENGINE_TEST_DIR="${REPO_ROOT}/tests/audio-engine"
TEST_SRC="${REPO_ROOT}/tests/core-audio-device/test_core_audio_device.cpp"
BUILD_DIR="$(mktemp -d)"

trap 'rm -rf "${BUILD_DIR}"' EXIT

CXX="${CXX:-clang++}"
CXXFLAGS=(-std=c++17 -O0 -g -Wall -Wextra -Wno-unused-parameter
          -I"${RUNTIME_DIR}" -I"${ENGINE_TEST_DIR}")
SOURCES=("${TEST_SRC}" "${ENGINE_TEST_DIR}/fake_audio_device.cpp"
         "${RUNTIME_DIR}/audio_device_factory.cpp")
LDFLAGS=(-pthread)

echo "=== AudioDevice contract tests ==="
echo "Compiler: $(${CXX} --version | head -1)"
echo ""

if [[ "$(uname -s)" == "Darwin" ]]; then
    SOURCES+=("${RUNTIME_DIR}/core_audio_device.cpp")
    LDFLAGS+=(-framework CoreAudio -framework AudioToolbox)
fi

# FR-WIN-AUD-3: xrun timing is portable std::chrono::steady_clock; no Mach
# timing may creep back into the CoreAudio backend.
if grep -n "mach_absolute_time\|mach_timebase_info\|mach/mach_time\|mach_ns_per_tick" \
        "${RUNTIME_DIR}/core_audio_device.cpp"; then
    echo "FAIL: core_audio_device.cpp still uses Mach timing (FR-WIN-AUD-3)"
    exit 1
fi
echo "  PASS  core_audio_device.cpp uses no Mach timing (FR-WIN-AUD-3)"
echo ""

BIN="${BUILD_DIR}/test_core_audio_device"
"${CXX}" "${CXXFLAGS[@]}" -o "${BIN}" "${SOURCES[@]}" "${LDFLAGS[@]}"

"${BIN}"
