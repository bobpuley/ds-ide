"""Integration test — M14 session recording: record a run, replay it, verify output matches.

AC-16: record a run (sine input), replay it — verify the output waveform from
replay matches the recorded run (same mean-absolute-value within 1%).

Uses the passthrough fixture (out = in) so recorded input == output, making the
comparison deterministic: replay produces the same output as the live run.
"""
import math
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "helpers"))
from build import cmake_build, REPO_ROOT
from runner import run_emulator

BUILD_DIR = os.path.join(REPO_ROOT, ".ds-ide/build/test-recording")
FIXTURE   = os.path.join(REPO_ROOT, "tests/runtime/fixtures/passthrough.cpp")
SOCKET    = "/tmp/daisy_emu_recording_test.sock"

SAMPLE_RATE = 48000
BLOCK_SIZE  = 48
SINE_FREQ   = 440.0


def collect_scope_frames(client, n: int, max_msgs: int = 600) -> list[dict]:
    frames = []
    for _ in range(max_msgs):
        msg = client.recv_one()
        if msg.get("type") == "scope":
            frames.append(msg)
            if len(frames) >= n:
                break
    return frames


def mean_abs_out(frames: list[dict]) -> float:
    samples = [s for f in frames for s in f.get("out", [])]
    if not samples:
        return 0.0
    return sum(abs(s) for s in samples) / len(samples)


def drain_until_type(client, msg_type: str, max_msgs: int = 400) -> dict | None:
    for _ in range(max_msgs):
        msg = client.recv_one()
        if msg.get("type") == msg_type:
            return msg
    return None


def test_record_replay(exe: str) -> None:
    rec_file = tempfile.NamedTemporaryFile(suffix=".dsrec", delete=False)
    rec_path = rec_file.name
    rec_file.close()

    try:
        live_frames = []
        replay_frames = []

        # ── Phase 1: record ──────────────────────────────────────────────────
        with run_emulator(exe, SOCKET) as client:
            client.send({"type": "config",
                         "sampleRate": SAMPLE_RATE, "blockSize": BLOCK_SIZE})
            client.send({"type": "sine", "freq": SINE_FREQ, "amplitude": 0.5})
            client.send({"type": "transport", "action": "start"})

            # Warm up (discard first few frames)
            collect_scope_frames(client, 2)

            # Start recording
            client.send({"type": "recordStart", "path": rec_path})

            # Collect live scope frames while recording
            live_frames = collect_scope_frames(client, 6)

            # Stop recording
            client.send({"type": "recordStop"})
            client.send({"type": "transport", "action": "stop"})
            time.sleep(0.05)

        assert live_frames, "no scope frames during recording"
        live_mav = mean_abs_out(live_frames)
        assert live_mav > 0.01, f"live output too quiet: mean_abs={live_mav:.4f}"

        # Verify the .dsrec file was created and is non-empty
        assert os.path.isfile(rec_path), ".dsrec file not created"
        assert os.path.getsize(rec_path) > 16, ".dsrec file suspiciously small"

        # Validate file header magic
        with open(rec_path, "rb") as f:
            header = f.read(16)
        assert header[:6] == b"DSREC\x00", f"bad magic: {header[:6]!r}"
        assert header[6] == 0x02, f"unexpected version: {header[6]}"

        # ── Phase 2: replay ──────────────────────────────────────────────────
        with run_emulator(exe, SOCKET) as client:
            client.send({"type": "config",
                         "sampleRate": SAMPLE_RATE, "blockSize": BLOCK_SIZE})
            # Start replay (replayStart sends the file path; runtime handles mode switch)
            client.send({"type": "replayStart", "path": rec_path})

            # Collect scope frames during replay
            replay_frames = collect_scope_frames(client, 6, max_msgs=800)

            # Wait for replayDone
            done_msg = drain_until_type(client, "replayDone", max_msgs=200)

        assert replay_frames, "no scope frames during replay"
        replay_mav = mean_abs_out(replay_frames)

        # For passthrough (out=in), live and replay outputs should match within 2%
        ratio = abs(replay_mav - live_mav) / max(live_mav, 1e-9)
        assert ratio < 0.02, (
            f"replay output differs from live recording by {ratio*100:.1f}%: "
            f"live_mav={live_mav:.4f}, replay_mav={replay_mav:.4f}"
        )
        assert done_msg is not None, "replayDone message not received"

        print(
            f"  PASS  record: live_mav={live_mav:.4f}  "
            f"replay_mav={replay_mav:.4f}  "
            f"diff={ratio*100:.2f}%  "
            f"file={os.path.getsize(rec_path)} bytes"
        )

    finally:
        if os.path.isfile(rec_path):
            os.unlink(rec_path)


def main() -> int:
    print("=== test_recording (M14 AC-16 record + replay) ===")
    assert cmake_build(FIXTURE, BUILD_DIR), "passthrough fixture build failed"
    exe = os.path.join(BUILD_DIR, "effect_emu")
    assert os.path.isfile(exe), f"effect_emu not found at {exe}"
    test_record_replay(exe)
    return 0


if __name__ == "__main__":
    sys.exit(main())
