#!/usr/bin/env bash
# DaisySeed::PrintLine unit tests (M41 / FR-QA-EMU-7).
#
# Two independent checks:
#   1. Runtime: PrintLine() emits \r\n line endings (test_print_line.cpp).
#   2. Compile-time: PrintLine()'s format(printf, 2, 3) attribute is active —
#      a mismatched varargs call must fail under -Werror=format, while a
#      correctly-typed call (the control) must still compile cleanly.
#
# Exit code: 0 = all pass, 1 = one or more failures.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_DIR="${REPO_ROOT}/emulator/runtime"
SHIM_SRC_DIR="${REPO_ROOT}/emulator/shim/src"
SHIM_INCLUDE="${REPO_ROOT}/emulator/shim/include"
TESTS_DIR="${REPO_ROOT}/tests/print-line"
BUILD_DIR="$(mktemp -d)"

trap 'rm -rf "${BUILD_DIR}"' EXIT

CXX="${CXX:-clang++}"
CXXFLAGS=(-std=c++17 -O0 -g -Wall -Wno-unused-parameter -I"${SHIM_INCLUDE}")
RUNTIME_CXXFLAGS=("${CXXFLAGS[@]}" -I"${RUNTIME_DIR}" -pthread)

echo "=== DaisySeed::PrintLine unit tests ==="
echo "Compiler: $(${CXX} --version | head -1)"
echo ""

pass=0
fail=0

# ---- 1. Runtime: \r\n line endings -----------------------------------------

BIN="${BUILD_DIR}/test_print_line"
"${CXX}" "${RUNTIME_CXXFLAGS[@]}" -o "${BIN}" \
    "${TESTS_DIR}/test_print_line.cpp" "${SHIM_SRC_DIR}/daisy_seed.cpp" "${SHIM_SRC_DIR}/led.cpp" \
    "${RUNTIME_DIR}/session_recorder.cpp" "${RUNTIME_DIR}/session_player.cpp"

if "${BIN}"; then
    ((pass++)) || true
else
    ((fail++)) || true
fi

# ---- 2. Compile-time: format(printf, 2, 3) attribute is active ------------

echo ""
echo "--- FR-QA-EMU-7: format attribute rejects a mismatched PrintLine() call ---"
if "${CXX}" "${CXXFLAGS[@]}" -Werror=format -c -o "${BUILD_DIR}/bad.o" \
    "${TESTS_DIR}/bad_format_call.cpp" 2>"${BUILD_DIR}/bad.log"; then
    echo "  FAIL  a %d/const-char* mismatch compiled cleanly (format attribute not catching it)"
    cat "${BUILD_DIR}/bad.log"
    ((fail++)) || true
else
    echo "  PASS  a %d/const-char* mismatch fails to compile under -Werror=format"
    ((pass++)) || true
fi

echo ""
echo "--- FR-QA-EMU-7: a correctly-typed PrintLine() call still compiles cleanly ---"
if "${CXX}" "${CXXFLAGS[@]}" -Werror=format -c -o "${BUILD_DIR}/good.o" \
    "${TESTS_DIR}/good_format_call.cpp" 2>"${BUILD_DIR}/good.log"; then
    echo "  PASS  a correctly-typed call compiles cleanly under -Werror=format"
    ((pass++)) || true
else
    echo "  FAIL  a correctly-typed call unexpectedly failed to compile"
    cat "${BUILD_DIR}/good.log"
    ((fail++)) || true
fi

echo ""
echo "Results: ${pass} passed, ${fail} failed."
[[ "${fail}" -eq 0 ]]
