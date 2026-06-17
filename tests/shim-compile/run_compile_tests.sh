#!/usr/bin/env bash
# Shim API compile-test (T0.3 / M0 DoD).
#
# Verifies that the host libDaisy shim headers (emulator/shim/include/) allow
# each v1 example to compile with the host C++ compiler.  No linking step —
# we are only checking interface compatibility, not producing a runnable binary.
#
# Exit code: 0 = all pass, 1 = one or more failures.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SHIM_INCLUDE="${REPO_ROOT}/emulator/shim/include"
STUBS_DIR="${REPO_ROOT}/tests/shim-compile/stubs"
EXAMPLES_DIR="${REPO_ROOT}/daisy-seed-knowledge/examples"
BUILD_DIR="$(mktemp -d)"

trap 'rm -rf "${BUILD_DIR}"' EXIT

CXX="${CXX:-clang++}"
CXXFLAGS=(-std=c++17 -c -O0 -Wall -Wno-unused-parameter -Wno-unused-variable
          -I"${SHIM_INCLUDE}" -I"${STUBS_DIR}")

pass=0
fail=0

compile_example() {
    local name="$1"
    local src="$2"
    local out="${BUILD_DIR}/${name}.o"
    if "${CXX}" "${CXXFLAGS[@]}" -o "${out}" "${src}" 2>&1; then
        echo "  PASS  ${name}"
        ((pass++)) || true
    else
        echo "  FAIL  ${name}"
        ((fail++)) || true
    fi
}

echo "=== Shim compile-tests ==="
echo "Compiler : $(${CXX} --version | head -1)"
echo "Shim     : ${SHIM_INCLUDE}"
echo ""

# --- interleaved examples (v1.0 corpus) ---
compile_example "bypass" "${EXAMPLES_DIR}/bypass/bypass.cpp"
compile_example "Knob"   "${EXAMPLES_DIR}/Knob/Knob.cpp"
compile_example "Osc"    "${EXAMPLES_DIR}/Osc/Osc.cpp"

# --- block/non-interleaved (v1.1, compile-only check here; runtime at M7) ---
compile_example "inout"  "${EXAMPLES_DIR}/inout/InOut.cpp"

echo ""
echo "Results: ${pass} passed, ${fail} failed."
[[ "${fail}" -eq 0 ]]
