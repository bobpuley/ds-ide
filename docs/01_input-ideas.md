# 01 — Input Ideas (v6)

> **v1 complete** — ds-ide 0.1.0–0.1.7 (M0–M7), all ACs green. Full v1 ideas archived in
> [`docs/v1/01_input-ideas.md`](v1/01_input-ideas.md).
>
> **v2 complete** — ds-ide 0.2.0–0.2.9 (M8–M15), all ACs green. Full v2 ideas archived in
> [`docs/v2/01_input-ideas.md`](v2/01_input-ideas.md).
>
> **v3 complete** — ds-ide 0.3.0–0.3.3 (M16–M18), all ACs green. Full v3 ideas archived in
> [`docs/v3/01_input-ideas.md`](v3/01_input-ideas.md).
>
> **v4 complete** — ds-ide 0.4.0–0.4.3 (M19–M22), all ACs green. Full v4 ideas archived in
> [`docs/v4/01_input-ideas.md`](v4/01_input-ideas.md).
>
> **v5 complete** — ds-ide 0.5.0–0.5.1 (M23–M24), all ACs green. Full v5 ideas archived in
> [`docs/v5/01_input-ideas.md`](v5/01_input-ideas.md).

## Emulator Runtime Safety & Code Quality (from `docs/06_emulator_review.md`)

Findings from a static code review of `emulator/runtime/` and `emulator/shim/`. All 16 bugs are candidates for the first v6 milestone.

### HIGH — must fix before any v6 feature work

- **RT-HEAP** `CoreAudioDevice::Impl::renderCallback` allocates two `std::vector<float>` on the heap (malloc/free) on every callback invocation in full-duplex mode; `renderCallbackOutputOnly` already avoids this correctly.
- **RT-MUTEX** `ipc_send()` acquires `g_state.send_mutex` and calls `::send()` (a syscall) from inside the CoreAudio real-time callback — blocking mutex + syscall on the RT thread = priority inversion and xruns.
- **RT-SCOPE** `ScopeState::accumulate` uses `push_back` without a size cap; with large hardware buffers (e.g. 2048 frames), the vectors grow far beyond their `reserve(512)` hint on the RT thread.
- **MALLOC-NULL** `CoreAudioDevice::start()` does not check the return value of `std::malloc` for each `AudioBufferList` channel buffer; a null return followed by `AudioUnitRender` is a null-pointer write / crash.
- **WAV-DIV0** `parse_wav` computes `total_samples = data_size / bytes_per_sample` before the `!decode` guard; `bytes_per_sample = bits / 8` is 0 for any `bits < 8` input, causing division-by-zero UB.

### MEDIUM — fix in the same milestone

- **IPC-WRITE** `send_line` and the `send_ipc` lambda ignore the return value of `::send()` — partial writes and EPIPE are silently swallowed; dead-socket not detected.
- **IPC-JSON** Custom `json_get`/`parse_kv_object` parser has no nesting-depth limit, doesn't handle `\"` in strings, and silently discards `stoi`/`stof` parse errors.
- **IPC-RANGE** `dispatch()` stores `stof(sampleRate)` and `stoul(blockSize)` into `g_state` without range validation; extreme values propagate as divide-by-zero or FP overflow through the audio engine.
- **REC-TOCTOU** `SessionRecorder`: pot/button IPC handlers check `recorder.active()` and then call `enqueuePot()`/`enqueueButton()` without holding `recorder_mutex`; `stop()` can clear `active_` and drain `pending_` in the window between the check and the enqueue — events are silently lost.
- **PLAY-LSEEK** `SessionPlayer::nextBlock` ignores the return value of `::lseek` when skipping oversized recorded blocks; on a malformed `.dsrec` file the file pointer desyncs, producing garbage audio and control replay.
- **GPIO-ALIAS** `Switch`/`Led` shims index `button_states`/`led_states` by `pin.pin` only, ignoring `pin.port`; analogue pins A6–A11 have `pin.pin = 0..5`, aliasing D0–D5 — effects using `Switch::Init(seed::A6)` read the wrong slot.
- **BUILD-SAN** `emulator/CMakeLists.txt` has no sanitizer build options (ASan, UBSan, TSan); all the RT-safety bugs above would have been caught immediately with TSan/ASan enabled during development.

### LOW — fix opportunistically

- **DTOR-STOP** `CoreAudioDevice::~CoreAudioDevice()` calls `stop()` then `delete impl_` — but `stop()` already deletes and nulls `impl_`, so the destructor's `delete` is always `delete nullptr`; misleading and fragile if `stop()` ever changes.
- **RT-LIFETIME** Work buffers in `run_simulated` are stack locals captured by reference into the CoreAudio render callback; safety depends on undocumented CoreAudio `AudioOutputUnitStop` drain guarantee — no assertion or comment.
- **WAV-UB** `decode_pcm24` uses `(p[1] << 8)` etc. where `uint8_t` is promoted to `int`; technically UB if `int` is 16-bit (not a risk on macOS/ARM64, but non-portable).
- **MACH-TB** `init_mach_timebase()` ignores the return value of `mach_timebase_info`; a `denom = 0` (impossible in practice) would produce `+inf` latency and fire xrun detection on every callback.
- **SIM-DRIFT** `run_simulated` soft loop sleeps for exactly `block_ns` after each `process_one_block()`, not accounting for execution time; WAV playback and scope timing drift proportionally to CPU load.
