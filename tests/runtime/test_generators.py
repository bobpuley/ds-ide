"""Integration test — M76 input generators (FR-GEN-3, FR-GEN-4).

A `generator` message replaces the sine branch of the emulator's input stage:
Silence reads exact zeros, Impulse spaces its samples by the period (checked in a
full-rate scope capture), noise is identical across two runs, and an unknown
generator kind is ignored without crashing the emulator.
"""
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "helpers"))
from build import cmake_build, REPO_ROOT
from runner import run_emulator

BUILD_DIR = os.path.join(REPO_ROOT, ".ds-ide/build/test-generators")
FIXTURE   = os.path.join(REPO_ROOT, "tests/runtime/fixtures/button_bypass.cpp")
SOCKET    = "/tmp/daisy_emu_generators_test.sock"

SAMPLE_RATE = 48000
AMP         = 0.5
PERIOD_MS   = 10          # 480 samples at 48 kHz
PERIOD      = SAMPLE_RATE * PERIOD_MS // 1000
WINDOW      = 4096
PRE         = 1024


def start(client, generator: dict) -> None:
    client.send({"type": "config", "sampleRate": SAMPLE_RATE, "blockSize": 48})
    client.send({"type": "generator", **generator})
    client.send({"type": "transport", "action": "start"})


def recv_type(client, want: str, max_msgs: int = 3000):
    for _ in range(max_msgs):
        msg = client.recv_one()
        if msg.get("type") == want:
            return msg
    return None


def first_scope_frames(exe: str, generator: dict, frames: int = 3) -> list:
    samples = []
    with run_emulator(exe, SOCKET) as client:
        start(client, generator)
        for _ in range(frames):
            msg = recv_type(client, "scope")
            assert msg is not None, "no `scope` message received"
            samples.extend(msg["in"])
    return samples


def test_silence(exe: str) -> None:
    ins = first_scope_frames(exe, {"kind": "silence"})
    assert ins and all(s == 0.0 for s in ins), "silence input is not exactly zero"
    print(f"  PASS  silence reads exact zeros ({len(ins)} samples)")


def test_impulse_spacing(exe: str) -> None:
    with run_emulator(exe, SOCKET) as client:
        start(client, {"kind": "impulse", "amp": AMP, "period": PERIOD_MS})
        time.sleep(0.2)
        client.send({"type": "scopeCapture", "action": "arm",
                     "source": "in", "edge": "rise", "level": 0.1})
        msg = recv_type(client, "scope_capture")
        assert msg is not None, "no `scope_capture` message received"
    ins = msg["in"]
    hits = [i for i, s in enumerate(ins) if s != 0.0]
    # The window holds PRE samples before the trigger, so earlier impulses appear too.
    assert PRE in hits, f"the trigger index {PRE} is not an impulse: {hits}"
    assert all(abs(ins[i] - AMP) < 1e-6 for i in hits), "impulse value is not Amp"
    assert all(b - a == PERIOD for a, b in zip(hits, hits[1:])), f"impulse spacing {hits}"
    assert len(hits) >= 5, f"only {len(hits)} impulses in the window"
    print(f"  PASS  impulse every {PERIOD} samples ({len(hits)} in the window)")


def test_noise_determinism(exe: str) -> None:
    gen = {"kind": "noise", "amp": 0.3, "color": "pink"}
    run1 = first_scope_frames(exe, gen)
    run2 = first_scope_frames(exe, gen)
    assert run1 == run2, "noise differs between two runs with identical settings"
    assert max(abs(s) for s in run1) <= 0.3 + 1e-6, "noise exceeds Amp"
    assert any(s != 0.0 for s in run1), "noise is silent"
    print(f"  PASS  noise is deterministic across runs ({len(run1)} samples)")


def test_bad_messages_ignored(exe: str) -> None:
    with run_emulator(exe, SOCKET) as client:
        client.send({"type": "config", "sampleRate": SAMPLE_RATE, "blockSize": 48})
        client.send({"type": "generator", "kind": "bogus", "amp": 0.5})
        client.send({"type": "generator", "kind": "impulse", "amp": "loud", "period": "x"})
        client.send({"type": "generator", "kind": "step", "amp": 9.0, "period": 0})  # clamped
        client.send({"type": "transport", "action": "start"})
        msg = recv_type(client, "scope")
        assert msg is not None, "emulator stopped streaming after bad generator messages"
        assert max(abs(s) for s in msg["in"]) <= 1.0, "Amp was not clamped"
    print("  PASS  unknown kind / non-numeric fields ignored, ranges clamped")


def main() -> int:
    print("=== test_generators (M76 FR-GEN-3 / FR-GEN-4) ===")
    assert cmake_build(FIXTURE, BUILD_DIR), "generators test fixture build failed"
    exe = os.path.join(BUILD_DIR, "effect_emu")
    assert os.path.isfile(exe), f"effect_emu not found at {exe}"
    test_silence(exe)
    test_impulse_spacing(exe)
    test_noise_determinism(exe)
    test_bad_messages_ignored(exe)
    return 0


if __name__ == "__main__":
    sys.exit(main())
