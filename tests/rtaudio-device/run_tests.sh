#!/usr/bin/env bash
# RtAudio backend tests (M80 / FR-WIN-AUD-5).
#
# Builds the Windows RtAudio backend on any host: against RtAudio's dummy API
# off Windows (no platform API define -> RtAudio.h selects __RTAUDIO_DUMMY__),
# so the adaptation/render logic and the no-device fallback run on macOS; with
# the real WASAPI API on Windows (MSYS2), where a stream opens if the machine
# has an output endpoint.
#
# Exit code: 0 = all pass, 1 = one or more failures.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_DIR="${REPO_ROOT}/emulator/runtime"
RTAUDIO_DIR="${REPO_ROOT}/vendor/RtAudio"
TEST_DIR="${REPO_ROOT}/tests/rtaudio-device"
BUILD_DIR="$(mktemp -d)"

trap 'rm -rf "${BUILD_DIR}"' EXIT

CXX="${CXX:-clang++}"
CXXFLAGS=(-std=c++17 -O0 -g -Wall -Wextra -Wno-unused-parameter
          -I"${RUNTIME_DIR}" -I"${RTAUDIO_DIR}")

echo "=== RtAudio backend tests (M80) ==="
echo "Compiler: $(${CXX} --version | head -1)"
echo ""

# Vendored third-party code: built without the project's warning set.
# On Windows (MSYS2/MinGW) RtAudio is built with its real WASAPI API, exactly
# as emulator/CMakeLists.txt does; elsewhere with its dummy API.
RTAUDIO_DEFS=()
RTAUDIO_LIBS=()
case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
        RTAUDIO_DEFS=(-D__WINDOWS_WASAPI__)
        RTAUDIO_LIBS=(-lole32 -lwinmm -lksuser -lmfplat -lmfuuid -lwmcodecdspuuid)
        ;;
    *)
        RTAUDIO_DEFS=(-DDS_TEST_RTAUDIO_DUMMY)
        ;;
esac
"${CXX}" -std=c++17 -O0 -g -w ${RTAUDIO_DEFS[@]+"${RTAUDIO_DEFS[@]}"} -c -o "${BUILD_DIR}/RtAudio.o" "${RTAUDIO_DIR}/RtAudio.cpp"

BIN="${BUILD_DIR}/test_rtaudio_device"
"${CXX}" "${CXXFLAGS[@]}" ${RTAUDIO_DEFS[@]+"${RTAUDIO_DEFS[@]}"} -pthread -o "${BIN}" \
    "${TEST_DIR}/test_rtaudio_device.cpp" \
    "${RUNTIME_DIR}/audio_device_rtaudio.cpp" \
    "${BUILD_DIR}/RtAudio.o" ${RTAUDIO_LIBS[@]+"${RTAUDIO_LIBS[@]}"}

"${BIN}"
