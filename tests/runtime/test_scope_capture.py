"""Integration test — M72 emulator-side scope capture (FR-SCI-14b).

A `scopeCapture` arm request on a running emulator yields one full-rate
`scope_capture` window triggered at the requested level; a cancel yields none.
"""
import os
import socket
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "helpers"))
from build import cmake_build, REPO_ROOT
from runner import run_emulator

BUILD_DIR = os.path.join(REPO_ROOT, ".ds-ide/build/test-scope-capture")
FIXTURE   = os.path.join(REPO_ROOT, "tests/runtime/fixtures/button_bypass.cpp")
SOCKET    = "/tmp/daisy_emu_scope_capture_test.sock"

SAMPLE_RATE = 48000
SINE_FREQ   = 440.0
AMPLITUDE   = 0.5
LEVEL       = 0.1
WINDOW      = 4096
PRE         = 1024


def start(client) -> None:
    client.send({"type": "config", "sampleRate": SAMPLE_RATE, "blockSize": 48})
    client.send({"type": "sine", "freq": SINE_FREQ, "amplitude": AMPLITUDE})
    client.send({"type": "transport", "action": "start"})


def recv_capture(client, max_msgs: int = 3000):
    for _ in range(max_msgs):
        msg = client.recv_one()
        if msg.get("type") == "scope_capture":
            return msg
    return None


def test_triggered_window(exe: str) -> None:
    with run_emulator(exe, SOCKET) as client:
        start(client)
        time.sleep(0.2)
        client.send({"type": "scopeCapture", "action": "arm",
                     "source": "in", "edge": "rise", "level": LEVEL})
        msg = recv_capture(client)
        assert msg is not None, "no `scope_capture` message received"

        ins = msg["in"]
        assert len(ins) == WINDOW and len(msg["out"]) == WINDOW and len(msg["out_r"]) == WINDOW, \
            f"window lengths {len(ins)}/{len(msg['out'])}/{len(msg['out_r'])}, expected {WINDOW}"
        assert msg["rate"] == SAMPLE_RATE, f"rate={msg['rate']}"
        t = msg["trigger"]
        assert t == PRE, f"trigger index {t}, expected {PRE}"
        assert ins[t - 1] < LEVEL <= ins[t], f"edge not at trigger: {ins[t-1]}, {ins[t]}"
        # Full rate: consecutive samples of a 440 Hz sine move ≤ ~0.029; a 4× decimated
        # stream would step ≈ 0.115.
        max_step = max(abs(ins[i + 1] - ins[i]) for i in range(len(ins) - 1))
        assert max_step < 0.04, f"max step {max_step:.4f} — window looks decimated"
    print(f"  PASS  triggered full-rate window (max step {max_step:.4f})")


def test_cancel_yields_none(exe: str) -> None:
    with run_emulator(exe, SOCKET, timeout=5.0) as client:
        start(client)
        time.sleep(0.1)
        client.send({"type": "scopeCapture", "action": "arm",
                     "source": "in", "edge": "rise", "level": LEVEL})
        client.send({"type": "scopeCapture", "action": "cancel"})
        deadline = time.time() + 0.6
        client._sock.settimeout(0.2)
        while time.time() < deadline:
            try:
                msg = client.recv_one()
            except socket.timeout:
                continue
            assert msg.get("type") != "scope_capture", "capture arrived after cancel"
    print("  PASS  cancel yields no capture")


def main() -> int:
    print("=== test_scope_capture (M72 FR-SCI-14b) ===")
    assert cmake_build(FIXTURE, BUILD_DIR), "scope-capture test fixture build failed"
    exe = os.path.join(BUILD_DIR, "effect_emu")
    assert os.path.isfile(exe), f"effect_emu not found at {exe}"
    test_triggered_window(exe)
    test_cancel_yields_none(exe)
    return 0


if __name__ == "__main__":
    sys.exit(main())
