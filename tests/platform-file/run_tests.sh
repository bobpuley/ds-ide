#!/usr/bin/env bash
# platform_file shim + POSIX-header hygiene tests (M77 / FR-WIN-BLD-2).
#
# 1. The runtime/shim files that must build on Windows include no POSIX-only
#    header (<unistd.h>, <sys/stat.h>, <fcntl.h>) — those live in the shim.
# 2. Compiles the shim with the recorder and FatFs host shim and runs the
#    behaviour checks in a temp dir.
#
# Exit code: 0 = all pass, 1 = one or more failures.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_DIR="${REPO_ROOT}/emulator/runtime"
SHIM_SRC_DIR="${REPO_ROOT}/emulator/shim/src"
SHIM_INCLUDE="${REPO_ROOT}/emulator/shim/include"
TEST_SRC="${REPO_ROOT}/tests/platform-file/test_platform_file.cpp"
BUILD_DIR="$(mktemp -d)"

trap 'rm -rf "${BUILD_DIR}"' EXIT

echo "=== POSIX-only header check ==="
PORTABLE_FILES=(
    "${RUNTIME_DIR}/wav_reader.cpp"
    "${RUNTIME_DIR}/session_player.cpp"
    "${RUNTIME_DIR}/session_recorder.cpp"
    "${SHIM_SRC_DIR}/fatfs_host.cpp"
)
header_fail=0
for f in "${PORTABLE_FILES[@]}"; do
    if grep -nE '#include[[:space:]]*<(unistd\.h|sys/stat\.h|fcntl\.h)>' "$f"; then
        echo "  FAIL  ${f#"${REPO_ROOT}"/} includes a POSIX-only header"
        header_fail=1
    else
        echo "  PASS  ${f#"${REPO_ROOT}"/}"
    fi
done
[ "${header_fail}" -eq 0 ] || exit 1
echo ""

CXX="${CXX:-clang++}"
CXXFLAGS=(
    -std=c++17 -O0 -g -Wall -Wextra -Wno-unused-parameter
    -I"${RUNTIME_DIR}"
    -I"${SHIM_INCLUDE}"
)

BIN="${BUILD_DIR}/test_platform_file"
"${CXX}" "${CXXFLAGS[@]}" -pthread -o "${BIN}" \
    "${TEST_SRC}" "${RUNTIME_DIR}/platform_file.cpp" \
    "${RUNTIME_DIR}/session_recorder.cpp" "${SHIM_SRC_DIR}/fatfs_host.cpp"

cd "${BUILD_DIR}"
"${BIN}"
