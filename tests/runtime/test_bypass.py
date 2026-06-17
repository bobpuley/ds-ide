"""Integration test — bypass: out == in over IPC scope.

DoD (M1): bypass builds, runs headless, and every scope frame satisfies
out[i] ≈ in[i] (max absolute error < 1e-5).
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "helpers"))
from build import cmake_build, REPO_ROOT
from runner import run_emulator

EXAMPLES = os.path.join(REPO_ROOT, "daisy-seed-knowledge/examples")
BUILD_DIR = os.path.join(REPO_ROOT, ".ds-ide/build/test-bypass")
SOCKET    = "/tmp/daisy_emu_bypass_test.sock"


def build() -> str:
    """Build bypass and return path to effect_emu."""
    effect_src = os.path.join(EXAMPLES, "bypass/bypass.cpp")
    assert cmake_build(effect_src, BUILD_DIR), "bypass build failed"
    exe = os.path.join(BUILD_DIR, "effect_emu")
    assert os.path.isfile(exe), f"effect_emu not found at {exe}"
    return exe


def test_bypass_out_equals_in(exe: str) -> None:
    """Verify that at least 3 scope frames have |out[i] - in[i]| < 1e-5."""
    with run_emulator(exe, SOCKET) as client:
        client.send({"type": "config", "sampleRate": 48000, "blockSize": 48})
        client.send({"type": "sine",   "freq": 440.0, "amplitude": 0.5})
        client.send({"type": "transport", "action": "start"})

        verified = 0
        for _ in range(200):
            msg = client.recv_one()
            if msg.get("type") != "scope":
                continue
            in_d  = msg["in"]
            out_d = msg["out"]
            assert in_d and out_d, "scope frame has empty arrays"
            max_err = max(abs(a - b) for a, b in zip(in_d, out_d))
            assert max_err < 1e-5, (
                f"bypass out != in: max error = {max_err:.2e}"
            )
            verified += 1
            if verified >= 3:
                break

        assert verified >= 3, f"only received {verified} valid scope frames"

    print(f"  PASS  bypass (verified {verified} frames, out == in)")


def main() -> int:
    print("=== test_bypass ===")
    exe = build()
    test_bypass_out_equals_in(exe)
    return 0


if __name__ == "__main__":
    sys.exit(main())
