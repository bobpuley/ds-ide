"""Integration test — WAV file input (AC-10 / M9).

Verifies the full WAV pipeline through the real runtime:
  - a WAV file loaded via the `wavFile` IPC message drives the emulator input
    buffer in simulated-clock mode (T9.1 reader + T9.2 block feed + T9.3 IPC),
  - `bypass` passes it through unchanged, so the output scope matches the WAV
    content (AC-10: "output waveform matches expected transformation of the WAV"),
  - stereo channels map correctly (L → out, R → out_r),
  - sending an empty `wavFile` path deactivates WAV input and the runtime
    reverts to the sine generator.

Uses `bypass` (bare libDaisy, no DaisySP) so the test never skips.
"""
import os
import struct
import sys
import tempfile
import time
import wave

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "helpers"))
from build import cmake_build, REPO_ROOT
from runner import run_emulator

EXAMPLES  = os.path.join(REPO_ROOT, "daisy-seed-knowledge/examples")
BUILD_DIR = os.path.join(REPO_ROOT, ".ds-ide/build/test-wav")
SOCKET    = "/tmp/daisy_emu_wav_test.sock"

WAV_LEFT  = 0.5   # constant left-channel value
WAV_RIGHT = -0.3  # constant right-channel value


def build() -> str:
    effect_src = os.path.join(EXAMPLES, "bypass/bypass.cpp")
    assert cmake_build(effect_src, BUILD_DIR), "bypass build failed"
    exe = os.path.join(BUILD_DIR, "effect_emu")
    assert os.path.isfile(exe), f"effect_emu not found at {exe}"
    return exe


def write_const_stereo_wav(path: str, left: float, right: float,
                           frames: int = 4800, rate: int = 48000) -> None:
    """Write a stereo 16-bit PCM WAV holding a constant (left, right) value."""
    l = int(max(-1.0, min(1.0, left)) * 32767)
    r = int(max(-1.0, min(1.0, right)) * 32767)
    frame = struct.pack("<hh", l, r)
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(frame * frames)


def collect_scope_frames(client, n: int, budget: int = 400) -> list[dict]:
    frames = []
    for _ in range(budget):
        msg = client.recv_one()
        if msg.get("type") == "scope":
            frames.append(msg)
            if len(frames) >= n:
                break
    return frames


def mean_abs(frames: list[dict], key: str) -> float:
    samples = [s for f in frames for s in f.get(key, [])]
    return sum(abs(s) for s in samples) / len(samples) if samples else 0.0


def mean(frames: list[dict], key: str) -> float:
    samples = [s for f in frames for s in f.get(key, [])]
    return sum(samples) / len(samples) if samples else 0.0


def test_wav_input(exe: str) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        wav_path = os.path.join(tmp, "const.wav")
        write_const_stereo_wav(wav_path, WAV_LEFT, WAV_RIGHT)

        with run_emulator(exe, SOCKET) as client:
            client.send({"type": "config", "sampleRate": 48000, "blockSize": 48})
            # Activate WAV input (looping) before starting transport.
            client.send({"type": "wavFile", "path": wav_path, "loop": True})
            client.send({"type": "transport", "action": "start"})

            frames = collect_scope_frames(client, n=6)
            assert frames, "no scope frames received with WAV input active"

            in_left  = mean(frames, "in")
            out_left = mean(frames, "out")
            out_r    = mean(frames, "out_r")

            # WAV drives the input: left ~ +0.5 (clearly not the default sine,
            # whose mean is ~0).
            assert abs(in_left - WAV_LEFT) < 0.05, (
                f"input left should track WAV ({WAV_LEFT}), got {in_left:.3f}"
            )
            # bypass passes through: out == in on the left channel.
            assert abs(out_left - in_left) < 0.02, (
                f"bypass output left {out_left:.3f} should match input {in_left:.3f}"
            )
            # Stereo mapping: right channel carries the WAV's right value.
            assert abs(out_r - WAV_RIGHT) < 0.05, (
                f"output right should track WAV ({WAV_RIGHT}), got {out_r:.3f}"
            )
            print(f"  PASS  WAV input passthrough "
                  f"(in_L={in_left:.3f}, out_L={out_left:.3f}, out_R={out_r:.3f})")

            # Deactivate WAV input — runtime reverts to the sine generator.
            client.send({"type": "sine", "freq": 440, "amplitude": 0.5})
            client.send({"type": "wavFile", "path": "", "loop": False})
            time.sleep(0.1)
            # Flush buffered WAV-era frames, then sample fresh sine frames.
            sine_frames = collect_scope_frames(client, n=40)[-8:]
            sine_abs = mean_abs(sine_frames, "in")
            sine_mean = mean(sine_frames, "in")
            # A 0.5-amplitude sine has mean-abs > 0 but mean ~ 0 (oscillates),
            # unlike the constant +0.5 DC of the WAV.
            assert sine_abs > 0.05, (
                f"sine input should be non-silent after WAV deactivation, "
                f"got mean_abs={sine_abs:.3f}"
            )
            assert abs(sine_mean) < 0.2, (
                f"sine input should oscillate around 0 (not DC {WAV_LEFT}), "
                f"got mean={sine_mean:.3f}"
            )
            print(f"  PASS  reverts to sine on empty wavFile "
                  f"(mean_abs={sine_abs:.3f}, mean={sine_mean:.3f})")


def main() -> int:
    print("=== test_wav (AC-10 WAV file input) ===")
    exe = build()
    test_wav_input(exe)
    return 0


if __name__ == "__main__":
    sys.exit(main())
