# M38 — Emulator Correctness & Robustness

**Version:** 0.13.0
**Status:** planned
**Source:** 2026-07-02 C/C++ emulator code review — MEDIUM findings

> Sequencing note: this milestone should land after M36 (v11) — both touch `SessionPlayer::nextBlock()`, and M36 restructures the replay read path that this milestone's stale-sample fix builds on. See `02_assumptions-and-risks.md`.

## Goal

Close the correctness and robustness gaps below HIGH severity: stale samples in short replay blocks, an unbounded scope-message growth path, silently swallowed CoreAudio and disk-write errors, unbounded WAV pre-allocation, fragile hand-rolled JSON, stale audio configuration, and a shutdown path that can lose recording data or abort. After M38, replay is bit-for-bit deterministic, oversized IPC messages cannot silently reintroduce RT heap allocation, and failures (CoreAudio, disk, malformed WAV) are surfaced instead of swallowed.

## Sprint Tasks

### [ ] fix: Zero-fill short replay block tails; flag rate mismatches (FR-EMU-1)

`SessionPlayer::nextBlock()` reads `min(frames, block_size_)` but never clears the tail when the recorded block is smaller than the engine's current block size — stale samples from a previous block leak into replay, making "deterministic replay" nondeterministic.

**Affected files:** `emulator/runtime/session_player.cpp`, `emulator/runtime/audio_engine.cpp`

**DoD:**
- After a short read, `nextBlock()` zero-fills `buf + to_read*2 .. frames*2`
- A `replay_rate_mismatch` IPC event is emitted when the header's `block_size`/`sample_rate` differ from the engine's current config
- Replaying a `.dsrec` recorded at a smaller block size than the current engine block size produces identical output across two separate replay runs

---

### [ ] fix: Derive scope/spectrum message budget from `MAX_MSG` (FR-EMU-2)

Scope message size scales with the actual hardware frame count and can reach ~900 kB at 4096 frames/block — 30× `SpscIpcQueue::MAX_MSG` — silently re-enabling RT heap allocation via `slots_[w].msg.assign(m)`.

**Affected files:** `emulator/runtime/emulator_state.h`, `emulator/runtime/audio_engine.cpp`

**DoD:**
- The scope sample budget is computed from `MAX_MSG` (decimating more aggressively at larger hardware frame sizes) rather than sized independently
- `push()` truncates and counts as a drop any message that would still exceed `MAX_MSG`
- A debug assert (`msg.size() <= MAX_MSG`) is added to `push()` and does not fire across a 5-minute soak test spanning buffer sizes 64–4096

---

### [ ] fix: Check CoreAudio `OSStatus` returns; surface setup and render failures (FR-EMU-3)

Nearly every CoreAudio setup call's return value is discarded, including `AudioUnitRender` itself; the input format is only queried, never reconciled against the engine's sample rate.

**Affected files:** `emulator/runtime/core_audio_device.cpp`

**DoD:**
- Every `OSStatus` from setup calls (`EnableIO`, format set, device selection, buffer-size set) is checked; failure calls `stop()` and returns `false`
- `AudioUnitRender` failures increment an atomic error counter drained and surfaced as an IPC event alongside xrun reporting
- The queried input `mSampleRate` is compared against the engine's configured rate; a mismatch emits a `sample_rate_mismatch` IPC event

---

### [ ] fix: Report recorder write failures instead of silently truncating (FR-EMU-4)

`writeBytes()` failures in `flushPending`/`drainLoop` are discarded — on ENOSPC/EIO the drain loop keeps "writing," producing a silently truncated `.dsrec`.

**Affected files:** `emulator/runtime/session_recorder.cpp`, `emulator/runtime/ipc_server.cpp`

**DoD:**
- Any `writeBytes` failure sets an atomic `write_error_` flag and stops draining (closing the fd)
- A `record_error` IPC event is pushed on failure
- `recordStop` reports final status (block count / error) over IPC
- Simulating ENOSPC mid-recording produces a `record_error` event, not a silent truncated file

---

### [ ] fix: Validate WAV file magic and enforce a size ceiling before buffering (FR-EMU-5)

`load_wav_file` allocates and reads the entire file before checking the RIFF magic or the sample cap; `fseek`/`ftell` returns are unchecked.

**Affected files:** `emulator/runtime/wav_reader.cpp`

**DoD:**
- The first 12 bytes are validated (`RIFF`/`WAVE`) before any full-file buffering occurs
- A hard file-size ceiling (e.g. 256 MB) is enforced with checked `fseek`/`ftell`/`fstat`
- Selecting a non-WAV multi-GB file produces an immediate, bounded-memory error

---

### [ ] fix: Harden hand-rolled JSON key lookup and output escaping (FR-EMU-6)

`json_get` matches keys via substring search, including inside string values; outbound JSON splices `e.what()` unescaped, producing malformed JSON on quote/backslash content.

**Affected files:** `emulator/runtime/ipc_server.cpp`

**DoD:**
- Key lookup does not match a key literal that appears inside a string value
- All interpolated output values pass through a `json_escape()` helper
- A `wavFile` path containing a literal `"type":` substring parses correctly; exception text containing quotes produces valid outbound JSON

---

### [ ] fix: Re-read audio configuration each engine loop iteration (FR-EMU-7)

`sample_rate`/`block_size` are captured once at engine start; subsequent `config`/`audioDevice` IPC updates change reported status but not actual engine behavior.

**Affected files:** `emulator/runtime/audio_engine.cpp`, `emulator/runtime/ipc_server.cpp`

**DoD:**
- `sample_rate`/`block_size` are re-loaded from `g_state` at the top of each outer engine loop iteration
- The `config` handler notifies `mode_cv` (matching `audioDevice`'s existing behavior) so the active mode restarts with fresh values
- Sending a `config` message with a new sample rate mid-session changes WAV playback rate and FFT bin labeling within one loop iteration; `status` replies always match actual behavior

---

### [ ] fix: Ensure recordings survive clean and IDE-initiated process shutdown (FR-EMU-8)

No `SessionRecorder::stop()` is called on clean exit (destroying a joinable `drain_thread_` aborts via `std::terminate`); there is no SIGINT/SIGTERM handler, so the common IDE-initiated kill always drops the recording's `END` marker plus un-drained blocks.

**Affected files:** `emulator/runtime/main.cpp`, `emulator/runtime/session_recorder.cpp`, `emulator/runtime/session_recorder.h`

**DoD:**
- `SessionRecorder` has a destructor that calls `stop()`
- `main` calls `g_state.recorder.stop()` after `effect_main()` returns
- SIGTERM/SIGINT handlers set `g_state.shutdown` via an async-signal-safe atomic store
- Killing the emulator via the IDE's normal stop path while recording produces a `.dsrec` with a valid `END` marker and no un-drained trailing blocks
