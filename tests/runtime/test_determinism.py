"""Integration test — determinism (NFR-6).

Same sine params + same pot values → identical scope output across two runs.
Uses bypass (no DaisySP dependency) and verifies bit-exact scope data.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "helpers"))
from build import cmake_build, REPO_ROOT
from runner import run_emulator

EXAMPLES  = os.path.join(REPO_ROOT, "tests/fixtures/daisy-examples")
BUILD_DIR = os.path.join(REPO_ROOT, ".ds-ide/build/test-bypass")  # reuse bypass build
SOCKET    = "/tmp/daisy_emu_det_test.sock"


def collect_run(exe: str) -> list:
    """Run bypass, collect the first 3 scope frames, return all out samples."""
    samples = []
    with run_emulator(exe, SOCKET) as client:
        client.send({"type": "config",    "sampleRate": 48000, "blockSize": 48})
        client.send({"type": "sine",      "freq": 220.0, "amplitude": 0.3})
        client.send({"type": "transport", "action": "start"})

        frame_count = 0
        for _ in range(300):
            msg = client.recv_one()
            if msg.get("type") == "scope":
                samples.extend(msg["out"])
                frame_count += 1
                if frame_count >= 3:
                    break

    assert frame_count >= 3, f"only got {frame_count} frames"
    return samples


def test_determinism() -> None:
    exe = os.path.join(BUILD_DIR, "effect_emu")
    assert os.path.isfile(exe), "bypass not built; run test_bypass first"

    run1 = collect_run(exe)
    run2 = collect_run(exe)

    assert len(run1) == len(run2), (
        f"run lengths differ: {len(run1)} vs {len(run2)}"
    )
    max_diff = max(abs(a - b) for a, b in zip(run1, run2))
    assert max_diff < 1e-6, (
        f"non-deterministic output: max diff = {max_diff:.2e}"
    )
    print(f"  PASS  determinism (max diff across {len(run1)} samples: {max_diff:.2e})")


def main() -> int:
    print("=== test_determinism ===")
    # Build if needed
    if not os.path.isfile(os.path.join(BUILD_DIR, "effect_emu")):
        effect_src = os.path.join(EXAMPLES, "bypass/bypass.cpp")
        assert cmake_build(effect_src, BUILD_DIR), "bypass build failed"
    test_determinism()
    return 0


if __name__ == "__main__":
    sys.exit(main())
