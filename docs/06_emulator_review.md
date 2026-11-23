# Review Report

> **Intake tracking:** each finding ends with an `### Intake Status` section. "Intaken" means it is planned in a milestone (see the v28 registry in `docs/05_dev-plan.md`); "Pending" means it has not been intaken yet. Update the status when a finding is intaken or released.

Scope: `emulator/` (runtime, shim, `CMakeLists.txt`) plus the native test/CI wiring under `tests/` and `.github/workflows/`. Review date: 2026-11-21, branch `chore/audit-and-actions` (HEAD `f453269`).

Findings are grouped by checklist category. Within each category they are ordered by urgency.

Summary: 5 HIGH, 12 MEDIUM, 6 LOW.

---

# Emulator correctness

## Audio callback block size ignores `SetAudioBlockSize()` whenever a real audio device drives the loop

### Description
On real hardware, libDaisy always calls the audio callback with exactly the configured block size (`SetAudioBlockSize`, default 48). The emulator instead calls the effect with whatever frame count the host audio device delivers:

- **Simulated mode with an output device (the normal macOS path):** the device is opened with `max(block_size, 256)` frames. Each device callback is passed straight to the effect, so an effect configured for 4 or 48 frames gets 256 or more per call.
- **Real-time mode:** the effect is called with the device's frame count (`rt_buffer_size`, default 256, possibly a different value or a varying one). `block_size` is not consulted at all.
- Only the headless fallback loop (no output device) honours `block_size`.

`DaisySeed::AudioCallbackRate()` still reports `sample_rate / block_size`. So control-rate code that relies on it (LFOs, envelopes, `Metro`, debounce/hold timers clocked once per callback) runs slower than intended by the ratio `device_frames / block_size`. For example, it runs 64x too slow with block size 4 and a 256-frame device buffer.

### Evidence
- `emulator/runtime/audio_engine.cpp:628-632`. The comment states the behaviour is intentional ("Effects receive the full hardware frame count per call, which is correct for emulation"):
  ```cpp
  const size_t hw_buf = std::max(block_size, size_t(256));
  ```
- `audio_engine.cpp:614-616`: `ca_process` forwards `n = min(frames, in_buf.size()/2)` device frames to `process_one_block(n)`, which then calls `block_cb(in_ptrs, out_ptrs, frames)` / `interleaving_cb(..., frames * 2)` (lines 582, 590).
- `audio_engine.cpp:741-772`: `processBlock` in real-time mode calls the effect with the device's `frames`.
- `emulator/shim/src/daisy_seed.cpp:21-24`: `AudioCallbackRate()` divides by `g_state.block_size`, not by the size actually delivered.

### Impact
- The emulator's timing for anything clocked per callback does not match the hardware. This defeats the emulator's main purpose of reproducing behaviour relevant to audio-effect development.
- **Memory safety for effect code.** Effects that size scratch arrays from their own block-size constant (`float tmp[kBlockSize]`) and loop to `size` will write past the array when `size > kBlockSize`. That is stack or global corruption inside the user's effect, triggered only on the emulator.
- Bugs that depend on block size (e.g. an effect that only works for `size == 48`) are hidden in the emulator and appear on hardware, or the other way round.

### Affected Files
- emulator/runtime/audio_engine.cpp
- emulator/shim/src/daisy_seed.cpp

### Recommended Fix
1. Add a re-blocking FIFO adapter between the device callback and the effect. Accumulate device input frames, call the effect in exact `block_size` chunks, and deliver output from an output FIFO. This adds at most one block of latency. `rtaudio_adapt::StreamRenderer` already does the reverse chunking, and a similar fixed-capacity, non-allocating structure fits here.
2. Size the adapter FIFOs before the stream starts (`maxCallbackFrames() + block_size`) so nothing allocates on the RT thread.
3. Apply the adapter in both `run_simulated()` (device path) and `run_realtime()`.
4. Add a runtime test that sets block size 4, 48 and 512 and asserts that every callback `size` equals the configured block size.

### Urgency Level
HIGH

### Intake Status
Released in 0.27.3 — M94 (FR-EMU-12), finding #1 of the HIGH intake.

---

## Configuration and shutdown wake-ups can be lost, and `audioDevice` changes are applied nondeterministically

### Description
There are three related defects in how state changes wake the audio-engine thread, which waits on `mode_cv` / `callback_cv`.

1. **Lost wake-up.** The `config` handler, the `shutdown` IPC message, the signal handler and `effect_main()` returning all change state that is read inside the `mode_cv` / `callback_cv` wait predicates. None of them holds `mode_mutex` / `callback_mutex` while doing so. Here is the sequence:
   - The engine thread evaluates the predicate under the lock (false).
   - The writer then increments `config_generation` (or sets `shutdown`) and calls `notify_all()`.
   - The engine thread has not yet blocked, so the notification is missed.
   - The engine then sleeps until some *other* notification arrives.

   `shutdown_watcher` notifies exactly once. If that notification is lost, `audio_thread.join()` hangs, telemetry is never flushed, and the process only dies when the extension escalates to SIGKILL.
2. **`audioDevice` never bumps `config_generation`.** The handler updates `sample_rate` and `rt_buffer_size` and then notifies `mode_cv`. However, neither wait predicate depends on those values, so the active mode loop wakes, re-evaluates to false, and goes back to sleep. The new values only take effect at the next mode switch.
3. **Ordering with the extension.** The extension always sends `audioMode` first and then `audioDevice` (`src/extension.ts:417-418`, `1286-1287`, `1309-1310`). Whether the new sample rate and buffer size are used therefore depends on whether the engine thread re-enters `run_realtime()` before or after the `audioDevice` message is dispatched.

### Evidence
- `emulator/runtime/ipc_server.cpp:428-429` (config, no lock):
  ```cpp
  g_state.config_generation.fetch_add(1, std::memory_order_relaxed);
  g_state.mode_cv.notify_all();
  ```
- `ipc_server.cpp:392-395`: `shutdown` is stored without a lock and nothing is notified.
- `ipc_server.cpp:610-637`: `audioDevice` stores `sample_rate` / `rt_buffer_size` and does not touch `config_generation`. Note the empty lock at 634-636: it prevents the lost wake-up, but the predicate cannot observe the change anyway.
- `emulator/runtime/main.cpp:133-137`: `shutdown_watcher` polls `shutdown` and then calls `notify_all()` once, without taking `mode_mutex` / `callback_mutex`.
- Predicates: `audio_engine.cpp:681-685`, `870-874` (mode, config_generation, shutdown) and `886-888` (`callback_set || shutdown`).
- `DaisySeed::AudioSampleRate()` reads `g_state.sample_rate` directly (`daisy_seed.cpp:17-19`). After a "missed" `audioDevice`, the effect therefore computes coefficients for the new rate while the device keeps running at the old one. For example, a 44.1 kHz request with the device still at 48 kHz detunes everything by about 8.8 %.

### Impact
- The process can hang at shutdown, since the join never returns, and lose telemetry.
- Rate and buffer-size changes are silently ignored or applied depending on thread timing. The emulator then runs with an effect-visible sample rate that differs from the device's, which is incorrect emulation and is not reproducible.

### Affected Files
- emulator/runtime/ipc_server.cpp
- emulator/runtime/main.cpp
- emulator/runtime/audio_engine.cpp
- emulator/shim/src/daisy_seed.cpp

### Recommended Fix
1. Add a single helper, e.g. `notify_engine(auto&& mutate)`. It should take `mode_mutex`, apply the mutation (store `audio_mode`, increment `config_generation`, set `shutdown`), release the lock, and then call `notify_all()`. Use it in every handler.
2. In `shutdown_watcher`, take `mode_mutex` and `callback_mutex` (separately) before each `notify_all()`. Even better, notify in a loop until `audio_thread` is observed to have exited, e.g. via a `std::atomic<bool> engine_exited`.
3. Make `audioDevice` increment `config_generation`, the same way `config` does.
4. Have `run_realtime()` capture `rt_buffer_size` and `sample_rate` on entry (it already does). Add a runtime test that sends `audioMode` and `audioDevice` back to back and asserts the device is opened with the new values.

### Urgency Level
HIGH

### Intake Status
Released in 0.27.4 — M95 (FR-RTS-8), finding #2 of the HIGH intake.

---

## Duplex CoreAudio stream binds one AUHAL unit to the default *input* device for both directions

### Description
`CoreAudioDevice::start()` sets `kAudioOutputUnitProperty_CurrentDevice` to the default input device. An AUHAL instance can only be attached to one hardware device (Apple TN2091). Setting `CurrentDevice` (Global scope) therefore re-targets the unit's *output* as well.

On current Macs, the built-in microphone and built-in speakers are separate `AudioDevice`s. The unit then renders output to the microphone device, which has no output streams. Separately, the code sets the buffer frame size on the default *output* device, which is not the device the unit is attached to.

> This needs verification on hardware. The behaviour depends on the default-device pair, and a headset that exposes input and output as one device would mask it.

### Evidence
- `emulator/runtime/core_audio_device.cpp:284-301`: `AudioUnitSetProperty(unit, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 1, &defaultInputDevice, ...)`.
- `core_audio_device.cpp:336-354`: `kAudioDevicePropertyBufferFrameSize` is set on `defaultOutputDevice`.
- `renderCallback` (lines 127-128) calls `AudioUnitRender` on input bus 1 from inside the output render callback. That is only valid when both directions belong to the same device clock.

### Impact
Real-time mode can be silent, can fail at `AudioUnitInitialize`, or can run with mismatched input and output clocks (drift, glitches) whenever the default input and output are different devices.

### Affected Files
- emulator/runtime/core_audio_device.cpp

### Recommended Fix
Use one of the supported topologies:
- create a private aggregate device (`AudioHardwareCreateAggregateDevice`) that combines the default input and output, and bind the AUHAL to it; or
- run two AUHAL units (input-only and output-only) joined by a lock-free ring buffer, with drift handling.

In either case, set the buffer size on the device the unit is actually bound to. Add a manual test-plan step that uses the built-in mic with the built-in speakers.

### Urgency Level
MEDIUM

### Intake Status
Pending — not yet intaken.

---

## Telemetry dedup state is committed before the push, so dropped LED/RGB updates are lost permanently and not counted

### Description
`emit_led_change()` and `emit_rgb_led_change()` update the "last emitted" atomics with `exchange()` *before* pushing to `led_queue`. They also ignore `push()`'s return value. When the queue is full, the message is dropped, but the dedup state already records it as sent. Every later identical write is then suppressed, so the virtual LED in the UI stays in the wrong state until the effect writes a different value. The drop is also not counted (there is no `led_queue_drops`; only `oversize_drops` is reported).

### Evidence
- `emulator/shim/src/led.cpp:12-20`: `exchange(want)` first, then `led_queue.push(buf);` with the result discarded.
- `emulator/shim/src/rgb_led.cpp:13-23`: same pattern for r/g/b.
- `emulator/runtime/audio_engine.cpp:1029-1039`: the drop report sums `led_queue.oversize_drops` but has no counter for led-queue-full drops.

### Impact
The virtual hardware state shown to the developer can diverge from what the effect commanded, with no diagnostic. This is a silent emulation error for a debugging tool.

### Affected Files
- emulator/shim/src/led.cpp
- emulator/shim/src/rgb_led.cpp
- emulator/runtime/emulator_state.h
- emulator/runtime/audio_engine.cpp

### Recommended Fix
If `push()` fails, restore the previous dedup value (`led_last_state[pin].store(prev)`) so the next write retries, and increment a new `led_queue_drops` counter that is folded into the `ipc_drops` report. Alternatively, keep per-pin "latest value" atomics that the drain thread samples, so a state output never depends on queue capacity.

### Urgency Level
MEDIUM

### Intake Status
Pending — not yet intaken.

---

## FatFs shim maps open modes incorrectly and swallows I/O errors

### Description
- `FA_OPEN_ALWAYS` maps to `"a+b"`. In append mode every write goes to end-of-file regardless of `f_lseek`. Real FatFs opens or creates the file with the pointer at offset 0, and writes land at the current position. A looper or sampler that rewrites a header after seeking will corrupt its file on the emulator only.
- `FA_CREATE_NEW` is never handled. It falls through to `"r+b"` and fails with `FR_NO_FILE` for a file that does not exist. Real FatFs creates it, or returns `FR_EXIST` if it already exists.
- `f_read`/`f_write` always return `FR_OK` even when `fread`/`fwrite` hit an error (`ferror`), so effect code cannot detect a full disk or an I/O failure.

### Evidence
- `emulator/shim/src/fatfs_host.cpp:48-56` (`fopen_mode`).
- `fatfs_host.cpp:81-91`: `f_read`/`f_write` ignore `ferror`.
- `emulator/shim/include/daisy/fatfs_host.h:31-34`: `FA_CREATE_NEW` is declared but never consulted.

### Impact
SD-card effects behave differently on the emulator than on hardware. Write-after-seek patterns corrupt data, and create-new patterns fail.

### Affected Files
- emulator/shim/src/fatfs_host.cpp
- emulator/shim/include/daisy/fatfs_host.h

### Recommended Fix
- For `FA_OPEN_ALWAYS`: try `"r+b"` and fall back to `"w+b"` if the file does not exist. Never use append mode.
- For `FA_CREATE_NEW`: check existence first and return `FR_EXIST` (add it to the enum), otherwise open with `"w+b"`. Use `"wx"` where available.
- Return `FR_DISK_ERR` when `ferror(fp->handle)` is set after a short read or write.
- Add these cases to `tests/fatfs-shim`.

### Urgency Level
MEDIUM

### Intake Status
Pending — not yet intaken.

---

# Memory safety

## WAV hazard-pointer protocol can free `WavData` while the audio thread is still reading it (use-after-free)

### Description
The audio thread loads `wav_data_ptr` and only *afterwards* publishes it in `wav_data_in_use`, without re-validating that the pointer is still current. The IPC thread exchanges in a new pointer and frees the old one as soon as `wav_data_in_use != old`. The gap between the load and the publish is an unprotected window. Here is the sequence:

1. The audio thread executes `wav = wav_data_ptr.load()` and gets `A`. It is preempted before `wav_data_in_use.store(A)`. At this point `wav_data_in_use` still holds its previous value: `nullptr` on first use, or a stale pointer.
2. The IPC thread receives a new `wavFile` and runs `exchange(B)`, which returns `A`. It sees `wav_data_in_use != A`, considers deletion "confirmed", and runs `delete A`.
3. The audio thread resumes, stores `in_use = A`, and calls `wav_fill_stereo_block(*A, ...)`. This reads freed memory.

There is a second problem. After a 200 ms timeout, `retire_wav_data` deletes the old buffer *unconditionally*. That is correct only if the audio thread is guaranteed not to be inside lines 526-532. Thread scheduling does not guarantee that (heavy load, or a stopped process resuming).

The release/acquire orderings used are also insufficient for this pattern. Hazard pointers need store→load ordering (`seq_cst`) between "publish hazard" and "re-read pointer".

### Evidence
- `emulator/runtime/audio_engine.cpp:526-532`:
  ```cpp
  const WavData* wav = g_state.wav_data_ptr.load(std::memory_order_acquire);
  g_state.wav_data_in_use.store(wav, std::memory_order_release);
  ...
  wav_fill_stereo_block(*wav, wav_pos, ...);
  ```
- `emulator/runtime/ipc_server.cpp:26-44`: `exchange` → poll `wav_data_in_use != old` → `delete old`, including the forced delete after the timeout.

### Impact
Heap use-after-free on the RT thread, which can crash or play garbage audio. Triggered by loading a new WAV, or clearing one, while WAV playback is running.

### Affected Files
- emulator/runtime/audio_engine.cpp
- emulator/runtime/ipc_server.cpp
- emulator/runtime/emulator_state.h

### Recommended Fix
- **Reader (RT):**
  ```cpp
  const WavData* p;
  do { p = wav_data_ptr.load(seq_cst); wav_data_in_use.store(p, seq_cst); }
  while (p != wav_data_ptr.load(seq_cst));
  ```
  Clear `wav_data_in_use` to `nullptr` once the block is rendered.
- **Retirer (IPC):** use a `seq_cst` exchange, then wait while `wav_data_in_use == old`. Never delete on timeout. Instead, push `old` onto a retire list that is reclaimed later, e.g. on the next retire or at engine shutdown.
- Alternatively, replace the scheme with an RCU-style epoch counter that the RT thread increments once per block.
- Add a TSAN stress test that swaps WAV files in a tight loop during playback.

### Urgency Level
HIGH

### Intake Status
Released in 0.27.4 — M95 (FR-RTS-6), finding #3 of the HIGH intake.

---

## OLED base64 encoder can leave its output unterminated before `snprintf("%s")`

### Description
`base64_encode` writes the NUL terminator only `if (oi < out_cap)`. When the encoded length exactly fills `out_cap`, which happens at 1536 input bytes for the 2048-byte buffer, the output is not terminated. `emit_oled_frame` then passes it to `snprintf("%s")`, which reads past the stack buffer. This cannot happen today because `kBufferSize` is fixed at 1024 bytes (1368 chars). It becomes reachable as soon as a larger panel is added, which the comment explicitly anticipates.

### Evidence
- `emulator/shim/src/oled_display.cpp:22, 45`: `for (; i + 3 <= len && oi + 4 <= out_cap; ...)` and `if (oi < out_cap) out[oi] = '\0';`.
- `oled_display.cpp:55-61`: `char b64[kB64Cap]` and `snprintf(msg, ..., "%s", b64)`.

### Impact
This is a latent stack over-read, and the frame is silently truncated for larger displays.

### Affected Files
- emulator/shim/src/oled_display.cpp

### Recommended Fix
Reserve one byte for the terminator (`oi + 4 < out_cap`) and add `static_assert(((kBufferSize + 2) / 3) * 4 < kB64Cap)` next to the template. Alternatively, use `snprintf("%.*s", (int)n, b64)` with the returned length.

### Urgency Level
LOW

### Intake Status
Pending — not yet intaken.

---

# Concurrency

## `SessionPlayer::open()` / `close()` race with the RT thread's `popBlock()` on replay restart

### Description
`popBlock()` is called from the audio callback without any lock, gated only by `g_state.replay_active`. A `replayStart` handled while a replay is already running does the following under `player_mutex`, which the RT thread never takes:

1. `close()`, then `open()`.
2. `open()` rewrites `stream_`, `events_` and `block_ends_` with `assign(...)` and resets all ring indices to 0.

Meanwhile, `replay_active` is still `true` and the RT thread can be inside `popBlock()`, `memcpy`-ing from `stream_` and storing `stream_r_ = r + n` with an `r` from the *previous* session. The result is:

- a data race on the non-atomic `stream_` contents (undefined behaviour);
- a stale `stream_r_` that is larger than `stream_w_`, so `w - r` underflows in both `popBlock` and `readerLoop`;
- a scrambled or skipped replay.

`replayStop` has the same race in a milder form: `replay_active = false` is not a barrier against a callback that has already passed the check.

### Evidence
- `emulator/runtime/ipc_server.cpp:674-706`: `player.close(); player.open(path, ...)` without first stopping the consumer; `replay_active` is set to true afterwards, but it was already true.
- `emulator/runtime/session_player.cpp:96-108`: `stream_.assign(...)` and the index resets.
- `session_player.cpp:231-265`: `popBlock` reads `stream_r_` / `stream_w_` and writes `stream_r_`.
- `session_player.cpp:201-204`: `free_frames = kStreamFrames - (w - r)` underflows if `r > w`.
- `emulator/runtime/audio_engine.cpp:491-498`: the RT call site.

### Impact
A data race (undefined behaviour) on the RT path, and corrupted replay. That breaks the determinism guarantee replay is meant to provide.

### Affected Files
- emulator/runtime/ipc_server.cpp
- emulator/runtime/session_player.cpp
- emulator/runtime/session_player.h
- emulator/runtime/audio_engine.cpp

### Recommended Fix
Give the RT consumer an explicit acknowledgement handshake before any lifecycle call:
1. Set `replay_active = false`.
2. Wait until the engine publishes `replay_in_use = false`. The RT thread sets that flag around `popBlock`, using the same hazard pattern as recommended for WAV.
3. Then `close()` / `open()`.

Alternatively, double-buffer two `SessionPlayer` instances and publish the active one through an atomic pointer with the same retire protocol. Add a test that issues `replayStart` twice in rapid succession under TSAN.

### Urgency Level
HIGH

### Intake Status
Released in 0.27.4 — M95 (FR-RTS-7), finding #4 of the HIGH intake.

---

## SPSC telemetry queues have an unenforced single-producer assumption that effect code routinely violates

### Description
`led_queue` and `midi_tx_queue` are documented as having one producer, the effect's `while(1)` thread. Nothing enforces that. `DaisySeed::SetLed`, `Led::Update`, `RgbLed::Update` and `Midi*Handler::SendMessage` are public libDaisy APIs that effect code commonly calls from inside the **audio callback**. For example, LED meters are updated per block, and MIDI clock is sent from the callback. When both the effect thread and the audio callback call them, two threads run `push()` concurrently:

- both read the same `write_` index;
- both `assign` into the same `Slot::msg` `std::string` (a data race on a non-trivial object, which can corrupt the heap or the string length);
- one message is lost or both are corrupted.

The code comments acknowledge that a previous version had exactly this bug with `ipc_queue` (FR-EMU-9). The fix moved the race rather than removing it.

### Evidence
- `emulator/runtime/emulator_state.h:306-314, 341-348` (the single-producer assumption is documented).
- `emulator/runtime/emulator_state.h:57-70`: `push()` uses a relaxed `write_` load and writes the slot non-atomically.
- `emulator/shim/src/led.cpp:20`, `emulator/shim/src/rgb_led.cpp:23`, `emulator/shim/src/midi_uart_handler.cpp:32`, `emulator/shim/src/midi_usb_handler.cpp:32`: all push without any thread check.
- `emulator/runtime/audio_engine.cpp:582, 590, 772, 780`: the effect callback runs on the device RT thread, which is a different thread from `effect_main()`.

### Impact
A data race on `std::string` internals can corrupt memory and crash, and telemetry is silently lost or garbled. The trigger is ordinary, valid Daisy effect code.

### Affected Files
- emulator/runtime/emulator_state.h
- emulator/shim/src/led.cpp
- emulator/shim/src/rgb_led.cpp
- emulator/shim/src/midi_uart_handler.cpp
- emulator/shim/src/midi_usb_handler.cpp
- emulator/shim/src/daisy_seed.cpp

### Recommended Fix
Pick one of these:
- **(a)** Make these queues MPSC. A bounded Vyukov MPMC ring with a per-slot sequence number is lock-free and still allocation-free.
- **(b)** Keep SPSC but give each producer thread its own queue: route by `thread_local` producer identity, using one queue for the RT thread and one for everything else.
- **(c)** For LEDs specifically, replace the queue with per-pin "latest state" atomics sampled by the drain thread (see the LED dedup finding).

In debug builds, add a `thread_local`-based assertion that a given SPSC queue only ever sees one producer thread id.

### Urgency Level
HIGH

### Intake Status
Released in 0.27.3 — M94 (FR-EMU-13), finding #5 of the HIGH intake.

---

## `SessionRecorder::enqueueBlock()` TOCTOU lets a block land after the session has closed or in the next session

### Description
`enqueueBlock()` checks `active_` *before* incrementing `in_flight_`. The race goes like this:

1. The RT thread passes the `active_` check.
2. `stop()` sets `active_ = false`.
3. The drain thread sees an empty ring and `in_flight_ == 0`, exits, and closes the fd. `stop()` returns.
4. The RT thread now increments `in_flight_` and writes a slot.

That block is either never written, or it is picked up by the *next* `start()`. Worse, `start()` resets `audio_write_idx_` / `audio_read_idx_` with plain stores while the RT thread may be between its `write_` load and its `write_` store. That gives two writers to the producer index, and the ring indices end up inconsistent (for example, a phantom full ring, or a stale block replayed as the first block of the new file).

### Evidence
- `emulator/runtime/session_recorder.cpp:102-108`: `if (!active_.load(acquire)) return false;` comes before `in_flight_.fetch_add(1)`.
- `session_recorder.cpp:47-50`: `start()` resets the indices without coordinating with the producer.
- `session_recorder.cpp:176-183`: the drain loop's completion test relies on `in_flight_`.

### Impact
A recording can carry a stale block from a previous session, or become desynchronized. That defeats replay determinism. It is rare, but it is a real logic race across sessions.

### Affected Files
- emulator/runtime/session_recorder.cpp
- emulator/runtime/session_recorder.h

### Recommended Fix
- Increment `in_flight_` first and then check `active_`. If inactive, decrement and return. This makes the existing `in_flight_` wait in `drainLoop` correct.
- In `start()`, wait for `in_flight_ == 0` (non-RT, so this is fine) before resetting the indices.
- Alternatively, add a session epoch to each slot and discard slots whose epoch doesn't match.

### Urgency Level
MEDIUM

### Intake Status
Pending — not yet intaken.

---

## `MidiInQueue` takes a mutex (and `std::deque` may allocate) when the effect polls MIDI from the audio callback

### Description
`MidiUartHandler::HasEvents()` / `PopEvent()` and their USB equivalents lock `MidiInQueue::mutex_`. Polling MIDI inside the audio callback is a common Daisy pattern (`midi.Listen(); while (midi.HasEvents()) ...`). In that case the RT thread contends on a mutex with the IPC thread, whose `push()` holds the lock while `std::deque::push_back` may allocate. That is a priority inversion and an unbounded block on the audio thread. The header comment assumes polling happens only on the effect thread, which is not guaranteed.

### Evidence
- `emulator/runtime/emulator_state.h:122-148`.
- `emulator/shim/src/midi_uart_handler.cpp:7-14` and `emulator/shim/src/midi_usb_handler.cpp:7-14`.

### Impact
Audio-thread blocking produces xruns and timing jitter that are not present on hardware.

### Affected Files
- emulator/runtime/emulator_state.h
- emulator/shim/src/midi_uart_handler.cpp
- emulator/shim/src/midi_usb_handler.cpp

### Recommended Fix
Replace `MidiInQueue` with a fixed-capacity lock-free SPSC ring of `MidiEvent`. The producer is always the IPC thread. There is exactly one consumer per effect, so documenting "poll from one thread" is sufficient. The existing "drop new event when full and count it" contract can stay.

### Urgency Level
MEDIUM

### Intake Status
Pending — not yet intaken.

---

## Blocking socket sends under `send_mutex`, with no short-write handling, can stall three threads and corrupt framing

### Description
`send_ipc` performs a blocking `::send()` while `send_mutex` is held. It treats any positive return as success, even when `ret < n`. The consequences:

- **Framing corruption:** a short write, e.g. one interrupted by a signal, leaves a partial JSON line on the wire. The next message is appended directly, corrupting the newline-delimited protocol.
- **Stall propagation:** if the client stops reading (the extension host is paused in a debugger, or busy), the drain thread blocks inside `send` while holding `send_mutex`. The effect thread then blocks in `warn_if_start_audio_repeated()`, and the IPC dispatch thread blocks in `emit_event()`. Once dispatch is blocked, the emulator stops reading the socket, so the client's own writes back up and both sides can stall. The RT thread is isolated by the queues, but all non-RT emulator threads freeze.

### Evidence
- `emulator/runtime/ipc_server.cpp:834-840`: `if (conn->send(line.c_str(), line.size()) <= 0)` marks the client dead, and a short write is otherwise ignored.
- `ipc_server.cpp:766-769`: `send_line` has the same pattern.
- `ipc_server.cpp:307-310` (`emit_event`), `emulator/shim/src/daisy_seed.cpp:35-41`, and `emulator/runtime/audio_engine.cpp:43-46, 993-1016`: all of these take `send_mutex`.

### Impact
The IPC stream is corrupted (the extension drops or misparses messages), and the effect thread can stall inside `StartAudio()`.

### Affected Files
- emulator/runtime/ipc_server.cpp
- emulator/runtime/ipc_transport_socket.cpp
- emulator/runtime/audio_engine.cpp
- emulator/shim/src/daisy_seed.cpp

### Recommended Fix
- Loop in `IpcConnection::send` until all `n` bytes are written, retrying on `EINTR`.
- Make only one thread, the drain thread, perform socket writes. `emit_event()` and `warn_if_start_audio_repeated()` should post into an MPSC outbound queue instead of calling `send_ipc` directly.
- Optionally, set `SO_SNDTIMEO` so a non-reading client is detected and dropped instead of blocking forever.

### Urgency Level
MEDIUM

### Intake Status
Pending — not yet intaken.

---

# Error handling

## Non-finite and out-of-range IPC numerics are accepted (`sine`, NaN through range checks, NaN-to-integer conversion)

### Description
- `sine.freq` and `sine.amplitude` are stored straight from `std::stof` with no validation. NaN makes `phase` NaN for the rest of the `run_simulated()` lifetime, and it never recovers because `phase += NaN`. A negative frequency is never wrapped, and a frequency at or above `sample_rate` defeats the single `if (phase >= 1.0) phase -= 1.0` wrap. In both cases `phase` grows without bound and loses precision. The generator path already clamps (`clamp_gen_params`), but this legacy path does not.
- `config.sampleRate` / `audioDevice.sampleRate` use `if (v < 100.f || v > 384000.f)`, and NaN passes because both comparisons are false. NaN is then converted with `static_cast<uint32_t>(sample_rate)` (`audio_engine.cpp:648, 827`) and `static_cast<long long>(NaN)` (`audio_engine.cpp:657-658`). Float-to-integer conversion of NaN is **undefined behaviour**.
- `outputVolume`: NaN survives both clamps, so the entire output becomes NaN.

`std::stof` accepts the literal tokens `nan` / `inf`. The current extension never sends them, because `JSON.stringify(NaN)` produces `null`. The emulator still treats its IPC input as external input, as the `clamp_pot_value` comment states, so it should reject them.

### Evidence
- `emulator/runtime/ipc_server.cpp:439-451` (sine), `402-409` / `615-620` (sampleRate range checks), `723-726` (outputVolume).
- `emulator/runtime/audio_engine.cpp:540-548` (sine phase accumulation).

### Impact
UB in the engine, and permanently NaN or broken input and output for a session, all from a single malformed message.

### Affected Files
- emulator/runtime/ipc_server.cpp
- emulator/runtime/audio_engine.cpp

### Recommended Fix
Route every numeric field through one helper that parses with `strtof` plus end-pointer checks and rejects `!std::isfinite`. Use the same pattern as `read_gen_field`. Clamp sine frequency to `[0, sample_rate/2)` and amplitude to `[0, 1]`, and wrap the phase with `phase -= std::floor(phase)`. Write the range checks as `!(v >= lo && v <= hi)` so NaN is rejected.

### Urgency Level
MEDIUM

### Intake Status
Pending — not yet intaken.

---

## Accepted buffer and block sizes exceed downstream capacities: recordings silently empty, real-time start fails silently

### Description
The IPC layer accepts `blockSize` and `bufferSize` up to 65536. Downstream:

- `SessionRecorder::enqueueBlock` drops any block with more than 8192 frames (`return false`). Every block of such a session is silently discarded and `record_stopped` reports `blocks: 0` with `error: false`.
- `ScopeBlockQueue` truncates blocks to 8192 frames without reporting it.
- `CoreAudioDevice::start*()` passes the requested size to `AudioObjectSetPropertyData(kAudioDevicePropertyBufferFrameSize)`. A value outside the device's allowed range (commonly about 15-4096) makes the call fail, so `start()` returns false. Real-time mode then reports `realtime_unavailable` and silently reverts to simulated mode, instead of clamping to the supported range.

### Evidence
- `emulator/runtime/ipc_server.cpp:416, 626`: `v > 65536` is the upper bound.
- `emulator/runtime/session_recorder.h:95` and `emulator/runtime/session_recorder.cpp:103`: `kMaxFramesPerSlot = 8192` and a silent drop.
- `emulator/runtime/audio_engine.cpp:333, 371`: scope truncation.
- `emulator/runtime/core_audio_device.cpp:345-352, 470-477`: the set fails and `stop(); return false;` follows.
- `emulator/runtime/audio_engine.cpp:828-836`: the silent fallback.

### Impact
Data is lost with no error, and the user's buffer-size choice is ignored or real-time mode refuses to start.

### Affected Files
- emulator/runtime/ipc_server.cpp
- emulator/runtime/session_recorder.cpp
- emulator/runtime/session_recorder.h
- emulator/runtime/core_audio_device.cpp
- emulator/runtime/audio_engine.cpp

### Recommended Fix
- Define one `kMaxFramesPerCallback` constant shared by the IPC validation, the recorder, the scope queue and the player, and reject values above it at the IPC boundary with `config_error`.
- Count recorder drops and surface them in `record_stopped`.
- In CoreAudio, read `kAudioDevicePropertyBufferFrameSizeRange` and clamp the requested size into it before setting it. Report the result through the existing `buffer_size_mismatch` event.

### Urgency Level
MEDIUM

### Intake Status
Pending — not yet intaken.

---

## Xrun reporting is broken: `xrun_count` is never incremented, equal per-window counts are suppressed, and driver overruns are never read

### Description
- `EmulatorState::xrun_count` is documented as "incremented by CoreAudio on deadline miss", but nothing increments it.
- `run_realtime()` computes `total_xruns = xrun_count (always 0) + device.drainXruns()`. `drainXruns()` resets the counter on each read, so `total_xruns` is a per-window delta and not a running total. Because it is compared against `last_reported_xruns`, two consecutive windows with the same number of xruns (e.g. one each) report only the first. A window with zero xruns after a window with xruns sends `count: 0`. The client receives a mix of deltas and totals.
- `AudioDevice::drainDriverOverruns()`, which carries WASAPI input-overflow and output-underflow status, is never called by the engine, so driver-level dropouts on Windows are never reported.
- Simulated mode with a device never reports xruns at all.

### Evidence
- `emulator/runtime/emulator_state.h:240`.
- `emulator/runtime/audio_engine.cpp:795-806`.
- `grep drainDriverOverruns emulator/runtime` finds only the declarations and implementations, with no call site.

### Impact
The xrun and dropout diagnostics are unreliable, which is a silent failure of a debugging feature.

### Affected Files
- emulator/runtime/emulator_state.h
- emulator/runtime/audio_engine.cpp
- emulator/runtime/audio_device.h

### Recommended Fix
Keep a local cumulative total in `run_realtime()` (`total += device.drainXruns() + device.drainDriverOverruns()`), report it whenever it changes, and delete the unused `xrun_count`. Do the same in the device path of `run_simulated()`.

### Urgency Level
MEDIUM

### Intake Status
Pending — not yet intaken.

---

## Per-block `clip` / `nan` / `denormal` events are unthrottled and can crowd one-shot events out of `ipc_queue`

### Description
`scan_output_and_notify()` pushes up to three events into `ipc_queue` on *every* block where the condition holds. An effect that clips continuously generates about 190 events per second (48 kHz, 256 frames), or about 12,000 per second at block size 4 in the headless loop. `ipc_queue` holds 64 slots and is drained one message per drain-loop iteration, interleaved with scope and FFT work. When it is full, the important one-shot events pushed on the same queue (`replayDone`, `record_error`, `xrun`, `realtime_unavailable`, `sample_rate_mismatch`) are dropped.

### Evidence
- `emulator/runtime/audio_engine.cpp:230-246, 593, 783`.
- `emulator/runtime/emulator_state.h:34` (`CAPACITY = 64`).

### Impact
Lost control events. For example, the UI may never learn that replay finished.

### Affected Files
- emulator/runtime/audio_engine.cpp

### Recommended Fix
Latch these conditions into RT-local flags and emit at most one event per kind per reporting window, for example every `SCOPE_BLOCKS` blocks, alongside the xrun report. Alternatively, use sticky atomic flags that the drain thread reads and clears.

### Urgency Level
MEDIUM

### Intake Status
Pending — not yet intaken.

---

## FatFs root-escape check ignores backslash separators on Windows

### Description
`path_escapes_root()` splits only on `'/'`. On Windows, `fopen` also accepts `'\'`, so a path such as `"..\\..\\Users\\x\\file"` passes the check and resolves outside `sdcard/`. The Windows build is a supported target (FR-WIN-*).

### Evidence
- `emulator/shim/src/fatfs_host.cpp:28-40, 42-46`.

### Impact
Effect code can read or write host files outside the virtual SD root on Windows, which breaks the documented sandbox (`fatfs_host.h:59-60`).

### Affected Files
- emulator/shim/src/fatfs_host.cpp

### Recommended Fix
Treat both `'/'` and `'\\'` as separators, and reject drive-qualified or rooted inputs (`':'`, a leading `'\\'`). Better still, resolve with `std::filesystem::weakly_canonical` and check that the result is still under the canonical SD root. Add a Windows case to `tests/fatfs-shim`.

### Urgency Level
MEDIUM

### Intake Status
Pending — not yet intaken.

---

## `controlSnapshot` ignores encoders and does not record its changes

### Description
The `controlSnapshot` handler applies pots, buttons and toggles but drops encoder (`enc<N>`) ids. Unlike `controlValue`, it also never calls `recorder.enqueuePot` / `enqueueButton`. As a result, encoder state is not restored after a reconnect, and snapshot-driven pot or button changes made during a recording are missing from replay.

### Evidence
- `emulator/runtime/ipc_server.cpp:506-529` (no `'E'` branch and no recorder calls) compared with `ipc_server.cpp:453-505`.

### Impact
Minor divergence between the live session and its replay or reconnect.

### Affected Files
- emulator/runtime/ipc_server.cpp

### Recommended Fix
Factor out one `apply_control(kind, idx, raw, record)` function used by both handlers, so they cannot drift apart.

### Urgency Level
LOW

### Intake Status
Pending — not yet intaken.

---

# Performance (RT-critical)

## Oversized telemetry rings and a polling drain thread

### Description
- Each of the five `SpscIpcQueue` instances reserves 64 × 80 KB, about 25 MB in total, even though four of them carry messages under 2 KB (LED, MIDI, OLED). `pop()` deep-copies up to 80 KB per message (`out.assign`) instead of swapping.
- The drain thread polls with a 500 µs sleep, which is about 2,000 wake-ups per second while idle.

### Evidence
- `emulator/runtime/emulator_state.h:34-51, 91-97`.
- `emulator/runtime/audio_engine.cpp:1018-1022`.

### Impact
Wasted memory and idle CPU on a developer laptop. Neither is a correctness issue.

### Affected Files
- emulator/runtime/emulator_state.h
- emulator/runtime/audio_engine.cpp

### Recommended Fix
Template `SpscIpcQueue` on its slot size, e.g. 80 KB only for `ipc_queue` and 4 KB for the others. Swap the strings in `pop()`. Replace the sleep-poll with a semaphore or futex-style wake that producers signal (`std::atomic::notify_one` in C++20, or a non-blocking `eventfd`/pipe write), while keeping producers non-blocking.

### Urgency Level
LOW

### Intake Status
Pending — not yet intaken.

---

# Build & maintainability

## No sanitizer or native-test coverage in macOS/Linux CI

### Description
`CMakeLists.txt` provides opt-in `ASAN` and `TSAN` builds (AC-49), and `tests/` holds about 24 native test suites. However, `ci.yml` only runs `npm ci`, `npm run lint` and `npm test`. The native suites run only in `windows-ci.yml`, which explicitly cannot run TSAN. As a result, no CI job ever builds the emulator with ThreadSanitizer or AddressSanitizer. Several findings in this report (WAV use-after-free, player restart race, multi-producer SPSC, recorder TOCTOU) are exactly the defects TSAN and ASAN detect.

### Evidence
- `.github/workflows/ci.yml:19-21`.
- `.github/workflows/windows-ci.yml:60-85`: a native build plus a check that `-DTSAN=ON` *fails* on Windows.
- `emulator/CMakeLists.txt:12-38`.

### Impact
Concurrency and memory regressions in the RT path ship undetected.

### Affected Files
- .github/workflows/ci.yml
- emulator/CMakeLists.txt
- tests/emulator-safety/run_tests.sh
- tests/runtime/build_and_test.sh

### Recommended Fix
Add a macOS (or Linux) CI matrix job that builds the emulator twice, with `-DTSAN=ON` and with `-DASAN=ON`, and runs `tests/runtime`, `tests/emulator-safety`, `tests/audio-engine` and `tests/scope-capture` under each. Add targeted stress tests for the races listed above.

### Urgency Level
MEDIUM

### Intake Status
Pending — not yet intaken.

---

## Warning set is incomplete and per-target flags are inconsistent

### Description
The runtime and shim are built with `-Wall -Wextra -Wshadow` but without `-Wconversion -Wsign-conversion -Wdouble-promotion` and without `-Werror`. Several implicit narrowing and float-to-integer conversions in hardware-facing code would be flagged (e.g. `static_cast<uint32_t>(sample_rate)`, `std::lround` results narrowed to `int32_t`). The `effect_emu` target adds `-O0 -g -Wall` again, but those options apply only to `DAISYSP_SRC`, which differs from what the comments imply.

### Evidence
- `emulator/CMakeLists.txt:183-185, 201-203, 222-224`.

### Impact
Conversion bugs (see the NaN finding) are not caught at compile time.

### Affected Files
- emulator/CMakeLists.txt

### Recommended Fix
Add `-Wconversion -Wdouble-promotion` to `runtime_shim_obj` and enable `-Werror` for it in CI only. Leave `effect_obj` lenient, since it compiles user code. Move the DaisySP flags into an explicit `daisysp_obj` target.

### Urgency Level
LOW

### Intake Status
Pending — not yet intaken.

---

## Hardware constants are duplicated as magic numbers

### Description
The ADC channel count `12` is hard-coded independently in `AdcHandle::GetFloat`, `decode_control_id`, the replay event handler and `EmulatorState::pot_values`. The "max frames per callback" limit appears with different values: 8192 in the recorder and scope queue, 65536 in the player, and 65536 at the IPC boundary. The comment in `SessionPlayer` ("AC-47: rejected above 65536") disagrees with the recorder's 8192.

### Evidence
- `emulator/shim/src/adc_handle.cpp:19`.
- `emulator/runtime/ipc_server.cpp:273`.
- `emulator/runtime/audio_engine.cpp:513`.
- `emulator/runtime/emulator_state.h:196`.
- `emulator/runtime/session_recorder.h:95`.
- `emulator/runtime/session_player.h:37`.
- `emulator/runtime/audio_engine.cpp:333`.

### Impact
Limits drift apart as the code changes, which is the root cause of the "silently empty recording" finding above.

### Affected Files
- emulator/runtime/emulator_state.h
- emulator/shim/src/adc_handle.cpp
- emulator/runtime/ipc_server.cpp
- emulator/runtime/audio_engine.cpp
- emulator/runtime/session_recorder.h
- emulator/runtime/session_player.h

### Recommended Fix
Add `kNumAdcChannels` and `kMaxFramesPerCallback` to `EmulatorState` (or a small `limits.h`) and reference them everywhere.

### Urgency Level
LOW

### Intake Status
Pending — not yet intaken.

---

## Minor transport error-handling gaps

### Description
- `authenticate()` loops with `continue` when `waitReadable()` returns -1 (an error), so it busy-spins until the 2 s hello deadline.
- `make_unix_listener()` ignores the return value of `::listen()`.
- The IPC-supplied `recordStart` path is opened with `O_TRUNC` without any validation, so any connected client can truncate any user-writable file. The Unix socket relies on filesystem permissions, and the TCP transport is token-gated.

### Evidence
- `emulator/runtime/ipc_server.cpp:797`.
- `emulator/runtime/ipc_transport_unix.cpp:39`.
- `emulator/runtime/ipc_server.cpp:639-648`.
- `emulator/runtime/platform_file.cpp:65-67`.

### Impact
CPU spin on a broken socket, an unreported listener failure, and a destructive write to an arbitrary path from a trusted-but-unchecked client.

### Affected Files
- emulator/runtime/ipc_server.cpp
- emulator/runtime/ipc_transport_unix.cpp
- emulator/runtime/platform_file.cpp

### Recommended Fix
- Return false from `authenticate()` when `waitReadable()` fails.
- Check `listen()` and report its error.
- Require `recordStart` paths to have a `.dsrec` extension, or confine them to a workspace directory supplied at launch.

### Urgency Level
LOW

### Intake Status
Pending — not yet intaken.

---

## Out of Scope

External dependency source auditing, hardware verification against real silicon, real-time performance benchmarking, GUI/rendering correctness (unless it affects the emulation core), security auditing beyond memory safety/input validation, formal verification, binary asset review (ROMs/audio/firmware).
