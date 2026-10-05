#!/usr/bin/env bash
# Audio measurement gate (M80 / FR-WIN-AUD-7) — run on real hardware.
#
#   macOS:   CoreAudio baseline (the emulator's CoreAudio backend)
#   Windows: RtAudio over WASAPI shared (the emulator's Windows backend) and
#            WASAPI exclusive (native probe); run from an MSYS2 CLANG64 shell.
#            ASIO is measured too when DS_EMU_ASIO_SDK_DIR points at the ASIO
#            SDK sources (see emulator/CMakeLists.txt, ASIO_SDK_DIR).
#
# Each backend is measured at 64/128/256-frame requests, output-only (the
# simulated-audio path); pass --duplex to also measure live-input streams.
# Prints a markdown table to paste into docs/measurements/windows-audio.md.
#
# Usage: tests/audio-measurement/run_measurements.sh [--seconds N] [--duplex]

set -euo pipefail

SECONDS_PER_RUN=10
DUPLEX=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        --seconds) SECONDS_PER_RUN="$2"; shift 2 ;;
        --duplex)  DUPLEX=1; shift ;;
        *) echo "unknown option: $1" >&2; exit 1 ;;
    esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_DIR="${REPO_ROOT}/emulator/runtime"
RTAUDIO_DIR="${REPO_ROOT}/vendor/RtAudio"
DIR="${REPO_ROOT}/tests/audio-measurement"
BUILD_DIR="$(mktemp -d)"
trap 'rm -rf "${BUILD_DIR}"' EXIT

CXX="${CXX:-clang++}"
CXXFLAGS=(-std=c++17 -O2 -g -Wall -Wextra -Wno-unused-parameter -I"${RUNTIME_DIR}" -I"${DIR}")
FRAMES=(64 128 256)
MODES=(output)
[[ ${DUPLEX} -eq 1 ]] && MODES+=(duplex)

case "$(uname -s)" in
    Darwin)  PLATFORM=macos ;;
    MINGW*|MSYS*|CYGWIN*) PLATFORM=windows ;;
    *) echo "unsupported platform: $(uname -s)" >&2; exit 1 ;;
esac

# Windows: $1 = output binary, $2 = extra RtAudio defines ("" or ASIO), $3.. = extra objects.
build_backend_windows() {
    local out="$1" defs="$2"; shift 2
    # shellcheck disable=SC2086  # defs is a word list on purpose
    "${CXX}" -std=c++17 -O2 -w -D__WINDOWS_WASAPI__ ${defs} -I"${RTAUDIO_DIR}" \
        -c -o "${BUILD_DIR}/RtAudio.o" "${RTAUDIO_DIR}/RtAudio.cpp"
    # shellcheck disable=SC2086
    "${CXX}" "${CXXFLAGS[@]}" -I"${RTAUDIO_DIR}" -D__WINDOWS_WASAPI__ ${defs} -o "${out}" \
        "${DIR}/measure_backend.cpp" "${RUNTIME_DIR}/audio_device_factory.cpp" \
        "${RUNTIME_DIR}/audio_device_rtaudio.cpp" "${BUILD_DIR}/RtAudio.o" "$@" \
        -lole32 -lwinmm -lksuser -lmfplat -lmfuuid -lwmcodecdspuuid -pthread
}

skip_row() {  # $1 = label, $2 = requested frames, $3 = reason
    echo "| $1 | $2 | — | — | — | — | — | — | — | — | $3 |"
}

run() {  # $@ = command; a backend that cannot start gets a placeholder row
    "$@" || skip_row "${LABEL}" "${REQ}" "failed to start"
}

echo "<!-- $(date -u +%Y-%m-%dT%H:%MZ) · $(uname -s) · ${SECONDS_PER_RUN}s per run -->"
echo "| backend | requested | effective | reported | interval ms | jitter ms | p99 dev ms | max ms | latency ms | xruns | driver overruns |"
echo "|---|---|---|---|---|---|---|---|---|---|---|"

if [[ ${PLATFORM} == macos ]]; then
    "${CXX}" "${CXXFLAGS[@]}" -o "${BUILD_DIR}/measure_backend" "${DIR}/measure_backend.cpp" \
        "${RUNTIME_DIR}/audio_device_factory.cpp" "${RUNTIME_DIR}/core_audio_device.cpp" \
        -framework CoreAudio -framework AudioToolbox -pthread
else
    build_backend_windows "${BUILD_DIR}/measure_backend" ""
fi
if [[ ${PLATFORM} == macos ]]; then BASE_LABEL="CoreAudio"; else BASE_LABEL="WASAPI shared (RtAudio)"; fi
for mode in "${MODES[@]}"; do
    for REQ in "${FRAMES[@]}"; do
        LABEL="${BASE_LABEL}, ${mode}"
        run "${BUILD_DIR}/measure_backend" "${LABEL}" "${REQ}" "${SECONDS_PER_RUN}" "${mode}"
    done
done

if [[ ${PLATFORM} == windows ]]; then
    "${CXX}" "${CXXFLAGS[@]}" -o "${BUILD_DIR}/wasapi_exclusive_probe" "${DIR}/wasapi_exclusive_probe.cpp" \
        -lole32 -lavrt
    for REQ in "${FRAMES[@]}"; do
        LABEL="WASAPI exclusive (native probe)"
        run "${BUILD_DIR}/wasapi_exclusive_probe" "${REQ}" "${SECONDS_PER_RUN}"
    done

    if [[ -n "${DS_EMU_ASIO_SDK_DIR:-}" ]]; then
        A="${DS_EMU_ASIO_SDK_DIR}"
        ASIO_OBJS=()
        for f in asio asiodrivers asiolist iasiothiscallresolver; do
            "${CXX}" -std=c++17 -O2 -w -I"${A}" -c -o "${BUILD_DIR}/${f}.o" "${A}/${f}.cpp"
            ASIO_OBJS+=("${BUILD_DIR}/${f}.o")
        done
        build_backend_windows "${BUILD_DIR}/measure_backend_asio" "-D__WINDOWS_ASIO__ -I${A}" "${ASIO_OBJS[@]}"
        for REQ in "${FRAMES[@]}"; do
            LABEL="ASIO (RtAudio), output"
            DS_EMU_AUDIO_API=asio run "${BUILD_DIR}/measure_backend_asio" "${LABEL}" "${REQ}" "${SECONDS_PER_RUN}"
        done
    else
        for REQ in "${FRAMES[@]}"; do
            skip_row "ASIO (RtAudio)" "${REQ}" "not measured: no ASIO SDK/device"
        done
    fi
fi
