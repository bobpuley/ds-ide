"""Integration test — FR-EMU-11: shutdown has one authoritative, non-hanging path.

Before the fix, a detached shutdown_watcher thread called std::_Exit(0)
almost immediately (~20ms poll) after g_state.shutdown was set, racing (and
nearly always beating) the "normal" join()-based cleanup path — which was
itself dead code in the realistic signal-driven case, since effect_main()
never returns, discarding whatever ipc_queue/oled_queue/midi_queue telemetry
the non-RT drain thread hadn't sent yet.

The fix makes shutdown_watcher the single owner of termination in every case:
it wakes any thread blocked on mode_cv/callback_cv (nothing previously
notified them, even though their wait predicates already checked
g_state.shutdown), stops the recorder, joins audio_thread (whose drain thread
flushes ipc_queue/oled_queue/led_queue/midi_tx_queue/midi_rx_queue before
returning), only then unblocks ipc_server.cpp's per-client read loop (via
telemetry_drained — otherwise it raced ahead of the flush on its own ~50ms
select() timeline and closed the socket first), and finally exits.

Confirmed by manual instrumentation during development: removing the
mode_cv/callback_cv notify_all() calls reproduces exactly the regression this
test guards against — audio_thread.join() hangs forever (nothing else wakes
those waits), so the process never exits. This test asserts that hang can't
happen: shutdown completes within a bounded time after SIGTERM, with a
connected IPC client attached throughout (unlike run_emulator's teardown
helper, which closes the client before signaling — see runner.py) so the
per-client read loop's coordination with telemetry_drained is exercised too.
"""
import os
import signal
import subprocess
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "helpers"))
from build import cmake_build, REPO_ROOT
from client import EmulatorClient

BUILD_DIR = os.path.join(REPO_ROOT, ".ds-ide/build/test-shutdown-flush")
FIXTURE   = os.path.join(REPO_ROOT, "tests/runtime/fixtures/passthrough.cpp")
SOCKET    = "/tmp/daisy_emu_shutdown_flush_test.sock"

SAMPLE_RATE = 48000
BLOCK_SIZE  = 48


def test_shutdown_does_not_hang(exe: str) -> None:
    if os.path.exists(SOCKET):
        os.unlink(SOCKET)

    proc = subprocess.Popen([exe, SOCKET], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    client = None
    try:
        deadline = time.time() + 5.0
        while not os.path.exists(SOCKET):
            if time.time() > deadline:
                raise TimeoutError("effect_emu did not create socket in time")
            if proc.poll() is not None:
                raise RuntimeError(f"effect_emu exited early (rc={proc.returncode})")
            time.sleep(0.05)

        client = EmulatorClient(SOCKET, timeout=5.0)
        client.recv_type("protocolVersion")
        client.recv_one()  # initial status

        client.send({"type": "config", "sampleRate": SAMPLE_RATE, "blockSize": BLOCK_SIZE})
        client.send({"type": "sine", "freq": 440.0, "amplitude": 0.5})
        client.send({"type": "transport", "action": "start"})

        # Wait for real evidence audio is flowing — puts both audio_thread
        # (CoreAudio-driven) and its scope_queue/drain thread into their
        # normal running state before shutdown is triggered, rather than
        # racing a not-yet-started engine.
        for _ in range(400):
            if client.recv_one().get("type") == "scope":
                break
        else:
            raise AssertionError("no scope frames arrived — audio never started")

        # Signal the process directly (bypassing run_emulator's teardown
        # helper, which closes the client before signaling) so the client
        # stays connected across the shutdown sequence, exercising
        # ipc_server.cpp's telemetry_drained coordination.
        proc.send_signal(signal.SIGTERM)

        # The core regression this guards against: audio_thread.join() in
        # shutdown_watcher hangs forever if nothing wakes a blocked
        # mode_cv/callback_cv wait. A bounded wait here is a hard assertion,
        # not a soft one — this exact scenario hung indefinitely (verified
        # manually) with the mode_cv/callback_cv notify_all() calls removed.
        try:
            rc = proc.wait(timeout=5.0)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=3.0)
            raise AssertionError(
                "effect_emu did not exit within 5s of SIGTERM — shutdown sequence hung "
                "(FR-EMU-11 regression: a blocked audio thread was never woken)"
            )

        assert rc == 0, f"effect_emu exited with unexpected code {rc}"

        print(
            "  PASS  shutdown (with a connected IPC client and audio running) "
            f"completed without hanging, process terminated cleanly (rc={rc})"
        )
    finally:
        if client is not None:
            client.close()
        proc.poll()
        if proc.returncode is None:
            proc.kill()
            proc.wait(timeout=3)
        if os.path.exists(SOCKET):
            os.unlink(SOCKET)


def main() -> int:
    print("=== test_shutdown_flush (FR-EMU-11 single-owner, non-hanging shutdown) ===")
    assert cmake_build(FIXTURE, BUILD_DIR), "passthrough fixture build failed"
    exe = os.path.join(BUILD_DIR, "effect_emu")
    assert os.path.isfile(exe), f"effect_emu not found at {exe}"
    test_shutdown_does_not_hang(exe)
    return 0


if __name__ == "__main__":
    sys.exit(main())
