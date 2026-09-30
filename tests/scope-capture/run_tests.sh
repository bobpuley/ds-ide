#!/usr/bin/env bash
# ScopeCapture unit tests (M72 / FR-SCI-14a). Header-only unit — no audio framework needed.
# Exit code: 0 = pass, 1 = failure.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUILD_DIR="$(mktemp -d)"
trap 'rm -rf "${BUILD_DIR}"' EXIT

CXX="${CXX:-clang++}"
"${CXX}" -std=c++17 -O1 -g -Wall -Wextra -Wshadow \
    -fsanitize=address,undefined -fno-omit-frame-pointer \
    -I"${REPO_ROOT}/emulator/runtime" \
    "${REPO_ROOT}/tests/scope-capture/test_scope_capture.cpp" -o "${BUILD_DIR}/test_scope_capture"
"${BUILD_DIR}/test_scope_capture"
