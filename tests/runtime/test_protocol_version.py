"""Integration test — protocol version handshake (FR-DEV-6).

DoD: the emulator's very first line on a new connection is a protocolVersion
message, and its value matches the extension's own PROTOCOL_VERSION constant
(src/ipc/protocol-version.ts) — the one place both sides' hardcoded version
numbers must actually agree, which no C++-only or TS-only unit test can
verify end to end.

Bare libDaisy fixture (no DaisySP) so the test never skips.
"""
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "helpers"))
from build import cmake_build, REPO_ROOT
from client import EmulatorClient
import subprocess
import time

FIXTURE   = os.path.join(REPO_ROOT, "tests/runtime/fixtures/button_bypass.cpp")
BUILD_DIR = os.path.join(REPO_ROOT, ".ds-ide/build/test-protocol-version")
SOCKET    = "/tmp/daisy_emu_protocol_version_test.sock"

TS_CONSTANT_PATH = os.path.join(REPO_ROOT, "src/ipc/protocol-version.ts")


def build() -> str:
    assert cmake_build(FIXTURE, BUILD_DIR), "button_bypass build failed"
    exe = os.path.join(BUILD_DIR, "effect_emu")
    assert os.path.isfile(exe), f"effect_emu not found at {exe}"
    return exe


def extension_protocol_version() -> int:
    src = open(TS_CONSTANT_PATH).read()
    m = re.search(r"PROTOCOL_VERSION\s*=\s*(\d+)", src)
    assert m, f"could not find PROTOCOL_VERSION in {TS_CONSTANT_PATH}"
    return int(m.group(1))


def test_protocol_version_is_first_message_and_matches_extension(exe: str) -> None:
    if os.path.exists(SOCKET):
        os.unlink(SOCKET)
    proc = subprocess.Popen([exe, SOCKET], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        deadline = time.time() + 5.0
        while not os.path.exists(SOCKET):
            assert time.time() < deadline, "effect_emu did not create socket in time"
            assert proc.poll() is None, "effect_emu exited before creating socket"
            time.sleep(0.05)

        client = EmulatorClient(SOCKET, timeout=5.0)
        first = client.recv_one()
        assert first.get("type") == "protocolVersion", (
            f"expected the first message to be protocolVersion, got: {first}"
        )
        emulator_version = first.get("version")
        expected = extension_protocol_version()
        assert emulator_version == expected, (
            f"emulator protocolVersion ({emulator_version}) does not match "
            f"extension's PROTOCOL_VERSION ({expected}) — "
            f"emulator/runtime/ipc_server.h's kProtocolVersion and "
            f"src/ipc/protocol-version.ts's PROTOCOL_VERSION have drifted"
        )
        client.close()
        print(f"  PASS  protocolVersion={emulator_version} sent first, matches extension")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()
        if os.path.exists(SOCKET):
            os.unlink(SOCKET)


def main() -> int:
    print("=== test_protocol_version (FR-DEV-6) ===")
    exe = build()
    test_protocol_version_is_first_message_and_matches_extension(exe)
    return 0


if __name__ == "__main__":
    sys.exit(main())
