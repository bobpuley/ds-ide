# M25 — Emulator Runtime Safety & Code Quality

**Status:** released  
**Semver target:** 0.6.0  
**Requirements:** FR-QS-1 – FR-QS-15 (AC-38 – AC-54)  
**Source:** `docs/06_emulator_review.md`

---

## Sprint tasks

### HIGH — blocking correctness issues

- [x] **fix: pre-allocate render callback buffers** — promote `in_interleaved` / `out_interleaved` in `CoreAudioDevice::Impl::renderCallback` to `Impl` member vectors; pre-size in `start()`; no heap alloc on the RT thread. DoD: AC-38 green; no `malloc` call inside `renderCallback` under Instruments allocations trace.
- [x] **fix: move IPC sends off RT thread via SPSC queue** — replace direct `ipc_send()` calls from the audio callback with a lock-free SPSC queue (boost-free, e.g. `std::array`-backed ring); add a dedicated drain thread that reads the queue and calls `::send()`. DoD: AC-39 green; TSan clean on a dual-core load test.
- [x] **fix: cap ScopeState accumulate vector growth** — enforce a hard maximum on `in`/`out`/`out_r` size inside `accumulate`; no `push_back` beyond the cap; reset if exceeded. DoD: AC-40 green; no heap reallocation on RT thread for any `frames` value up to 4096.
- [x] **fix: check malloc return in CoreAudioDevice::start()** — validate each `mBuffers[ch].mData = std::malloc(...)` result; on null, set `mNumberBuffers` to successfully-allocated count, call `stop()`, return false. DoD: AC-41 green; injected-failure test does not crash.
- [x] **fix: WAV parser div-by-zero guard** — move `bytes_per_sample == 0` check before `total_samples` division; return error immediately. DoD: AC-42 green; a WAV with `bits = 0` returns false with an error string, no UB.

### MEDIUM — reliability and correctness

- [x] **fix: handle ::send() errors in send_line / send_ipc** — check return value; on `<= 0` or EPIPE close the client fd and clear `send_ipc`. DoD: AC-45 green; IPC server detects client disconnect within one send cycle.
- [x] **fix: harden json_get / parse_kv_object** — add nesting-depth limit (e.g. 8); handle `\"` in string scanner; log warning on `stof`/`stoi` failure instead of silent drop. DoD: AC-44 green; pathological 1000-deep input is rejected; escaped-quote path test passes.
- [x] **fix: range-validate IPC sampleRate and blockSize** — reject `sampleRate` outside `[100, 384000]` and `blockSize` outside `[1, 65536]`; emit IPC error event on rejection. DoD: AC-43 green; out-of-range values do not reach `g_state`; error event received by extension test harness.
- [x] **fix: close SessionRecorder TOCTOU** — hold `recorder_mutex` when checking `active()` before `enqueuePot()`/`enqueueButton()` in `dispatch()`. DoD: AC-46 green; TSan clean on concurrent stop+enqueue stress test.
- [x] **fix: check lseek return in SessionPlayer::nextBlock** — return false and set `done_ = true` on `lseek` error; add `block_size_ > 65536` guard in `open()`. DoD: AC-47 green; malformed `.dsrec` with large `block_size` returns false rather than producing garbage audio.
- [x] **fix: correct GPIO pin aliasing in Switch/Led shims** — derive state-array index from a composite of `pin.port` and `pin.pin` (or a canonical mapping matching libDaisy hardware numbering) so A6–A11 do not alias D0–D5. DoD: AC-48 green; `Switch::Init(seed::A6)` reads a distinct slot from `Switch::Init(seed::D0)`.
- [x] **fix: add sanitizer CMake options** — expose `ASAN` (AddressSanitizer + UBSanitizer) and `TSAN` (ThreadSanitizer) options in `emulator/CMakeLists.txt`; document mutual exclusivity. DoD: AC-49 green; `cmake -DASAN=ON` builds and runs clean; `cmake -DTSAN=ON` builds and runs clean.

### LOW — opportunistic quality

- [x] **fix: remove redundant delete impl_ from CoreAudioDevice destructor** — leave only `stop();` in the destructor body. DoD: AC-50 green; no double-delete path.
- [x] **fix: document or eliminate RT buffer lifetime dependency** — add inline comment in `CoreAudioDevice::stop()` documenting that `AudioOutputUnitStop` drains callbacks before returning, making the reference-capture lifetime safe; or promote buffers out of stack scope. DoD: AC-51 green.
- [x] **fix: cast bytes to uint32_t before shifting in wav_reader helpers** — update `decode_pcm24`, `rd_u16`, `rd_u32`. DoD: AC-52 green; UBSan clean on WAV decode path.
- [x] **fix: check mach_timebase_info return value** — fall back to `1.0` on `KERN_FAILURE` or `denom == 0`. DoD: AC-53 green.
- [x] **fix: account for execution time in run_simulated loop** — sleep for `max(0, block_ns - elapsed)` instead of fixed `block_ns`. DoD: AC-54 green; WAV playback rate matches wall clock within 5% under sustained CPU load.
