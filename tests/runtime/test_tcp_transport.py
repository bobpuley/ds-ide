"""Integration test — TCP loopback IPC transport, session token and graceful
shutdown message (FR-WIN-IPC-1, FR-WIN-IPC-2, FR-WIN-IPC-3).

Runs on macOS (`effect_emu --tcp`) and, unchanged, as the Windows CI smoke
test (`effect_emu.exe`, where TCP is the only transport): build a bare
fixture, parse the `DAISY_EMU_SOCKET:127.0.0.1:<port>` announce, connect,
and complete the protocolVersion + status handshake after presenting the
per-session token (written to the emulator's stdin, as the extension does).
Connections with a wrong or missing token are closed unanswered. A `shutdown`
message ends the emulator with status 0 and finalizes an active recording —
the only graceful stop on Windows, where terminating a process skips signal
handlers. On POSIX it also checks
the Unix-socket transport still removes its socket file at shutdown.

Bare libDaisy fixture (no DaisySP) so the test never skips.
"""
import os
import re
import secrets
import signal
import socket
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "helpers"))
from build import cmake_build, REPO_ROOT
from client import EmulatorClient

IS_WINDOWS = os.name == "nt"
FIXTURE   = os.path.join(REPO_ROOT, "tests/runtime/fixtures/passthrough.cpp")
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


def spawn_tcp(exe: str, token: "str | None") -> subprocess.Popen:
    proc = subprocess.Popen([exe, "--tcp"], stdin=subprocess.PIPE,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if token is not None:
        proc.stdin.write((token + "\n").encode())
    proc.stdin.close()
    return proc


def hello(client: EmulatorClient, token: str) -> None:
    client.send({"type": "hello", "token": token})


def rejected_without_reply(address: str, first_line: "bytes | None") -> bool:
    """True if the server closes the connection without sending anything."""
    host, port = address.split(":")
    s = socket.create_connection((host, int(port)), timeout=5.0)
    try:
        if first_line is not None:
            s.sendall(first_line)
        data = s.recv(4096)
        return data == b""
    except (ConnectionResetError, ConnectionAbortedError):
        return True
    finally:
        s.close()


def stop(proc: subprocess.Popen) -> None:
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()


def test_tcp_handshake(exe: str) -> None:
    token = secrets.token_hex(32)
    proc = spawn_tcp(exe, token)
    try:
        address = read_announce(proc)
        port = int(address.split(":")[1])
        check(0 < port < 65536, f"announces DAISY_EMU_SOCKET:127.0.0.1:<port> ({address})")

        check(rejected_without_reply(address, b'{"type":"hello","token":"' + secrets.token_hex(32).encode() + b'"}\n'),
              "a wrong token is closed without any reply (FR-WIN-IPC-2)")
        check(rejected_without_reply(address, b'{"type":"status"}\n'),
              "a first message that is not a hello is closed without any reply (FR-WIN-IPC-2)")
        check(rejected_without_reply(address, None),
              "a client that never presents a token is closed after the timeout (FR-WIN-IPC-2)")

        client = EmulatorClient(address, timeout=5.0)
        hello(client, token)
        first = client.recv_one()
        check(first.get("type") == "protocolVersion", "with the right token, protocolVersion is the first message")
        second = client.recv_one()
        check(second.get("type") == "status", "initial status follows over TCP")
        client.close()

        # A second connection after the first closes is served too.
        client = EmulatorClient(address, timeout=5.0)
        hello(client, token)
        check(client.recv_one().get("type") == "protocolVersion", "a reconnect is served")
        client.close()
    finally:
        stop(proc)


def wait_for_audio(client: EmulatorClient) -> bool:
    for _ in range(400):
        if client.recv_one().get("type") == "scope":
            return True
    return False


def test_shutdown_message_over_tcp(exe: str) -> None:
    token = secrets.token_hex(32)
    proc = spawn_tcp(exe, token)
    rec_path = os.path.join(tempfile.gettempdir(), f"daisy_emu_shutdown_{os.getpid()}.dsrec")
    try:
        address = read_announce(proc)
        client = EmulatorClient(address, timeout=5.0)
        hello(client, token)
        client.recv_type("protocolVersion")
        client.send({"type": "config", "sampleRate": 48000, "blockSize": 48})
        client.send({"type": "sine", "freq": 440.0, "amplitude": 0.5})
        client.send({"type": "transport", "action": "start"})
        client.send({"type": "recordStart", "path": rec_path})
        check(wait_for_audio(client), "audio blocks flow (scope frames arrive) before shutdown")

        client.send({"type": "shutdown"})
        try:
            rc = proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            rc = None
        client.close()
        check(rc == 0, f"a shutdown message exits with status 0 (rc={rc}) (FR-WIN-IPC-3)")

        content = open(rec_path, "rb").read() if os.path.isfile(rec_path) else b""
        check(len(content) > 32 and content[:6] == b"DSREC\x00",
              "the active recording was written")
        check(content[-1:] == b"\xff",
              "the recording ends with the END marker — flushed on graceful shutdown (FR-EMU-8)")
    finally:
        if proc.poll() is None:
            stop(proc)
        if os.path.isfile(rec_path):
            os.unlink(rec_path)


def test_identity_query_matches_extension_parser(exe: str) -> None:
    """FR-WIN-IPC-4: the extension's stale-process check parses the real OS
    query output (manager.ts isEffectEmuProcess) — verify that format here
    against a live emulator, on the platform this runs on."""
    token = secrets.token_hex(32)
    proc = spawn_tcp(exe, token)
    try:
        read_announce(proc)
        if IS_WINDOWS:
            out = subprocess.run(["tasklist", "/FI", f"PID eq {proc.pid}", "/FO", "CSV", "/NH"],
                                 capture_output=True, text=True).stdout.strip()
            m = re.match(r'^"([^"]*)","(\d+)"', out)
            check(bool(m) and m.group(1).lower() == "effect_emu.exe" and m.group(2) == str(proc.pid),
                  f"tasklist reports a live emulator as effect_emu.exe with its PID ({out[:60]!r})")
        else:
            out = subprocess.run(["ps", "-p", str(proc.pid), "-o", "comm="],
                                 capture_output=True, text=True).stdout.strip()
            check(os.path.basename(out) == "effect_emu",
                  f"ps reports a live emulator's executable name as effect_emu ({out!r})")
    finally:
        stop(proc)


def test_tcp_requires_a_token(exe: str) -> None:
    proc = spawn_tcp(exe, None)
    try:
        rc = proc.wait(timeout=10)
        err = proc.stderr.read().decode(errors="replace")
        check(rc != 0, "--tcp without a session token on stdin refuses to start (FR-WIN-IPC-2)")
        check("token" in err.lower(), "the refusal names the missing session token")
    finally:
        if proc.poll() is None:
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

        proc = subprocess.Popen([exe, sock], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        deadline = time.time() + 10.0
        while not os.path.exists(sock) and time.time() < deadline:
            time.sleep(0.05)
        client = EmulatorClient(sock, timeout=5.0)
        client.recv_type("protocolVersion")
        client.send({"type": "shutdown"})
        rc = proc.wait(timeout=5)
        client.close()
        check(rc == 0, "unix: a shutdown message also exits 0 (FR-WIN-IPC-3)")
        check(not os.path.exists(sock), "unix: socket file is removed after a shutdown message")
    finally:
        if proc.poll() is None:
            stop(proc)
        if os.path.exists(sock):
            os.unlink(sock)


def main() -> int:
    print("=== test_tcp_transport (FR-WIN-IPC-1) ===")
    exe = build()
    test_tcp_handshake(exe)
    test_tcp_requires_a_token(exe)
    test_shutdown_message_over_tcp(exe)
    test_identity_query_matches_extension_parser(exe)
    if not IS_WINDOWS:
        test_unix_socket_removed_at_shutdown(exe)
    print(f"\nResult: {'all passed' if failures == 0 else 'FAILURES'}")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
