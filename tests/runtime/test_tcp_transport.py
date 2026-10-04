"""Integration test — TCP loopback IPC transport (FR-WIN-IPC-1).

Runs on macOS (`effect_emu --tcp`) and, unchanged, as the Windows CI smoke
test (`effect_emu.exe`, where TCP is the only transport): build a bare
fixture, parse the `DAISY_EMU_SOCKET:127.0.0.1:<port>` announce, connect,
and complete the protocolVersion + status handshake. On POSIX it also checks
the Unix-socket transport still removes its socket file at shutdown.

Bare libDaisy fixture (no DaisySP) so the test never skips.
"""
import os
import re
import signal
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "helpers"))
from build import cmake_build, REPO_ROOT
from client import EmulatorClient

IS_WINDOWS = os.name == "nt"
FIXTURE   = os.path.join(REPO_ROOT, "tests/runtime/fixtures/button_bypass.cpp")
BUILD_DIR = os.path.join(REPO_ROOT, ".ds-ide/build/test-tcp-transport")
EXE_NAME  = "effect_emu.exe" if IS_WINDOWS else "effect_emu"
ANNOUNCE  = re.compile(r"^DAISY_EMU_SOCKET:(127\.0\.0\.1:(\d+))\s*$")

failures = 0


def check(cond: bool, msg: str) -> None:
    global failures
    print(f"  {'PASS' if cond else 'FAIL'}  {msg}")
    if not cond:
        failures += 1


def build() -> str:
    assert cmake_build(FIXTURE, BUILD_DIR), "button_bypass build failed"
    exe = os.path.join(BUILD_DIR, EXE_NAME)
    assert os.path.isfile(exe), f"{EXE_NAME} not found at {exe}"
    return exe


def read_announce(proc: subprocess.Popen, timeout: float = 10.0) -> str:
    deadline = time.time() + timeout
    while time.time() < deadline:
        line = proc.stdout.readline().decode(errors="replace")
        if not line:
            if proc.poll() is not None:
                raise RuntimeError(f"effect_emu exited early (rc={proc.returncode}):\n"
                                   + proc.stderr.read().decode(errors="replace"))
            continue
        m = ANNOUNCE.match(line)
        if m:
            return m.group(1)
    raise TimeoutError("effect_emu did not announce a TCP address in time")


def stop(proc: subprocess.Popen) -> None:
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()


def test_tcp_handshake(exe: str) -> None:
    proc = subprocess.Popen([exe, "--tcp"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        address = read_announce(proc)
        port = int(address.split(":")[1])
        check(0 < port < 65536, f"announces DAISY_EMU_SOCKET:127.0.0.1:<port> ({address})")

        client = EmulatorClient(address, timeout=5.0)
        first = client.recv_one()
        check(first.get("type") == "protocolVersion", "protocolVersion is the first message over TCP")
        second = client.recv_one()
        check(second.get("type") == "status", "initial status follows over TCP")
        client.close()

        # A second connection after the first closes is served too.
        client = EmulatorClient(address, timeout=5.0)
        check(client.recv_one().get("type") == "protocolVersion", "a reconnect is served")
        client.close()
    finally:
        stop(proc)


def test_unix_socket_removed_at_shutdown(exe: str) -> None:
    sock = os.path.join(tempfile.gettempdir(), f"daisy_emu_tcp_test_{os.getpid()}.sock")
    proc = subprocess.Popen([exe, sock], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        deadline = time.time() + 10.0
        while not os.path.exists(sock) and time.time() < deadline:
            time.sleep(0.05)
        check(os.path.exists(sock), "unix: socket file is created at the announced path")
        proc.send_signal(signal.SIGTERM)
        rc = proc.wait(timeout=5)
        check(rc == 0, "unix: SIGTERM still exits 0")
        check(not os.path.exists(sock), "unix: socket file is removed at shutdown")
    finally:
        if proc.poll() is None:
            stop(proc)
        if os.path.exists(sock):
            os.unlink(sock)


def main() -> int:
    print("=== test_tcp_transport (FR-WIN-IPC-1) ===")
    exe = build()
    test_tcp_handshake(exe)
    if not IS_WINDOWS:
        test_unix_socket_removed_at_shutdown(exe)
    print(f"\nResult: {'all passed' if failures == 0 else 'FAILURES'}")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
