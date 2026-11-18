# M79 — Audio Backend Abstraction

**Version:** 0.25.0-win.3
**Status:** released
**Source:** intake session, 2026-10-04 (`multiplatform_plan.md`; 01_input-ideas.md). Branch `feat/m79-audio-backend-abstraction` is created from `feat/windows-support` and merged back into `feat/windows-support` at close (never `main`) — FR-WIN-GIT-1

## Goal

Real-time audio is welded to CoreAudio, allocates on the audio thread in two places, and has no automated test on its real-time path. After this milestone a fake backend and tests cover the real-time path first, then an `AudioDevice` interface with a factory replaces direct use of `CoreAudioDevice`, the RT-thread allocations are gone, timing uses `std::chrono::steady_clock`, and macOS behaves exactly as before.

## Sprint Tasks

### [x] test: fake AudioDevice and real-time path regression tests (FR-WIN-AUD-4)

No test exercises real-time mode, xruns, latency events, render errors, `sample_rate_mismatch`, the `realtime_unavailable` fallback, `rt_buffer_size` or mute-on-breakpoint mode switching end to end. These tests are written against the current macOS code before any refactor.

**Affected files:** `emulator/runtime/audio_engine.cpp`, `tests/audio-engine/test_realtime_path.cpp`, `tests/audio-engine/run_tests.sh`, `emulator/CMakeLists.txt`

**DoD:**
- a test seam lets the engine run against a deterministic fake that drives the callback with chosen frame counts
- tests assert xrun counts, latency event emission, render-error events, `sample_rate_mismatch`, fallback to simulated mode on `start()` failure, and `audioDevice` buffer/rate handling
- the tests pass on the unmodified macOS implementation first, then keep passing through the rest of this milestone
- the existing macOS suites (TypeScript unit tests, emulator C++ test runners, `tests/build-flags`, runtime/functional tests) pass unchanged (FR-WIN-GIT-2)

---

### [x] refactor: extract AudioDevice interface and factory (FR-WIN-AUD-1)

`audio_engine.cpp` is the sole consumer of `CoreAudioDevice`, through a small public surface.

**Affected files:** `emulator/runtime/audio_device.h`, `emulator/runtime/audio_device_factory.cpp`, `emulator/runtime/core_audio_device.h`, `emulator/runtime/core_audio_device.cpp`, `emulator/runtime/audio_engine.cpp`, `emulator/CMakeLists.txt`, `tests/core-audio-device/test_core_audio_device.cpp`, `tests/core-audio-device/run_tests.sh`, `tests/build-flags/check_compile_flags.py`

**DoD:**
- an abstract, non-copyable, non-movable `AudioDevice` declares the current methods plus a maximum-callback-size query; `ProcessFn` stays stereo-interleaved
- `#ifdef` appears only in the factory; the existing non-Apple stub remains the fallback backend
- `audio_engine.cpp` changes only by type name and the factory call
- the contract test (non-copyable, defaults before start, idempotent `stop`) is made backend-agnostic and passes for the macOS backend and the fake
- macOS audio behaviour is unchanged, verified by the M79 real-time tests and the existing macOS suites (TypeScript unit tests, emulator C++ test runners, `tests/build-flags`, runtime/functional tests) pass unchanged (FR-WIN-GIT-2)

---

### [x] fix: remove allocations from the real-time callbacks (FR-WIN-AUD-2)

Both render callbacks in `core_audio_device.cpp` (`silentInput.assign`, `workOut.resize`) and the `run_realtime()` `processBlock` lambda in `audio_engine.cpp` (`in_buf`/`out_buf`/`local_*` `resize`) allocate on the real-time thread.

**Affected files:** `emulator/runtime/core_audio_device.cpp`, `emulator/runtime/audio_engine.cpp`, `emulator/runtime/audio_device.h`

**DoD:**
- work buffers are sized up front from the backend's maximum callback size
- a callback larger than expected is clamped and its tail zero-filled; no `resize`/`assign`/heap allocation remains on the RT thread (verified by inspection and a test that feeds an oversized callback)
- the existing macOS suites (TypeScript unit tests, emulator C++ test runners, `tests/build-flags`, runtime/functional tests) pass unchanged (FR-WIN-GIT-2)

---

### [x] refactor: replace Mach timing with steady_clock (FR-WIN-AUD-3)

`mach_absolute_time()` and `compute_mach_ns_per_tick()` are used only for xrun detection and exist only in `core_audio_device.cpp`.

**Affected files:** `emulator/runtime/core_audio_device.cpp`

**DoD:**
- the four timing calls and the tick conversion are replaced by `std::chrono::steady_clock` with no change to the xrun definition (processBlock time > buffer duration)
- driver-level overflow/underflow reporting is defined as a separate counter in the interface, documented, and zero on the macOS backend
- the existing macOS suites (TypeScript unit tests, emulator C++ test runners, `tests/build-flags`, runtime/functional tests) pass unchanged (FR-WIN-GIT-2)
