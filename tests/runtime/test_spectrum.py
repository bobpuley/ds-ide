"""Integration test — M13 spectrum: FFT output arrives and peaks at correct bin.

AC-14: with an effect running and a sine input at 440 Hz, a `spectrum` IPC
message is received, and the in_fft has its peak at the expected frequency bin.

Uses the bypass fixture (button_bypass.cpp) so the effect passes audio
unchanged: in == out. For this test we only verify the INPUT spectrum spike,
since the fixture passes audio through.
"""
import math
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "helpers"))
from build import cmake_build, REPO_ROOT
from runner import run_emulator

BUILD_DIR = os.path.join(REPO_ROOT, ".ds-ide/build/test-spectrum")
FIXTURE   = os.path.join(REPO_ROOT, "tests/runtime/fixtures/button_bypass.cpp")
SOCKET    = "/tmp/daisy_emu_spectrum_test.sock"

SAMPLE_RATE = 48000
N_FFT       = 1024
BIN_HZ      = SAMPLE_RATE / N_FFT   # ≈ 46.875 Hz per bin
SINE_FREQ   = 440.0                 # Hz


def expected_peak_bin(freq: float) -> int:
    return round(freq / BIN_HZ)


def collect_spectrum(client, max_msgs: int = 600) -> dict | None:
    for _ in range(max_msgs):
        msg = client.recv_one()
        if msg.get("type") == "spectrum":
            return msg
    return None


def test_spectrum_spike(exe: str) -> None:
    with run_emulator(exe, SOCKET) as client:
        client.send({"type": "config", "sampleRate": SAMPLE_RATE, "blockSize": 48})
        client.send({"type": "sine", "freq": SINE_FREQ, "amplitude": 0.5})
        client.send({"type": "transport", "action": "start"})

        # Give the engine a moment to accumulate N_FFT samples (≈1 k samples at 48 kHz
        # with block_size=48 needs ~21 blocks → ~21 ms; add generous margin).
        time.sleep(0.2)

        msg = collect_spectrum(client, max_msgs=800)
        assert msg is not None, "no `spectrum` message received"

        in_fft  = msg.get("in_fft",  [])
        out_fft = msg.get("out_fft", [])
        bin_hz  = msg.get("binHz", 0.0)

        assert len(in_fft) == N_FFT // 2, (
            f"in_fft has {len(in_fft)} bins, expected {N_FFT // 2}"
        )
        assert len(out_fft) == N_FFT // 2, (
            f"out_fft has {len(out_fft)} bins, expected {N_FFT // 2}"
        )
        assert abs(bin_hz - BIN_HZ) < 1.0, (
            f"binHz={bin_hz:.4f}, expected ≈{BIN_HZ:.4f}"
        )

        # Peak bin in in_fft should be within ±2 bins of the expected bin
        peak_bin = max(range(len(in_fft)), key=lambda i: in_fft[i])
        exp_bin  = expected_peak_bin(SINE_FREQ)
        assert abs(peak_bin - exp_bin) <= 2, (
            f"Spectrum peak at bin {peak_bin} ({peak_bin * bin_hz:.1f} Hz), "
            f"expected bin {exp_bin} ({SINE_FREQ} Hz); "
            f"peak magnitude={in_fft[peak_bin]:.4f}"
        )

        # Peak should be significantly above noise floor
        peak_val = in_fft[peak_bin]
        mean_val = sum(in_fft) / len(in_fft)
        assert peak_val > mean_val * 5, (
            f"Spectrum peak ({peak_val:.4f}) not sufficiently above mean "
            f"({mean_val:.4f}) — spike expected at sine frequency"
        )

    print(
        f"  PASS  spectrum peak at bin {peak_bin} "
        f"({peak_bin * bin_hz:.1f} Hz ≈ {SINE_FREQ} Hz), "
        f"peak={in_fft[peak_bin]:.4f}, mean={mean_val:.5f}, "
        f"SNR≈{peak_val / mean_val:.1f}×"
    )


def main() -> int:
    print("=== test_spectrum (M13 AC-14 FFT spike) ===")
    assert cmake_build(FIXTURE, BUILD_DIR), "spectrum test fixture build failed"
    exe = os.path.join(BUILD_DIR, "effect_emu")
    assert os.path.isfile(exe), f"effect_emu not found at {exe}"
    test_spectrum_spike(exe)
    return 0


if __name__ == "__main__":
    sys.exit(main())
