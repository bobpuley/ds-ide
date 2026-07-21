"""Integration test — Osc: oscillator output tracks ADC pot value.

DoD (M1): Osc with DaisySP builds, runs headless; scope shows non-silent
output; changing pot ch0 changes the output frequency (different waveform
at low vs high pot value).

Requires DAISYSP_DIR env-var or the sibling-workspace DaisySP installation.
Skips (exit 0 with message) when DaisySP is not found.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "helpers"))
from build import cmake_build, REPO_ROOT, DAISYSP_DIR
from runner import run_emulator

EXAMPLES  = os.path.join(REPO_ROOT, "daisy-seed-knowledge/examples")
BUILD_DIR = os.path.join(REPO_ROOT, ".ds-ide/build/test-osc")
SOCKET    = "/tmp/daisy_emu_osc_test.sock"


def build() -> str:
    effect_src = os.path.join(EXAMPLES, "Osc/Osc.cpp")
    assert cmake_build(effect_src, BUILD_DIR, daisysp_dir=DAISYSP_DIR), \
        "Osc build failed"
    exe = os.path.join(BUILD_DIR, "effect_emu")
    assert os.path.isfile(exe)
    return exe


def collect_scope_frames(client, n: int = 5) -> list:
    frames = []
    for _ in range(300):
        msg = client.recv_one()
        if msg.get("type") == "scope":
            frames.append(msg["out"])
            if len(frames) >= n:
                break
    return frames


def mean_abs(samples: list) -> float:
    return sum(abs(x) for x in samples) / max(len(samples), 1)


def test_osc_produces_output(exe: str) -> None:
    """Verify scope output is non-silent and changes with pot position."""
    with run_emulator(exe, SOCKET) as client:
        client.send({"type": "config",    "sampleRate": 48000, "blockSize": 48})
        client.send({"type": "controlValue", "id": "pot0", "value": 0.25})
        client.send({"type": "transport", "action": "start"})

        low_frames = collect_scope_frames(client, n=3)
        assert low_frames, "no scope frames at pot=0.25"
        low_amp = mean_abs([s for frame in low_frames for s in frame])
        assert low_amp > 0.01, f"Osc silent at pot=0.25: mean_abs={low_amp:.4f}"

        # Move pot to high value → different frequency
        client.send({"type": "controlValue", "id": "pot0", "value": 0.75})
        high_frames = collect_scope_frames(client, n=3)
        high_amp = mean_abs([s for frame in high_frames for s in frame])
        assert high_amp > 0.01, f"Osc silent at pot=0.75: mean_abs={high_amp:.4f}"

        # The waveform at two different pitches will differ (they're sines at
        # different frequencies; even a handful of samples will rarely match)
        all_low  = [s for frame in low_frames for s in frame]
        all_high = [s for frame in high_frames for s in frame]
        n_common  = min(len(all_low), len(all_high))
        diff = sum(abs(a - b) for a, b in zip(all_low[:n_common], all_high[:n_common]))
        assert diff > 0.01 * n_common, \
            "Osc waveform did not change when pot value changed"

    print(f"  PASS  Osc (low pot mean_abs={low_amp:.3f}, high pot mean_abs={high_amp:.3f})")


def main() -> int:
    print("=== test_osc ===")
    if not os.path.isdir(DAISYSP_DIR):
        print(f"  SKIP  DaisySP not found at {DAISYSP_DIR}; "
              "set DAISYSP_DIR to run this test")
        return 0
    exe = build()
    test_osc_produces_output(exe)
    return 0


if __name__ == "__main__":
    sys.exit(main())
