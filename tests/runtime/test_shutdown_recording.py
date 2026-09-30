"""Integration test — FR-EMU-8: recordings survive an IDE-initiated stop.

Before the fix, effect_main() blocks in the effect's while(1) loop and never
returns, so the emulator relied entirely on the OS's default SIGTERM action
(immediate termination) — no SessionRecorder::stop() was ever called, so an
active recording's drain thread never got to write the END marker or flush
its last blocks, and killing a joinable drain_thread_ via ~SessionRecorder()
would have called std::terminate() had that destructor path ever run.

This test starts a recording and deliberately does NOT send `recordStop` —
it lets `run_emulator`'s context-manager teardown send SIGTERM (matching
EmulatorManager.killStalePid's SIGTERM-first behavior), then verifies the
.dsrec file was still finalized with a valid END marker.
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "helpers"))
from build import cmake_build, REPO_ROOT
from runner import run_emulator

BUILD_DIR = os.path.join(REPO_ROOT, ".ds-ide/build/test-shutdown-recording")
FIXTURE   = os.path.join(REPO_ROOT, "tests/runtime/fixtures/passthrough.cpp")
SOCKET    = "/tmp/daisy_emu_shutdown_recording_test.sock"

SAMPLE_RATE = 48000
BLOCK_SIZE  = 48


def test_recording_survives_sigterm(exe: str) -> None:
    rec_file = tempfile.NamedTemporaryFile(suffix=".dsrec", delete=False)
    rec_path = rec_file.name
    rec_file.close()

    try:
        with run_emulator(exe, SOCKET) as client:
            client.send({"type": "config",
                         "sampleRate": SAMPLE_RATE, "blockSize": BLOCK_SIZE})
            client.send({"type": "sine", "freq": 440.0, "amplitude": 0.5})
            client.send({"type": "transport", "action": "start"})
            client.send({"type": "recordStart", "path": rec_path})

            # Wait for real evidence that audio blocks are actually being
            # processed (CoreAudio device startup is asynchronous and can
            # take a while) rather than guessing a fixed sleep duration —
            # a `scope` message only arrives once blocks are flowing.
            for _ in range(400):
                if client.recv_one().get("type") == "scope":
                    break
            else:
                raise AssertionError("no scope frames arrived — audio never started")

            # Exit the `with` block WITHOUT sending recordStop —
            # run_emulator's teardown sends SIGTERM (proc.terminate()),
            # exactly matching the IDE's normal stop path
            # (EmulatorManager.killStalePid).

        # The context manager has already waited for the process to exit
        # (or force-killed it after a 3s grace period) by the time we get here.
        assert os.path.isfile(rec_path), ".dsrec file not created"
        with open(rec_path, "rb") as f:
            content = f.read()

        # Structural checks that don't assume a fixed per-block frame count
        # (CoreAudio may deliver more frames per callback than requested —
        # see run_simulated's hardware-clamping comment — so recorded
        # AUDIO_BLOCK payload sizes aren't a value this test should predict).
        # What matters for FR-EMU-8 is that the file was *finalized*, not
        # abandoned mid-write: real data was recorded, and the very last byte
        # is the clean END marker (0xFF) that only drainLoop()'s normal exit
        # path writes — a process killed before stop() could finish would
        # instead end mid-block or mid-header.
        assert len(content) > 32, (
            f".dsrec file suspiciously small ({len(content)} bytes) — "
            f"no audio blocks appear to have been recorded before SIGTERM"
        )
        assert content[:6] == b"DSREC\x00", f"bad magic: {content[:6]!r}"
        assert content[6] == 0x02, f"unexpected version: {content[6]}"
        assert content[-1] == 0xFF, (
            f"file does not end with the END marker (last byte=0x{content[-1]:02x}) — "
            f"recording was not finalized cleanly on SIGTERM (FR-EMU-8 regression)"
        )

        print(
            f"  PASS  recording finalized on SIGTERM: clean END marker, "
            f"{len(content)} bytes total"
        )

    finally:
        if os.path.isfile(rec_path):
            os.unlink(rec_path)


def main() -> int:
    print("=== test_shutdown_recording (FR-EMU-8 recording survives SIGTERM) ===")
    assert cmake_build(FIXTURE, BUILD_DIR), "passthrough fixture build failed"
    exe = os.path.join(BUILD_DIR, "effect_emu")
    assert os.path.isfile(exe), f"effect_emu not found at {exe}"
    test_recording_survives_sigterm(exe)
    return 0


if __name__ == "__main__":
    sys.exit(main())
