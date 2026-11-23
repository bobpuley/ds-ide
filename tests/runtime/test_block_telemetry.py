"""E2E — callback block size and two-thread telemetry (FR-EMU-12, FR-EMU-13).

Builds the real effect_emu from `block_telemetry.cpp` and drives it over IPC
(with CoreAudio when an output device exists, the headless loop otherwise):

  - for block sizes 4 and 48, every audio callback receives exactly that many
    frames (the fixture reports min/max per 20 ms through MIDI CCs);
  - MIDI sent from the audio callback and from the main loop both arrive,
    each stream intact and in order (sequence numbers in note-on data bytes);
  - LEDs set from the audio callback (D23) and from the main loop (D18) both
    reach the client, lit and unlit.
"""
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "helpers"))
from build import cmake_build, REPO_ROOT
from runner import run_emulator

FIXTURE   = os.path.join(REPO_ROOT, "tests/runtime/fixtures/block_telemetry.cpp")
BUILD_DIR = os.path.join(REPO_ROOT, ".ds-ide/build/test-block-telemetry")
SOCKET    = "/tmp/daisy_emu_block_telemetry_test.sock"


def build() -> str:
    assert cmake_build(FIXTURE, BUILD_DIR), "block_telemetry build failed"
    exe = os.path.join(BUILD_DIR, "effect_emu")
    assert os.path.isfile(exe), f"effect_emu not found at {exe}"
    return exe


def collect(client, seconds: float):
    msgs = []
    deadline = time.time() + seconds
    while time.time() < deadline:
        msg = client.recv_one()
        if msg.get("type") in ("midiTx", "led"):
            msgs.append(msg)
    return msgs


def check_block(exe: str, block: int) -> None:
    with run_emulator(exe, SOCKET) as client:
        client.send({"type": "config", "sampleRate": 48000, "blockSize": block})
        client.send({"type": "sine", "freq": 440.0, "amplitude": 0.5})
        client.send({"type": "transport", "action": "start"})
        time.sleep(0.3)  # let the engine restart with the new block size
        msgs = collect(client, 1.5)

    # Block size: CC pairs (20/30 = min, 21/31 = max), reported per 20 ms.
    cc = {}
    reports = []
    for m in msgs:
        if m["type"] == "midiTx" and m["status"] == 0xB0:
            cc[m["data1"]] = m["data2"]
            if m["data1"] == 31 and all(k in cc for k in (20, 30, 21)):
                reports.append(((cc[30] << 7) | cc[20], (cc[31] << 7) | cc[21]))
                cc.clear()
    assert len(reports) >= 10, f"only {len(reports)} block-size reports received"
    bad = [r for r in reports[1:] if r != (block, block)]  # first may straddle the restart
    assert not bad, f"callback sizes other than {block}: {bad[:5]}"
    print(f"  PASS  block {block}: every callback had {block} frames ({len(reports) - 1} reports)")

    # MIDI from both threads: each stream intact and strictly increasing.
    for status, who in ((0x90, "audio callback"), (0x91, "main loop")):
        seqs = [(m["data1"] << 7) | m["data2"] for m in msgs
                if m["type"] == "midiTx" and m["status"] == status]
        assert len(seqs) >= 10, f"only {len(seqs)} MIDI messages from the {who}"
        assert all(b > a for a, b in zip(seqs, seqs[1:])), f"{who} MIDI out of order: {seqs[:20]}"
    print(f"  PASS  block {block}: MIDI from the audio callback and the main loop, each in order")

    # LEDs from both threads.
    for pin, who in ((23, "audio callback"), (18, "main loop")):
        states = {m["lit"] for m in msgs if m["type"] == "led" and m["gpioPin"] == pin}
        assert states == {True, False}, f"LED D{pin} ({who}) states seen: {states}"
    print(f"  PASS  block {block}: LEDs set from the audio callback (D23) and the main loop (D18) arrive")


def main() -> int:
    print("=== test_block_telemetry (FR-EMU-12 / FR-EMU-13) ===")
    exe = build()
    for block in (4, 48):
        check_block(exe, block)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except AssertionError as e:
        print(f"  FAIL  {e}")
        sys.exit(1)
