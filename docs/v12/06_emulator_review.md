# Review Report

Static review of `emulator/` (runtime + libDaisy shim + build config), 2026-07-02.
Scope: memory safety, undefined behavior, concurrency, emulator correctness, API design, error handling, performance, build/maintainability.
Previous review: [`docs/v10/06_emulator_review.md`](v10/06_emulator_review.md) (archived).

---

## Heap buffer overflow in duplex render callback when hardware delivers more frames than requested

### Description
In duplex mode, `CoreAudioDevice::start()` allocates the AUHAL input buffer list with exactly `bufferSize` frames per channel. The render callback, however, sizes and fills those buffers using `inNumberFrames`, which is chosen by CoreAudio and can exceed the requested `bufferSize` (the codebase itself acknowledges this elsewhere: "CoreAudio may deliver more frames than we requested (hardware minimum clamping)"). The interleaved work buffers are grown defensively, but `inputBufList` is never re-sized.

### Evidence
`core_audio_device.cpp`:
- Allocation (start, lines 270–284): `size_t dataBytes = bufferSize * sizeof(float);` … `std::malloc(dataBytes)` per channel.
- Callback (lines 57–67):
  ```cpp
  self->inputBufList->mBuffers[b].mDataByteSize =
      static_cast<UInt32>(inNumberFrames * sizeof(float));
  std::memset(self->inputBufList->mBuffers[b].mData, 0,
              inNumberFrames * sizeof(float));
  ...
  AudioUnitRender(self->unit, ioActionFlags, inTimeStamp, 1, inNumberFrames, self->inputBufList);
  ```
  If `inNumberFrames > bufferSize`, both the `memset` and `AudioUnitRender`'s write into the buffers run past the `malloc`'d size.
- The IPC `audioDevice` handler accepts `bufferSize` as low as 1 (`ipc_server.cpp:241–247`), while real devices commonly clamp to a larger minimum frame count — making the overflow trivially reachable (request 1, hardware delivers 512).

### Impact
Heap corruption on the real-time audio thread: crashes, silent memory corruption of adjacent allocations, and undebuggable audio artifacts. Directly user-triggerable via a small `bufferSize` IPC config.

### Affected Files
- emulator/runtime/core_audio_device.cpp

### Recommended Fix
After starting the unit, query `kAudioDevicePropertyBufferFrameSize` (or better, `kAudioDevicePropertyBufferFrameSizeRange`) on the *input* device and allocate `inputBufList` for the maximum possible frame count. In the callback, clamp: if `inNumberFrames * sizeof(float)` exceeds the allocated size, process only the allocated portion (or output silence) instead of writing past the buffer.

### Urgency Level
HIGH

---

## Data race / use-after-free: render work buffers reallocated after the audio unit has started

### Description
Both `start()` and `start_output_only()` call `AudioOutputUnitStart()` and *then* re-size the buffers the render callback uses (`in_interleaved`/`out_interleaved`, `silentInput`/`workOut`). Once `AudioOutputUnitStart` returns, the RT callback can already be running concurrently on the CoreAudio thread; `std::vector::assign`/`resize` on the control thread can reallocate the backing store while the callback is reading/writing it.

### Evidence
`core_audio_device.cpp`:
- `start()`: `AudioOutputUnitStart(impl_->unit)` at line 298; then lines 300–320 do `impl_->in_interleaved.assign(n * 2, 0.f); impl_->out_interleaved.assign(n * 2, 0.f);`.
- `start_output_only()`: start at line 396; then lines 398–417 do `impl_->silentInput.assign(n * 2, 0.f); impl_->workOut.resize(n * 2, 0.f);`.
- The callbacks dereference these vectors' data pointers on every render (`renderCallback` lines 71–101, `renderCallbackOutputOnly` lines 139–168).

### Impact
Use-after-free / torn pointer reads on the RT thread. This is a classic intermittent crash: it only fires if a render callback lands in the resize window, so it passes most test runs and crashes rarely in the field. Also a formal data race (UB) even when sizes match, since `assign` writes elements the callback may concurrently read.

### Affected Files
- emulator/runtime/core_audio_device.cpp

### Recommended Fix
Query the actual hardware frame size and size all callback buffers *before* `AudioOutputUnitStart()` (the device buffer size is readable after `AudioUnitInitialize`). If a post-start correction is unavoidable, stop the unit, resize, and restart — never mutate callback-visible vectors while the unit is running.

### Urgency Level
HIGH

---

## Blocking file I/O, mutexes, and heap allocation inside the CoreAudio render callback (simulated mode)

### Description
In simulated mode with an output device available, `process_one_block` runs inside the CoreAudio render callback (via `ca_process`). That path acquires `g_state.player_mutex` and `g_state.wav_mutex`, constructs a `std::vector<ReplayEvent>` per block, may `resize()` six work vectors, and — worst — calls `SessionPlayer::nextBlock()`, which performs blocking `::read()` and `::lseek()` syscalls on the recording file. Meanwhile the IPC thread can hold `player_mutex` for a long time: the `replayStart` handler calls `player.open()`, whose `countBlocks()` scans the *entire* file under that same mutex.

### Evidence
- `audio_engine.cpp:283–389` — `process_one_block` (runs on the RT thread via `ca_process`, lines 395–405; device started at 412–415):
  - line 302: `std::vector<ReplayEvent> events;` — heap allocation per block;
  - lines 305–307: `lock_guard(player_mutex)` + `player.nextBlock(...)` → `::read()` on the RT thread (`session_player.cpp:8–17, 78–123`);
  - lines 324–327: `lock_guard(wav_mutex)` + `shared_ptr` copy — when the IPC thread swaps in a new file, the *old* multi-MB `WavData` can be freed on the RT thread when the local `shared_ptr` drops the last reference;
  - lines 291–298: on-the-fly `resize()` of all six work buffers.
- `ipc_server.cpp:273–277` — IPC thread holds `player_mutex` across `player.open()`, which includes the full-file `countBlocks()` scan (`session_player.cpp:19–39`).

### Impact
Priority inversion and unbounded stalls in the audio render callback: audible glitches/xruns at best; multi-hundred-millisecond dropouts when a replay start coincides with rendering (RT thread blocks on a mutex held during a whole-file scan). Violates the project's own FR-RTS rules that all I/O stays off the RT thread.

### Affected Files
- emulator/runtime/audio_engine.cpp
- emulator/runtime/session_player.cpp
- emulator/runtime/ipc_server.cpp

### Recommended Fix
Feed replay audio through a pre-filled lock-free SPSC ring (mirror of `SessionRecorder`): a reader thread does the `::read()`s and event parsing; the RT path only pops pre-decoded blocks with atomics. Replace `wav_mutex` + `shared_ptr` copy with an atomic pointer swap where the IPC thread retires old `WavData` after the engine confirms it moved on (generation counter already exists). Pre-size work buffers to the device's actual maximum frame count before starting the device; reuse a preallocated `events` buffer.

### Urgency Level
HIGH

---

## SessionRecorder: RT enqueueBlock() is not synchronized with start()/stop()

### Description
The audio thread calls `g_state.recorder.enqueueBlock()` on every block without holding `recorder_mutex`, while the IPC thread mutates recorder internals (`audio_slots_` resize, `fd_`, indices) inside `start()`/`stop()` under that mutex. The only guard is `active_`, but `enqueueBlock()` loads it with `memory_order_relaxed`, which does **not** synchronize with the `memory_order_release` store at the end of `start()`. On a weakly-ordered target (Apple Silicon — the project's primary platform), the RT thread can observe `active_ == true` before observing the initialized ring-buffer slots, then `memcpy` through a stale vector data pointer.

### Evidence
- `audio_engine.cpp:350`: `g_state.recorder.enqueueBlock(in_buf.data(), frames);` — no lock (intentionally, for RT safety).
- `session_recorder.cpp:73–74`:
  ```cpp
  if (!active_.load(std::memory_order_relaxed)) return false;
  ```
  vs `session_recorder.cpp:57`: `active_.store(true, std::memory_order_release);` — release with no matching acquire.
- `session_recorder.cpp:33–36`: `audio_slots_.resize(kAudioSlotCount); … slot.resize(kMaxFramesPerSlot * 2);` happen immediately before the `active_` store; these writes are exactly what the relaxed load fails to order.
- Additionally, `stop()` (lines 144–150) can complete while the RT thread is mid-`enqueueBlock` (nothing is re-checked after the initial `active_` load); that block is silently lost, and a subsequent `start()` resets indices while a stale write may still be in flight.

### Impact
Undefined behavior (C++ data race) and a real reordering hazard on ARM: memcpy into an unpublished buffer → crash or corrupted first recording blocks. The stop/start overlap can also drop or misfile blocks at session boundaries.

### Affected Files
- emulator/runtime/session_recorder.cpp
- emulator/runtime/session_recorder.h
- emulator/runtime/audio_engine.cpp

### Recommended Fix
Load `active_` with `memory_order_acquire` in `enqueueBlock()` (pairs with the release store in `start()`). Allocate the fixed-size slot vectors once in the constructor so `start()` never reallocates. Close the stop/start overlap with a generation counter or an `in_use` flag the RT thread holds around the enqueue and `stop()` waits on.

### Urgency Level
HIGH

---

## recordStart while already recording calls std::terminate (assignment to a joinable std::thread)

### Description
`SessionRecorder::start()` does not check whether a recording is already active. A second `recordStart` IPC message (client bug, retry, or two IDE commands racing) re-opens the file, resets indices while the drain thread is running, and finally executes `drain_thread_ = std::thread(...)` — assigning to a still-joinable `std::thread`, which is specified to call `std::terminate()`. The whole emulator process aborts.

### Evidence
- `ipc_server.cpp:255–263` — the `recordStart` handler calls `g_state.recorder.start(path, sr, bs)` unconditionally (`recorder_mutex` serializes IPC callers but does not prevent re-entering `start()` while active).
- `session_recorder.cpp:21–60` — no `if (active_) …` guard; line 58: `drain_thread_ = std::thread(&SessionRecorder::drainLoop, this);` while the previous thread is joinable → `std::terminate`.
- Before the terminate is reached, `fd_` is overwritten (line 23) while the old drain loop is still writing through it — the old fd leaks and the old thread writes into the *new* file, corrupting its header.

### Impact
A single duplicate IPC message crashes the emulator and kills the user's debug session. Even absent the crash, the new recording file would be corrupted by the old drain thread.

### Affected Files
- emulator/runtime/session_recorder.cpp
- emulator/runtime/ipc_server.cpp

### Recommended Fix
At the top of `start()`: `if (active()) return false;` (or call `stop()` first), and reply with a `record_error` IPC event on rejection. As defense-in-depth, guard the thread assignment: `if (drain_thread_.joinable()) drain_thread_.join();`.

### Urgency Level
HIGH

---

## Replay blocks shorter than the engine block leave stale samples in the input buffer

### Description
`SessionPlayer::nextBlock()` reads `min(frames, block_size_)` frames into the caller's buffer. When the recorded block size is smaller than the engine's current block size, the tail of `in_buf` (from `block_size_` to `frames`) is never written — it retains samples from the previous block (sine, WAV, or an earlier replay block). The engine then feeds this stale tail to the effect and the recorder.

### Evidence
- `session_player.cpp:102–115`: `size_t to_read = std::min(frames, static_cast<size_t>(block_size_)); readBytes(buf, to_read * 2 * sizeof(float));` — no zero-fill of `buf + to_read*2 .. frames*2`.
- `audio_engine.cpp:300–312`: the caller does not clear `in_buf` before `nextBlock` and consumes all `frames` afterwards.
- Reachable in practice: the file's `block_size` is fixed at record time; in the CoreAudio-driven simulated path `frames` is the hardware buffer size (≥ 256), which routinely exceeds a small recorded block size (e.g. 48).

### Impact
Incorrect replay: the effect receives garbage input in the tail of every block, so "deterministic replay" produces nondeterministic output — precisely the property the .dsrec feature exists to guarantee.

### Affected Files
- emulator/runtime/session_player.cpp
- emulator/runtime/audio_engine.cpp

### Recommended Fix
In `nextBlock()`, after the read: `if (to_read < frames) std::memset(buf + to_read * 2, 0, (frames - to_read) * 2 * sizeof(float));`. Better: emit a `replay_rate_mismatch` event when the header `block_size`/`sample_rate` differ from the engine config, since replay timing is also distorted in that case.

### Urgency Level
MEDIUM

---

## Scope/spectrum JSON can exceed SpscIpcQueue::MAX_MSG, silently re-enabling RT heap allocation

### Description
The RT-safety design assumes every IPC message fits in the pre-reserved `MAX_MSG` (81 920 bytes), sized for `rt_buffer_size = 256`. But scope message size scales with the *actual* hardware frame count: at 4096 frames/block (a value the code plans for — the `ScopeState` comment cites it), a scope frame is 33 × (4096/4) = 33 792 samples × 3 channels × ~9 bytes ≈ 900 kB. Building it grows `json_buf` past its reservation, and `SpscIpcQueue::push` → `slots_[w].msg.assign(m)` reallocates the slot string — all on the RT thread. The `// no alloc` comments become false with no warning.

### Evidence
- `emulator_state.h:30–47`: `MAX_MSG = 81920` with the comment "accommodates the maximum scope message (~76 kB at … rt_buffer_size=256)"; `slots_[w].msg.assign(m);  // no alloc: capacity pre-reserved`.
- `audio_engine.cpp:215–258`: `SCOPE_SAMPLES_MAX = 65536` per channel — the accumulation cap alone permits ~2.4 MB of JSON, 30× `MAX_MSG`.
- `audio_engine.cpp:166–191` (`build_scope_json`) appends to `json_buf` unboundedly.

### Impact
Large, repeated heap allocations (with malloc-lock contention) on the CoreAudio thread whenever the hardware buffer is large → xruns/glitches; permanently grown ~900 kB queue slots (×64 slots of memory bloat). No memory corruption, but it defeats the AC-38/39/40 RT guarantees.

### Affected Files
- emulator/runtime/emulator_state.h
- emulator/runtime/audio_engine.cpp

### Recommended Fix
Derive the scope sample budget from `MAX_MSG` rather than a fixed block count (decimate more aggressively for large frames), or truncate in `push()` when `m.size() > MAX_MSG` and count it as a drop. Add a debug assert `msg.size() <= MAX_MSG` in `push()`.

### Urgency Level
MEDIUM

---

## CoreAudio setup and render errors are ignored (OSStatus discarded), including input format mismatch

### Description
Nearly every CoreAudio call's return value is discarded: `EnableIO`, `StreamFormat` set, device selection, buffer-size set, and — in the render callback — `AudioUnitRender` itself. If the format set fails, the unit renders in an unexpected format; if `AudioUnitRender` fails mid-run (device unplugged, permission revoked), the effect silently processes zeros with no event to the IDE. The input path also never *sets* the client-side format on the input bus, so a hardware sample rate different from the engine rate (44.1 kHz mic vs 48 kHz engine) passes through unconverted — pitch/time skew with no diagnostic.

### Evidence
- `core_audio_device.cpp:206–241, 349–366`: seven consecutive `AudioUnitSetProperty(...)` calls with unchecked returns.
- `core_audio_device.cpp:66–67`: `AudioUnitRender(...)` return ignored; buffers were pre-zeroed, so failure = silent silence.
- `core_audio_device.cpp:243–250`: input format is only *queried* (scope Output, bus 1); its `mSampleRate` is never reconciled with the requested output rate — no resampler, no error.

### Impact
Silent failures and hard-to-diagnose wrong audio (pitch shift, silence, channel mismatch) — the class of bug this emulator exists to eliminate. Error propagation to the IDE (which has an event channel available) never happens.

### Affected Files
- emulator/runtime/core_audio_device.cpp

### Recommended Fix
Check each `OSStatus`; on setup failure, `stop()` and return `false` (callers already emit `realtime_unavailable`). In the callback, on `AudioUnitRender` failure increment an atomic error counter drained alongside xruns and surfaced as an IPC event. Compare the queried input `mSampleRate` with the engine rate and either set the client-side format (letting AUHAL resample) or emit a `sample_rate_mismatch` event.

### Urgency Level
MEDIUM

---

## SessionRecorder ignores write() failures — recordings silently truncate on disk-full

### Description
`writeBytes()` correctly loops on partial writes and returns `false` on error, but every call site in the drain path discards the result. On ENOSPC/EIO the drain loop keeps consuming ring-buffer slots and "writing" events, producing a corrupt, silently truncated .dsrec with no error event to the client. The header write in `start()` is the only checked case.

### Evidence
- `session_recorder.cpp:94–106` (`flushPending`): `writeBytes(&type, 1); … writeBytes(payload, 5);` — returns unchecked.
- `session_recorder.cpp:127–131` (`drainLoop`): `writeBytes(&type, 1); writeBytes(audio_slots_[r].data(), …);` — unchecked; the loop continues after failure.
- No mechanism exists to report a failed recording to the IPC client (`recordStop` has no status reply).

### Impact
A user records a regression session, the disk fills, and the file is quietly unusable — discovered only at replay time. Data-loss class bug in the feature meant to capture bugs.

### Affected Files
- emulator/runtime/session_recorder.cpp
- emulator/runtime/ipc_server.cpp

### Recommended Fix
In `drainLoop`, on any `writeBytes` failure: set an atomic `write_error_` flag, stop draining (close the fd), and push a `{"type":"event","kind":"record_error"}` message to `g_state.ipc_queue`. Have `recordStop` report final status (block count / error) back over IPC.

### Urgency Level
MEDIUM

---

## load_wav_file reads the entire file into memory before any validation; fseek/ftell unchecked

### Description
The WAV loader allocates and reads the whole file before checking the RIFF magic or the 10-minute sample cap. A wrong path (e.g. a multi-GB video accidentally selected in the IDE file picker) is fully buffered into RAM first. `fseek`/`ftell` returns are also unchecked.

### Evidence
- `wav_reader.cpp:195–209`: `fseek(END); long len = ftell(f); … std::vector<uint8_t> buf(len); fread(...)` — no size ceiling, no magic sniff of the first 12 bytes, no `fseek` return checks.
- The sample-count cap (`MAX_WAV_SAMPLES`, line 136) applies only *after* the full read, and only to the `data` chunk.

### Impact
Multi-GB transient allocations (potential OOM kill of the emulator and loss of the debug session) from a single mis-click; `bad_alloc` propagates as an exception through `dispatch()`'s catch — handled, but the allocation already happened.

### Affected Files
- emulator/runtime/wav_reader.cpp

### Recommended Fix
Read the first 12 bytes and validate `RIFF`/`WAVE` before buffering; enforce a hard file-size ceiling (e.g. 256 MB, comfortably above the 10-minute stereo-float cap) with checked `fseek`/`ftell` (or `fstat`) before allocating.

### Urgency Level
MEDIUM

---

## Hand-rolled JSON handling: substring key matching and unescaped output injection

### Description
`json_get` locates keys by searching for the literal substring `"key":` anywhere in the message — including inside *string values*. A `wavFile` path such as `/tmp/x"type":"transport".wav` (legal on POSIX) or any value containing a quoted key changes parse results. Symmetrically, outbound JSON embeds unsanitized text: `dispatch()` splices `e.what()` directly into a JSON string; exception text can contain quotes/backslashes, producing malformed JSON that can break the client's line parser.

### Evidence
- `ipc_server.cpp:20–67`: `json.find("\"" + key + "\":")` — no structural awareness; first match wins even inside a string value.
- `ipc_server.cpp:340–341`:
  ```cpp
  emit_event(std::string("{...\"msg\":\"") + e.what() + "\"}");
  ```
  `e.what()` is uncontrolled text, unescaped.

### Impact
Wrong command interpretation from legitimate-but-unusual values (paths containing quotes/braces), malformed outbound events breaking the extension's JSON parsing, and general protocol fragility. Local-only IPC limits the security dimension, but correctness is affected.

### Affected Files
- emulator/runtime/ipc_server.cpp

### Recommended Fix
Adopt a minimal proper JSON tokenizer for the bounded message vocabulary, or at minimum: skip over string values when scanning for keys, and add a `json_escape()` helper applied to every interpolated output value.

### Urgency Level
MEDIUM

---

## Audio configuration is latched once at engine start; later config changes silently ignored

### Description
`run_audio_engine()` reads `sample_rate` and `block_size` once, right after `StartAudio()` sets the callback, and passes the copies to the mode loops forever. Subsequent `config`/`audioDevice` IPC messages update `g_state` (and `status` replies report the new values), but the running engine keeps pacing the loop, resampling WAV input, computing FFT `binHz`, and opening CoreAudio at the stale captured values — even across mode switches, since the outer loop re-passes the same locals.

### Evidence
- `audio_engine.cpp:606–608`: `float sample_rate = g_state.sample_rate.load(); size_t block_size = g_state.block_size.load();` — captured once; the outer loop (lines 655–664) passes the same locals every iteration.
- `ipc_server.cpp:119–146`: `config` updates the atomics with no engine notification; `build_status_json` (94–102) reports the atomics, so the client believes the change took effect.

### Impact
Emulator behavior diverges from reported state: wrong playback rate for WAV/replay, wrong spectrum bin labeling, CoreAudio opened at a stale sample rate after a config change. Produces confusing "status says 44100 but it sounds like 48000" reports.

### Affected Files
- emulator/runtime/audio_engine.cpp
- emulator/runtime/ipc_server.cpp

### Recommended Fix
Re-load `sample_rate`/`block_size` from `g_state` at the top of each outer-loop iteration and have the `config` handler notify `mode_cv` (as `audioDevice` already does) so the active mode loop restarts with fresh values. Alternatively, reject post-start `config` messages with an explicit error event.

### Urgency Level
MEDIUM

---

## Recorder/drain-thread lifecycle at process exit: potential std::terminate in global destructor

### Description
If recording is active when the process shuts down via the clean path (effect's `main` returns), nothing calls `recorder.stop()`. `g_state` is a global; its destructor destroys `SessionRecorder` whose `drain_thread_` is still joinable → `std::terminate()` during static destruction. There is also no SIGINT/SIGTERM handler, so the *common* way users stop the emulator (killed by the IDE) always drops the `END` marker plus any un-drained ring-buffer blocks (up to 4 MB).

### Evidence
- `main.cpp:31–38`: after `effect_main()` returns, only `shutdown` is set and the two service threads are joined; the recorder is never stopped.
- `session_recorder.h:93`: `std::thread drain_thread_;` — `SessionRecorder` has no destructor; destroying a joinable thread terminates.
- `main.cpp:16–17`: only `SIGPIPE` is handled.

### Impact
Abort at exit on the clean-shutdown path (rare today — effects loop forever — but it is the documented fallback), plus systematic loss of trailing recording data on IDE-initiated kills.

### Affected Files
- emulator/runtime/main.cpp
- emulator/runtime/session_recorder.cpp
- emulator/runtime/session_recorder.h

### Recommended Fix
Give `SessionRecorder` a destructor that calls `stop()`. In `main`, call `g_state.recorder.stop()` after `effect_main()` returns. Install SIGTERM/SIGINT handlers that set `g_state.shutdown` (an async-signal-safe atomic store) so recordings get their END marker on IDE-initiated stops.

### Urgency Level
MEDIUM

---

## "latency" IPC metric is synthetic, not measured

### Description
`lastLatencyMs()` reports `budget_ms * 2.0` — twice the buffer duration — under the field name `measuredMs`. No timestamp-based measurement occurs; the value is a constant function of buffer size and sample rate.

### Evidence
- `core_audio_device.cpp:110`: `self->latencyMs.store(static_cast<float>(budget_ms * 2.0), …);`
- `audio_engine.cpp:557–562`: forwarded as `{"type":"latency","measuredMs":…}`.

### Impact
Users tune buffer sizes against a fabricated number; real device latency (device + safety offset + stream latency) can differ substantially.

### Affected Files
- emulator/runtime/core_audio_device.cpp
- emulator/runtime/audio_engine.cpp

### Recommended Fix
Sum `kAudioDevicePropertyLatency`, `kAudioDevicePropertySafetyOffset`, and buffer frames for the input+output devices at start time — or rename the field to `estimatedMs` until a real measurement exists.

### Urgency Level
LOW

---

## CoreAudioDevice: raw owning pointer and implicitly copyable handle

### Description
`CoreAudioDevice` owns `Impl*` as a raw pointer and does not delete copy/move operations. Copying a started device (easy to introduce when refactoring the lambdas in `audio_engine.cpp`) yields two owners → double `delete` via `stop()`/destructor.

### Evidence
- `core_audio_device.h:48–53`: `Impl* impl_{nullptr}; bool running_{false};` — rule-of-five ignored.
- `core_audio_device.cpp:440–443`: unconditional `delete impl_` in `stop()`.

### Impact
Latent double-free if the type is ever copied; current call sites are safe, so this is a maintainability risk rather than an active bug.

### Affected Files
- emulator/runtime/core_audio_device.h
- emulator/runtime/core_audio_device.cpp

### Recommended Fix
Use `std::unique_ptr<Impl>` and explicitly delete the copy constructor/assignment. Document the threading contract of `stop()` vs `drainXruns()`.

### Urgency Level
LOW

---

## Dual StartAudio registration latched once; callback changes silently ineffective

### Description
An effect can call both `StartAudio(InterleavingAudioCallback)` and `StartAudio(AudioCallback)` (real libDaisy also allows switching via `ChangeAudioCallback`). The shim stores both pointers and never clears the other; the engine latches `use_block = (block_cb != nullptr)` exactly once for the process lifetime, so a later interleaved registration is ignored whenever a block callback was ever set.

### Evidence
- `daisy_seed.cpp:32–44`: each overload sets its own pointer; neither clears the other.
- `audio_engine.cpp:604`: `const bool use_block = (g_state.block_cb != nullptr);` — evaluated once.

### Impact
Effects that switch callbacks run the wrong callback with no diagnostic. Low because the pinned v1 example corpus does not do this.

### Affected Files
- emulator/shim/src/daisy_seed.cpp
- emulator/runtime/audio_engine.cpp

### Recommended Fix
In each `StartAudio` overload, null the other pointer; re-evaluate `use_block` per block (make the callback pointers `std::atomic` for a clean cross-thread read). Emit a warning event if `StartAudio` is called more than once.

### Urgency Level
LOW

---

## System::Delay accumulates scheduler drift

### Description
`System::Delay(ms)` sleeps 1 ms at a time in a loop; each `sleep_for(1ms)` overshoots by the scheduler quantum, so `Delay(1000)` can take 1.1–2× the requested time under load. On hardware, `System::Delay` is tick-accurate.

### Evidence
- `system.cpp:8–14`: `for (i < ms) { if (shutdown) return; sleep_for(1ms); }` — the error compounds per iteration.

### Impact
Control-loop timing in effects (LED blink rates, polling cadences) runs visibly slower in the emulator than on hardware — a fidelity gap, not a safety issue.

### Affected Files
- emulator/shim/src/system.cpp

### Recommended Fix
Compute an absolute deadline (`steady_clock::now() + ms`) and loop `sleep_until(min(deadline, now + 1ms))`, checking shutdown each pass — same responsiveness, no cumulative drift.

### Urgency Level
LOW

---

## Pot values from IPC are not clamped to the ADC's physical 0..1 range

### Description
The `pot` handler validates the channel index but stores any float value, including negatives, >1, NaN, and infinity (`std::stof` accepts `nan`/`inf`). `AdcHandle::GetFloat` returns values a real 16-bit ADC can never produce, and effect parameter math (e.g. `freq = 20 + pot * 20000`) propagates NaN into the audio path.

### Evidence
- `ipc_server.cpp:164–189`: `float v = std::stof(val); g_state.pot_values[c].store(v);` — no clamp in either the `pot` or `potSnapshot` path (contrast with `outputVolume`, lines 299–308, which clamps).
- `adc_handle.cpp:18–21`: returns the stored value verbatim.

### Impact
A buggy IPC client makes effects behave in ways impossible on hardware, undermining behavioral fidelity; NaN pots → NaN audio, confusingly flagged as an effect bug by the `nan` event.

### Affected Files
- emulator/runtime/ipc_server.cpp

### Recommended Fix
Clamp to `[0, 1]` and reject non-finite values (`std::isfinite`) in both pot paths, mirroring the `outputVolume` handler.

### Urgency Level
LOW

---

## json_get mangles standard JSON escape sequences

### Description
The string-value scanner drops the backslash and keeps the following character literally: `\n` becomes `n`, `\t` becomes `t`, `\uXXXX` becomes `uXXXX`. Only `\"` and `\\` decode correctly by coincidence. Paths containing characters the client legitimately escapes round-trip wrong.

### Evidence
- `ipc_server.cpp:32–43`: `if (c == '\\' …) { ++pos; result += json[pos]; }` — no escape translation.

### Impact
Escaped characters in paths/values are corrupted (wrong file opened, or open fails). Rare in practice since POSIX paths seldom need escapes beyond `\\`.

### Affected Files
- emulator/runtime/ipc_server.cpp

### Recommended Fix
Translate the standard escape set (`\n \t \r \b \f \" \\ \/`) and decode or reject `\uXXXX`. (Subsumed by adopting a real JSON parser — see the JSON handling finding above.)

### Urgency Level
LOW

---

## PrintLine fidelity and missing format-string checking

### Description
`DaisySeed::PrintLine` forwards the effect's format string to `vprintf` without a compiler format attribute, so `-Wformat` cannot check call sites (mismatched varargs are UB at runtime), and it appends `\n` where real libDaisy emits `\r\n` — a byte-level diff for tests comparing serial output. Effect prints also share stdout with the `DAISY_EMU_SOCKET:` handshake line.

### Evidence
- `daisy_seed.cpp:50–56`: `std::vprintf(fmt, args); std::putchar('\n');`
- `daisy_seed_class.h:53`: declaration lacks `__attribute__((format(printf, 2, 3)))`.
- `ipc_server.cpp:389`: handshake printed to the same stdout stream.

### Impact
Undetected format-string bugs in user effects (runtime UB); minor output-fidelity gap vs hardware.

### Affected Files
- emulator/shim/src/daisy_seed.cpp
- emulator/shim/include/daisy/daisy_seed_class.h

### Recommended Fix
Add the `format(printf, 2, 3)` attribute to the declaration; emit `\r\n` to match hardware; document that the handshake is guaranteed to precede any effect output (the IPC thread prints it before `effect_main()` reaches user code in practice — make the ordering explicit).

### Urgency Level
LOW

---

## Build hardcodes -O0 for the runtime and enables only -Wall

### Description
Both the effect object and the entire emulator runtime (FFT, WAV resampler, render paths) compile at `-O0 -g` unconditionally — `CMAKE_BUILD_TYPE` is overridden by the explicit flags. Warnings are limited to `-Wall` with `-Wno-unused-parameter -Wno-unused-variable`; `-Wextra`, `-Wshadow`, `-Wconversion` are absent. (The opt-in ASAN/UBSAN/TSAN configurations are present and well done.)

### Evidence
- `CMakeLists.txt:99–101, 118–120`: `target_compile_options(… PRIVATE -O0 -g -Wall -Wno-unused-parameter -Wno-unused-variable)` on both targets.

### Impact
`-O0` on the runtime costs real headroom in the render callback (per-block FFT + JSON building), inflating xruns at small buffers; only `effect_obj` needs `-O0` for debuggability. Thin warning coverage lets narrowing/shadowing bugs through.

### Affected Files
- emulator/CMakeLists.txt

### Recommended Fix
Keep `-O0 -g` for `effect_obj` (debugging the effect is the product) but build `RUNTIME_SRC`/`SHIM_SRC` at `-O2 -g`. Add `-Wextra -Wshadow` to both targets and fix the fallout.

### Urgency Level
LOW

---

## Out of Scope

This review does NOT include:

* External dependency auditing (third-party libraries assumed trusted)
* Hardware verification against real Daisy Seed silicon
* Performance benchmarking with real-time measurements
* GUI/visual rendering correctness unless it impacts emulation core
* Security auditing beyond memory safety and input validation
* Formal verification or mathematical correctness proofs
* Review of binary assets (ROMs, audio files, firmware blobs)
