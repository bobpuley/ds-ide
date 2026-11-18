"""IPC client helper for ds-ide emulator runtime integration tests."""
import json
import re
import socket


TCP_ADDRESS = re.compile(r"^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$")


class EmulatorClient:
    """Connects to an announced address: a Unix socket path, or
    "127.0.0.1:<port>" for the TCP transport (FR-WIN-IPC-1)."""

    def __init__(self, address: str, timeout: float = 5.0) -> None:
        m = TCP_ADDRESS.match(address)
        if m:
            self._sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            target = (m.group(1), int(m.group(2)))
        else:
            self._sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            target = address
        self._sock.settimeout(timeout)
        self._sock.connect(target)
        self._buf = b""

    def send(self, msg: dict) -> None:
        line = json.dumps(msg) + "\n"
        self._sock.sendall(line.encode())

    def recv_one(self) -> dict:
        while b"\n" not in self._buf:
            chunk = self._sock.recv(4096)
            if not chunk:
                raise ConnectionResetError("emulator disconnected")
            self._buf += chunk
        line, self._buf = self._buf.split(b"\n", 1)
        return json.loads(line.decode())

    def recv_type(self, msg_type: str, max_msgs: int = 200) -> dict:
        """Return the first message of the given type, discarding others."""
        for _ in range(max_msgs):
            msg = self.recv_one()
            if msg.get("type") == msg_type:
                return msg
        raise TimeoutError(f"no {msg_type!r} message in {max_msgs} receives")

    def close(self) -> None:
        self._sock.close()
