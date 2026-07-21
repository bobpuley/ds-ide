"""Subprocess helpers for launching and connecting to effect_emu."""
import os
import subprocess
import sys
import time
from contextlib import contextmanager
from typing import Generator

from client import EmulatorClient


@contextmanager
def run_emulator(exe: str, socket_path: str,
                 timeout: float = 5.0) -> Generator[EmulatorClient, None, None]:
    """Launch effect_emu, wait for socket, yield a connected EmulatorClient.

    The process is terminated (and the socket removed) on context exit.
    """
    if os.path.exists(socket_path):
        os.unlink(socket_path)

    proc = subprocess.Popen(
        [exe, socket_path],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    try:
        # Wait for the socket file to appear (emulator prints DAISY_EMU_SOCKET:…
        # after bind, so socket presence is the readiness signal)
        deadline = time.time() + timeout
        while not os.path.exists(socket_path):
            if time.time() > deadline:
                proc.terminate()
                raise TimeoutError(
                    f"effect_emu did not create socket {socket_path!r} "
                    f"within {timeout}s"
                )
            if proc.poll() is not None:
                stderr = proc.stderr.read().decode(errors="replace")
                raise RuntimeError(
                    f"effect_emu exited early (rc={proc.returncode}):\n{stderr}"
                )
            time.sleep(0.05)

        client = EmulatorClient(socket_path, timeout=timeout)
        # Consume the protocol version handshake (FR-DEV-6), then the initial
        # status message — both always precede any real data on a fresh connection.
        client.recv_type("protocolVersion")
        client.recv_one()
        yield client
        client.close()
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()
        if os.path.exists(socket_path):
            os.unlink(socket_path)
