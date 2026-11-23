# M95 — Real-Time Concurrency Fixes

**Version:** 0.27.4
**Status:** in progress
**Source:** 2026-11-21 C/C++ emulator code review — HIGH findings #3, #4, #2 (intake 2026-11-23)

## Goal

Remove the remaining real-time concurrency defects: a WAV buffer that can be freed while the audio thread reads it, a replay restart that races the audio thread, and engine wake-ups that can be lost so shutdown hangs and device changes apply by chance. After this milestone, each of these paths passes a TSAN stress test, shutdown always ends the process on its own, and an `audioDevice` change always takes effect.

## Sprint Tasks

### [x] fix: Close the WAV hazard-pointer window and never free on timeout (FR-RTS-6)

The audio thread loads `wav_data_ptr` and only then publishes it as in use, and the retirer deletes unconditionally after 200 ms, so swapping or clearing a WAV during playback can free memory the audio thread is reading.

**Affected files:** `emulator/runtime/audio_engine.cpp`, `emulator/runtime/ipc_server.cpp`, `emulator/runtime/emulator_state.h`, `tests/`

**DoD:**
- The audio thread loads, publishes and re-checks the pointer (`seq_cst`) until stable, and clears `wav_data_in_use` after the block
- The retirer uses a `seq_cst` exchange and waits while the old pointer is in use; after the wait budget it moves the buffer to a retire list instead of deleting it; the list is reclaimed at the next retire and at shutdown
- TSAN and ASAN stress test: WAV swap and clear in a tight loop during playback, with no race or use-after-free report
- Native suite green

---

### [ ] fix: Stop and acknowledge the replay consumer before close/open (FR-RTS-7)

`replayStart` during a running replay calls `close()`/`open()` and resets the ring indices while the audio thread may be inside `popBlock()`, which is a data race and can underflow `w - r`.

**Affected files:** `emulator/runtime/ipc_server.cpp`, `emulator/runtime/session_player.cpp`, `emulator/runtime/session_player.h`, `emulator/runtime/audio_engine.cpp`, `tests/`

**DoD:**
- The audio thread publishes `replay_in_use` around `popBlock()` with the publish-and-recheck pattern
- `replayStart` (while running) and `replayStop` set `replay_active = false` and wait for `replay_in_use == false` before any `SessionPlayer` lifecycle call
- TSAN test: two rapid `replayStart`s, and `replayStart` then `replayStop`, during playback, with no race report; the second replay starts from block 0
- Native suite green

---

### [ ] fix: Notify the audio engine under its mutex and make audioDevice bump the config generation (FR-RTS-8)

State read by the engine's wait predicates is changed without holding `mode_mutex`/`callback_mutex`, so a notification can be missed and `join()` can hang at shutdown; `audioDevice` does not bump `config_generation`, so new rates apply depending on thread timing.

**Affected files:** `emulator/runtime/ipc_server.cpp`, `emulator/runtime/main.cpp`, `emulator/runtime/audio_engine.cpp`, `emulator/runtime/emulator_state.h`, `tests/`

**DoD:**
- One `notify_engine()` helper changes `audio_mode`, `config_generation` and `shutdown` under `mode_mutex` and then notifies; every handler, the signal path and the `effect_main()` return use it; `callback_cv` changes follow the same rule
- `audioDevice` increments `config_generation`
- `shutdown_watcher` notifies under each mutex, in a loop, until an `engine_exited` flag is set
- Test: `audioMode` and `audioDevice` sent back to back, in both orders, open the device with the new sample rate and buffer size
- Stress test: start → shutdown repeated many times always exits on its own within the shutdown timeout, with no SIGKILL
- Native suite green
