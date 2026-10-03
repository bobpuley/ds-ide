#!/usr/bin/env bash
# InputGenerator unit tests (M76 / FR-GEN-2). No audio framework needed.
# Exit code: 0 = pass, 1 = failure.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUILD_DIR="$(mktemp -d)"
trap 'rm -rf "${BUILD_DIR}"' EXIT

CXX="${CXX:-clang++}"
"${CXX}" -std=c++17 -O1 -g -Wall -Wextra -Wshadow \
    -fsanitize=address,undefined -fno-omit-frame-pointer \
    -I"${REPO_ROOT}/emulator/runtime" \
    "${REPO_ROOT}/tests/input-generators/test_input_generators.cpp" \
    "${REPO_ROOT}/emulator/runtime/input_generators.cpp" \
    -o "${BUILD_DIR}/test_input_generators"
"${BUILD_DIR}/test_input_generators"
