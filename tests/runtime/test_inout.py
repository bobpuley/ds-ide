"""Integration test — inout: block/non-interleaved callback; volume pot tracks output.

AC-8 (v1.1): `inout` builds, runs headless, and its ADC channel-0 pot (volume)
visibly drives channel-1 output amplitude on the scope, proving:
  - StartAudio(AudioCallback) block-form overload is dispatched (FR-SH-2 block part)
  - The runtime deinterleaves / reinterleaves the canonical buffer correctly (FR-RU-2 block part)
  - ADC mapping works through the block callback path (AC-2 re-check)

`inout` effect behaviour:
  out[0][i] = 0.0f                          (left channel always silent)
  out[1][i] = hw.adc.GetFloat(1) * volume   (right channel: ADC1 × volume)
  volume     = hw.adc.GetFloat(0)           (ADC0 = volume pot)

The scope emits `out` (left, always ~0) and `out_r` (right) per frame.
We drive ADC1 to a fixed non-zero value and vary ADC0 (volume), then verify
that `out_r` mean-absolute-value scales with volume.

Requires DAISYSP_DIR env-var or the sibling-workspace DaisySP installation
(inout.cpp includes daisysp.h).
Skips (exit 0 with message) when DaisySP is not found.
"""
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "helpers"))
from build import cmake_build, REPO_ROOT, DAISYSP_DIR
from runner import run_emulator

EXAMPLES  = os.path.join(REPO_ROOT, "daisy-seed-knowledge/examples")
BUILD_DIR = os.path.join(REPO_ROOT, ".ds-ide/build/test-inout")
SOCKET    = "/tmp/daisy_emu_inout_test.sock"


def build() -> str:
    effect_src = os.path.join(EXAMPLES, "inout/InOut.cpp")
    assert cmake_build(effect_src, BUILD_DIR, daisysp_dir=DAISYSP_DIR), \
        "inout build failed"
    exe = os.path.join(BUILD_DIR, "effect_emu")
    assert os.path.isfile(exe), f"effect_emu not found at {exe}"
    return exe


def collect_scope_frames(client, n: int) -> list[dict]:
    """Collect n scope frames, returning raw message dicts."""
    frames = []
    for _ in range(400):
        msg = client.recv_one()
        if msg.get("type") == "scope":
            frames.append(msg)
            if len(frames) >= n:
                break
    return frames


def collect_latest_scope_frames(client, n: int, total: int) -> list[dict]:
    """Collect `total` scope frames and return only the last `n`.

    Collecting a large batch and discarding the first ones ensures that
    old scope frames buffered in the socket (from before a pot change) are
    flushed, and the returned frames reflect the current pot values.
    """
    frames = collect_scope_frames(client, total)
    return frames[-n:] if len(frames) >= n else frames


def mean_abs_r(frames: list[dict]) -> float:
    """Mean absolute value of out_r (right output channel) across all frames."""
    samples = [s for f in frames for s in f.get("out_r", [])]
    if not samples:
        return 0.0
    return sum(abs(s) for s in samples) / len(samples)


def test_inout_block_callback(exe: str) -> None:
    """Verify the block-form callback fires and output tracks the volume pot.

    inout reads ADC0 into a `volume` global in its main loop (System::Delay(500)
    between reads).  The first main-loop iteration sees pot_values[0]=0 and sets
    volume=0 before we can send pot messages.  We send pot values as soon as the
    socket is ready, then wait >500 ms for the main loop to re-read the updated
    value before starting transport and collecting scope frames.
    """
    with run_emulator(exe, SOCKET) as client:
        client.send({"type": "config", "sampleRate": 48000, "blockSize": 48})
        # ADC1 = "audio input" for this effect; set to 0.6 (constant signal level)
        client.send({"type": "pot", "channel": 1, "value": 0.6})
        # ADC0 = volume pot; start high.  Send before transport so the main loop
        # picks up the updated value (it re-reads every 500 ms via System::Delay).
        client.send({"type": "pot", "channel": 0, "value": 0.8})
        # Wait for inout's main loop to re-read ADC0 and update `volume` to 0.8.
        # The loop sleeps 500 ms per iteration, so 600 ms is a safe margin.
        time.sleep(0.6)
        client.send({"type": "transport", "action": "start"})

        high_frames = collect_scope_frames(client, n=4)
        assert high_frames, "no scope frames received (block callback may not have fired)"

        # Verify left channel (out) is silent — inout writes only to out[1]
        left_samples = [s for f in high_frames for s in f.get("out", [])]
        assert left_samples, "scope 'out' field missing from frames"
        max_left = max(abs(s) for s in left_samples)
        assert max_left < 1e-5, (
            f"inout left (out) channel should be silent, got max_abs={max_left:.2e}"
        )

        # Verify right channel (out_r) is non-zero at high volume
        assert all("out_r" in f for f in high_frames), (
            "scope 'out_r' field missing — audio_engine not emitting stereo scope data"
        )
        high_amp = mean_abs_r(high_frames)
        assert high_amp > 0.01, (
            f"inout right (out_r) channel silent at volume=0.8, ADC1=0.6: "
            f"mean_abs={high_amp:.4f}"
        )

        # Lower volume and verify amplitude drops.
        # Collect a large batch so that old high-volume frames buffered in the
        # socket during the wait are flushed; the tail of the batch reflects the
        # new volume once the main loop has re-read ADC0.
        client.send({"type": "pot", "channel": 0, "value": 0.1})
        # Collect 30 frames (~1 s). The first ~18 are buffered old frames (high
        # volume); after ~500 ms the main loop picks up the new value and the
        # last frames show low amplitude.
        low_frames_all = collect_scope_frames(client, n=30)
        assert low_frames_all, "no scope frames after pot change"
        # Take only the last 4 frames (freshest, reflecting the updated volume)
        low_frames = low_frames_all[-4:]
        low_amp = mean_abs_r(low_frames)

        assert low_amp < high_amp * 0.6, (
            f"inout right-channel amplitude did not drop when volume dropped "
            f"from 0.8 → 0.1: high={high_amp:.4f}, low={low_amp:.4f}"
        )

    print(
        f"  PASS  inout block-form callback "
        f"(vol=0.8 → mean_abs_r={high_amp:.3f}, vol=0.1 → mean_abs_r={low_amp:.3f})"
    )


def main() -> int:
    print("=== test_inout (AC-8 block-form callback) ===")
    if not os.path.isdir(DAISYSP_DIR):
        print(f"  SKIP  DaisySP not found at {DAISYSP_DIR}; "
              "set DAISYSP_DIR to run this test")
        return 0
    exe = build()
    test_inout_block_callback(exe)
    return 0


if __name__ == "__main__":
    sys.exit(main())
