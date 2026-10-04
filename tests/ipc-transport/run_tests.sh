#!/usr/bin/env bash
# IPC transport unit tests (M78 / FR-WIN-IPC-1).
#
# Builds both transports (Unix socket + TCP loopback) with the test harness
# and runs the same checks against each.
#
# Exit code: 0 = all pass, 1 = one or more failures.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_DIR="${REPO_ROOT}/emulator/runtime"
TEST_SRC="${REPO_ROOT}/tests/ipc-transport/test_ipc_transport.cpp"
BUILD_DIR="$(mktemp -d)"

trap 'rm -rf "${BUILD_DIR}"' EXIT

CXX="${CXX:-clang++}"
CXXFLAGS=(
    -std=c++17 -O0 -g -Wall -Wextra -Wno-unused-parameter
    -I"${RUNTIME_DIR}"
)

echo "Compiler: $(${CXX} --version | head -1)"
echo ""

BIN="${BUILD_DIR}/test_ipc_transport"
"${CXX}" "${CXXFLAGS[@]}" -pthread -o "${BIN}" \
    "${TEST_SRC}" "${RUNTIME_DIR}/ipc_transport_socket.cpp" \
    "${RUNTIME_DIR}/ipc_transport_unix.cpp" "${RUNTIME_DIR}/ipc_transport_tcp.cpp"

"${BIN}"
