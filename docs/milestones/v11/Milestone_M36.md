# M36 — Emulator RT & Memory Safety Critical Fixes

**Version:** 0.12.0
**Status:** planned
**Source:** 2026-07-02 C/C++ emulator code review — HIGH findings

## Goal

Eliminate every real-time-thread safety and memory-safety violation identified in the review: heap overflow and use-after-free risk in the CoreAudio callback path, blocking I/O and unsynchronized state in the replay/recording paths, and a duplicate-`recordStart` crash. After M36, the audio thread never writes past an allocated buffer, never touches a buffer that's concurrently being resized, never blocks on I/O or a mutex, and a malformed IPC sequence cannot abort the process.

## Sprint Tasks

### [ ] fix: Size `inputBufList` for the maximum deliverable frame count (FR-RTS-1)

`CoreAudioDevice::start()` allocates `inputBufList` for exactly `bufferSize` frames, but CoreAudio's `inNumberFrames` can exceed `bufferSize` under hardware minimum clamping. The render callback's `memset`/`AudioUnitRender` then write past the `malloc`'d buffer.

**Affected files:** `emulator/runtime/core_audio_device.cpp`

**DoD:**
- `inputBufList` is sized from the queried maximum frame count (`kAudioDevicePropertyBufferFrameSizeRange` or similar), not the requested `bufferSize`
- The render callback clamps writes to the allocated size if `inNumberFrames` still exceeds it
- Setting `bufferSize=1` via the `audioDevice` IPC message on hardware that clamps to a larger minimum produces no ASAN heap-overflow report

---

### [ ] fix: Size RT-callback buffers before starting the audio unit, not after (FR-RTS-2)

`start()`/`start_output_only()` call `AudioOutputUnitStart()` and only afterward resize `in_interleaved`, `out_interleaved`, `silentInput`, `workOut` — buffers the RT callback may already be concurrently reading/writing.

**Affected files:** `emulator/runtime/core_audio_device.cpp`

**DoD:**
- All callback-visible buffers are queried and sized before `AudioOutputUnitStart()` is called
- If a post-start correction is ever needed, the unit is stopped, resized, and restarted — no buffer is mutated while the unit is running
- TSAN reports no data race across 100 scripted start/stop cycles

---

### [ ] fix: Move replay audio off the RT thread onto a lock-free SPSC ring (FR-RTS-3)

In simulated mode with an output device, `process_one_block` runs inside the CoreAudio callback and calls `SessionPlayer::nextBlock()`, which performs blocking `::read()`/`::lseek()`, heap-allocates a per-block `std::vector<ReplayEvent>`, and can free a multi-MB `WavData` on the RT thread via a `wav_mutex`-guarded `shared_ptr` copy. The IPC thread also holds `player_mutex` across a full-file `countBlocks()` scan.

**Affected files:** `emulator/runtime/audio_engine.cpp`, `emulator/runtime/session_player.cpp`, `emulator/runtime/ipc_server.cpp`

**DoD:**
- A reader thread performs all `::read()`/`::lseek()` and event parsing; the RT thread only pops pre-decoded blocks from a pre-filled SPSC ring via atomics
- `wav_mutex` + `shared_ptr` copy on the RT thread is replaced with an atomic pointer swap; the IPC thread retires old `WavData` only after the engine's generation counter confirms it has moved on
- Work buffers are pre-sized to the device's actual maximum frame count before the device starts
- Starting a replay while audio is actively rendering produces no xrun on a normally loaded system
- `ca_process` contains no `::read()`, `::lseek()`, mutex lock, or heap allocation

---

### [ ] fix: Fix `SessionRecorder::enqueueBlock()` memory-ordering and pre-allocate slots (FR-RTS-4)

`enqueueBlock()` (RT thread, unlocked) loads `active_` with `memory_order_relaxed`, which does not synchronize with `start()`'s `memory_order_release` store — on Apple Silicon's weak memory model the RT thread can observe `active_ == true` before observing initialized ring-buffer slots. `stop()` can also complete mid-`enqueueBlock`, silently dropping or misfiling blocks.

**Affected files:** `emulator/runtime/session_recorder.cpp`, `emulator/runtime/session_recorder.h`, `emulator/runtime/audio_engine.cpp`

**DoD:**
- `enqueueBlock()` loads `active_` with `memory_order_acquire`, pairing correctly with `start()`'s release store
- `audio_slots_` and per-slot buffers are allocated once in the constructor; `start()` never resizes them
- A generation counter or `in_use` flag closes the stop/start overlap window so no block is silently dropped or misfiled at a session boundary
- TSAN reports no data race on `SessionRecorder` state across 100 rapid start/stop cycles

---

### [ ] fix: Reject re-entrant `recordStart` instead of crashing (FR-RTS-5)

`SessionRecorder::start()` has no guard against being called while already active — a duplicate `recordStart` IPC message assigns to a still-joinable `drain_thread_`, calling `std::terminate()` and aborting the emulator. The old fd also leaks and the old drain thread corrupts the new file's header before the abort.

**Affected files:** `emulator/runtime/session_recorder.cpp`, `emulator/runtime/ipc_server.cpp`

**DoD:**
- `start()` returns `false` immediately if already active, and the IPC handler replies with a `record_error` event instead of proceeding
- `drain_thread_` is joined (`if (drain_thread_.joinable()) drain_thread_.join();`) as defense-in-depth before any future assignment
- Sending two `recordStart` messages back-to-back does not call `std::terminate`; the first recording continues uncorrupted
