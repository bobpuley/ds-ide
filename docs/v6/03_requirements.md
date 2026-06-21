# 03 — Requirements (v6)

> **v4 complete** — all v4 requirements (FR-CE-1…FR-CE-8, FR-WE-1…FR-WE-10, FR-CM-1…FR-CM-4,
> FR-SC-1…FR-SC-2) implemented; ACs AC-24…AC-35 green.
> Archived: [`docs/v4/03_requirements.md`](v4/03_requirements.md).
>
> **v5 complete** — all v5 requirements (FR-WZ-1, FR-CG-1) implemented; ACs AC-36…AC-37 green.
> Archived: [`docs/v5/03_requirements.md`](v5/03_requirements.md).

## FR-QS — Emulator Runtime Safety & Code Quality (M25)

Requirements surfaced by the emulator code review (`docs/06_emulator_review.md`). All were implicit in prior versions; stated here so they can be verified.

### Real-time thread safety

**FR-QS-1** — The CoreAudio render callback must not perform heap allocation, blocking syscall, or mutex acquisition on the real-time thread.
- **AC-38** `renderCallback` (full-duplex) reuses pre-allocated member buffers — no `malloc`/`free` per invocation. (RT-HEAP)
- **AC-39** Scope/spectrum/xrun IPC messages from the audio callback are posted via a lock-free SPSC queue; the mutex and `::send()` are moved to a dedicated drain thread. (RT-MUTEX)
- **AC-40** `ScopeState::accumulate` enforces a hard cap on vector growth; no heap reallocation occurs on the RT thread for any hardware buffer size. (RT-SCOPE)

### Memory and allocation safety

**FR-QS-2** — Allocation failures must not produce null-pointer writes or silent misbehaviour.
- **AC-41** `CoreAudioDevice::start()` checks each `malloc` return for channel audio buffers; on null, calls `stop()` and returns false before calling `AudioUnitRender`. (MALLOC-NULL)

### Input validation and parsing robustness

**FR-QS-3** — WAV parsing must validate `bits` and `bytes_per_sample` before any arithmetic that divides by them.
- **AC-42** `parse_wav` checks `bytes_per_sample == 0` and returns an error before computing `total_samples`. (WAV-DIV0)

**FR-QS-4** — IPC numeric configuration values must be range-validated before storage.
- **AC-43** `sampleRate` is rejected outside `[100, 384000]` Hz; `blockSize` is rejected outside `[1, 65536]`; an IPC error event is emitted on rejection. (IPC-RANGE)

**FR-QS-5** — IPC message parsing must handle malformed input without silent failures.
- **AC-44** JSON parser enforces a nesting-depth limit; handles `\"` in string values; logs a warning (to stderr or IPC error channel) when `stof`/`stoi` fails. (IPC-JSON)

### IPC reliability

**FR-QS-6** — IPC write operations must detect send failures and trigger client disconnection.
- **AC-45** `send_line` and the `send_ipc` lambda check `::send()` return; on `<= 0` or EPIPE the client fd is closed and `send_ipc` is cleared. (IPC-WRITE)

### Session correctness

**FR-QS-7** — Session stop must be atomic with respect to concurrent pot/button enqueue operations.
- **AC-46** `recorder_mutex` is held when checking `active()` before calling `enqueuePot()`/`enqueueButton()` in `dispatch()`, eliminating the TOCTOU window. (REC-TOCTOU)

**FR-QS-8** — Session playback must validate `lseek` return values and handle malformed `.dsrec` files gracefully.
- **AC-47** `nextBlock` checks the `::lseek` return; on error sets `done_ = true` and returns false. `open()` rejects `block_size_ > 65536`. (PLAY-LSEEK)

### Hardware emulation fidelity

**FR-QS-9** — GPIO pin-to-index mapping must not alias analogue and digital pin namespaces.
- **AC-48** `Switch` and `Led` shims derive their state-array index from a composite of `pin.port + pin.pin` (or an equivalent canonical mapping function) so that A6–A11 do not alias D0–D5. (GPIO-ALIAS)

### Build quality

**FR-QS-10** — The emulator build must offer opt-in sanitizer configurations.
- **AC-49** `emulator/CMakeLists.txt` exposes `ASAN` (AddressSanitizer + UBSanitizer) and `TSAN` (ThreadSanitizer) CMake options; the two are mutually exclusive and documented as such. (BUILD-SAN)

### Low-severity quality (fix opportunistically in M25)

**FR-QS-11** — `CoreAudioDevice` destructor must not perform redundant cleanup.
- **AC-50** Destructor body contains only `stop();`; the redundant `delete impl_` is removed. (DTOR-STOP)

**FR-QS-12** — Work buffer lifetimes in simulated mode must be safe and documented.
- **AC-51** Either the CoreAudio drain guarantee on `AudioOutputUnitStop` is documented inline, or buffers are moved out of stack scope. (RT-LIFETIME)

**FR-QS-13** — WAV decode helpers must not rely on integer-promotion behaviour for bit-shifting.
- **AC-52** `decode_pcm24`, `rd_u16`, and `rd_u32` cast bytes to `uint32_t` before shifting. (WAV-UB)

**FR-QS-14** — `mach_timebase_info` return value must be checked.
- **AC-53** `init_mach_timebase()` checks the `kern_return_t` and falls back to `1.0` on failure or `denom == 0`. (MACH-TB)

**FR-QS-15** — Simulated-mode loop timing must account for `process_one_block()` execution time.
- **AC-54** `run_simulated` subtracts elapsed execution time from the sleep duration; minimum sleep is clamped to zero. (SIM-DRIFT)
