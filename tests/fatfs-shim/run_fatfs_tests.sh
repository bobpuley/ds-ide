#!/usr/bin/env bash
# FatFS host shim unit test (M45, FR-DEV-10).
#
# Compiles the fatfs_host shim standalone (no EmulatorState/IPC dependency —
# this device has no runtime controlValue traffic) and runs it from inside a
# disposable temp directory, so the "sdcard/" host directory it creates never
# touches the repo.
#
# Exit code: 0 = all pass, 1 = one or more failures.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SHIM_INCLUDE="${REPO_ROOT}/emulator/shim/include"
SHIM_SRC="${REPO_ROOT}/emulator/shim/src"
TEST_SRC="${REPO_ROOT}/tests/fatfs-shim/test_fatfs.cpp"
BUILD_DIR="$(mktemp -d)"

trap 'rm -rf "${BUILD_DIR}"' EXIT

CXX="${CXX:-clang++}"
CXXFLAGS=(-std=c++17 -O0 -g -Wall -Wextra -I"${SHIM_INCLUDE}")

echo "=== FatFS host shim unit tests ==="
echo "Compiler : $(${CXX} --version | head -1)"
echo ""

BIN="${BUILD_DIR}/test_fatfs"
"${CXX}" "${CXXFLAGS[@]}" -o "${BIN}" "${TEST_SRC}" "${SHIM_SRC}/fatfs_host.cpp"

cd "${BUILD_DIR}"
"${BIN}"
