"""Integration test — FR-EMU-7: mid-session `config` updates take effect
without an audio_mode toggle.

Before the fix, sample_rate/block_size were captured once when the audio
engine thread started and never re-read; a `config` message only updated
reported status, not actual engine behavior (FFT bin labeling, WAV rate).

This test sends a `config` message with a new sampleRate mid-session (no
transport restart, no audio_mode change) and verifies the FFT `binHz` field
changes accordingly within a small number of blocks.
"""
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "helpers"))
from build import cmake_build, REPO_ROOT
from runner import run_emulator

BUILD_DIR = os.path.join(REPO_ROOT, ".ds-ide/build/test-config-reload")
FIXTURE   = os.path.join(REPO_ROOT, "tests/runtime/fixtures/button_bypass.cpp")
SOCKET    = "/tmp/daisy_emu_config_reload_test.sock"

N_FFT = 1024
SINE_FREQ = 440.0


def collect_spectrum_binhz(client, n: int, max_msgs: int = 800) -> list[float]:
    bins = []
    for _ in range(max_msgs):
        msg = client.recv_one()
        if msg.get("type") == "spectrum":
            bins.append(msg.get("binHz", 0.0))
            if len(bins) >= n:
                break
    return bins


def test_config_reload_mid_session(exe: str) -> None:
    with run_emulator(exe, SOCKET) as client:
        client.send({"type": "config", "sampleRate": 48000, "blockSize": 48})
        client.send({"type": "sine", "freq": SINE_FREQ, "amplitude": 0.5})
        client.send({"type": "transport", "action": "start"})

        # Let the engine settle at 48 kHz and confirm the initial binHz.
        time.sleep(0.15)
        before = collect_spectrum_binhz(client, 2)
        assert before, "no spectrum frames received before config change"
        expected_before = 48000 / N_FFT
        assert abs(before[-1] - expected_before) < 1.0, (
            f"binHz={before[-1]:.4f} before change, expected ≈{expected_before:.4f}"
        )

        # Mid-session config change — no transport stop/start, no audioMode
        # message. Before the FR-EMU-7 fix this had zero effect until the
        # active mode loop happened to restart for some unrelated reason.
        client.send({"type": "config", "sampleRate": 96000, "blockSize": 48})

        after = collect_spectrum_binhz(client, 3)
        assert after, "no spectrum frames received after config change"
        expected_after = 96000 / N_FFT
        assert abs(after[-1] - expected_after) < 1.0, (
            f"binHz={after[-1]:.4f} after config change, "
            f"expected ≈{expected_after:.4f} — config update did not take effect"
        )

    print(
        f"  PASS  binHz changed {before[-1]:.3f} → {after[-1]:.3f} "
        f"after a mid-session config update (no mode toggle)"
    )


def main() -> int:
    print("=== test_config_reload (FR-EMU-7 mid-session config takes effect) ===")
    assert cmake_build(FIXTURE, BUILD_DIR), "config-reload test fixture build failed"
    exe = os.path.join(BUILD_DIR, "effect_emu")
    assert os.path.isfile(exe), f"effect_emu not found at {exe}"
    test_config_reload_mid_session(exe)
    return 0


if __name__ == "__main__":
    sys.exit(main())
