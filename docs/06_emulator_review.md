# Review Report

Scope: `./emulator/` (runtime/ + shim/ + CMakeLists.txt). This codebase carries
extensive prior hardening (inline `FR-*`/`AC-*` comments document dozens of
previously-fixed memory-safety, RT-safety, and correctness issues — sanitizer
builds are wired up via `-DASAN=ON`/`-DTSAN=ON`, and `tests/emulator-safety/`
provides unit coverage for the pure-logic IPC parsing functions). The findings
below are gaps that survived that hardening, not a first-pass audit.

---

## SpscIpcQueue multi-producer violation on `ipc_queue` and `midi_queue`

### Description

`SpscIpcQueue` (`emulator/runtime/emulator_state.h:32-102`) is explicitly a
**single-producer/single-consumer** ring buffer: `push()` reads `write_` with
`memory_order_relaxed`, mutates `slots_[w].msg` with no locking, then stores
the advanced index with `memory_order_release`. This is only race-free if
exactly one thread ever calls `push()`.

The codebase already understands this constraint correctly in one place: the
comments introducing `oled_queue` and `midi_queue` explicitly justify giving
each its *own* `SpscIpcQueue` instance instead of sharing `ipc_queue`,
*because* their producer (the effect's own thread) is different from
`ipc_queue`'s producer (the audio engine's CoreAudio RT thread):

```
// FR-DEV-14: ... OledDisplay::Update() is called from the effect's own
// while(1) loop (effect_main()'s thread, see runtime/main.cpp), not the
// audio engine's RT callback thread that owns ipc_queue; sharing that
// single instance would turn it into a two-producer queue and break its
// SPSC invariant.
```
(`emulator_state.h:278-287`, mirrored in `shim/include/daisy/oled_display.h:32-40`)

That reasoning was correctly applied to `oled_queue`, but **not** to two other
call paths that push into the very queues it was meant to protect:

**`ipc_queue`** — documented as owned by the audio engine's RT thread
(`emulator_state.h:272-273`, and `audio_engine.cpp:28-39`'s `ipc_send()`
helpers, called throughout `run_realtime`/`run_simulated`/the CoreAudio
render callbacks) — is *also* pushed into directly from:
- `emulator/shim/src/led.cpp:20` — `emit_led_change()`, called by
  `Led::Update()` and `DaisySeed::SetLed()`, both invoked from the effect's
  own thread inside `effect_main()`'s loop.
- `emulator/shim/src/rgb_led.cpp:23` — `emit_rgb_led_change()`, called by
  `RgbLed::Update()`, same effect thread.

**`midi_queue`** — documented with the identical "different producer thread"
rationale as `oled_queue` for its `midiRx` telemetry producer
(`emulator_state.h:303-308`) — is *also* pushed into from a second and third
site on a different thread:
- `emulator/runtime/ipc_server.cpp:485` — the IPC read-loop thread, on
  receipt of an inbound `midiEvent` message (`midiRx` telemetry).
- `emulator/shim/src/midi_uart_handler.cpp:32` and
  `emulator/shim/src/midi_usb_handler.cpp:34` — `SendMessage()`, called by
  the effect's own thread (`midiTx` telemetry).

In both cases, two independently-scheduled OS threads can call `push()` on
the same `SpscIpcQueue` instance concurrently during entirely normal use (an
effect that blinks an LED on clip while audio is running; an effect that
sends MIDI CC while the extension is also forwarding an inbound note).

### Evidence

```cpp
// emulator/runtime/emulator_state.h:56-69
bool push(const std::string& m) {
    size_t w    = write_.load(std::memory_order_relaxed);
    size_t next = (w + 1) % CAPACITY;
    if (next == read_.load(std::memory_order_acquire)) return false;
    if (m.size() > MAX_MSG) {
        slots_[w].msg.assign(m, 0, MAX_MSG);
        oversize_drops.fetch_add(1, std::memory_order_relaxed);
    } else {
        slots_[w].msg.assign(m);  // no alloc: capacity pre-reserved in constructor
    }
    assert(slots_[w].msg.size() <= MAX_MSG);
    write_.store(next, std::memory_order_release);
    return true;
}
```

If two threads race through this function with the same `w` (a real
possibility since `write_` is read with `relaxed` ordering and there is no
producer-side mutual exclusion), both call `.assign()` on the *same*
`std::string` object concurrently. `std::string::assign` is not
thread-safe for concurrent writers — this is a data race on a non-atomic,
non-trivial object, which is undefined behavior and can corrupt the
string's internal heap pointer/length/capacity fields (use-after-free,
heap corruption, or a crash inside `assign()`), not merely "drop a
message". Even in the best case where the race doesn't corrupt memory, both
threads' `write_.store(next, ...)` collapses two enqueued messages into a
single slot advance, permanently desynchronizing the producer/consumer
bookkeeping.

### Impact

Under ordinary use (an effect that drives an LED or sends MIDI while audio
is running — not a contrived edge case) this can corrupt the `ipc_queue` or
`midi_queue` ring buffer, corrupt or crash on the shared `std::string`
slot, or silently lose/garble scope, spectrum, xrun, LED, or MIDI telemetry
sent to the IDE. Because the failure mode depends on scheduling, it will
manifest intermittently and be very difficult to reproduce from a bug
report — exactly the kind of nondeterministic RT-thread bug this project's
own `FR-DEV-14`/oled_queue comment was written to prevent.

### Affected Files
- emulator/runtime/emulator_state.h (queue definition; `ipc_queue`, `midi_queue` declarations)
- emulator/runtime/audio_engine.cpp (RT-thread producer of `ipc_queue`)
- emulator/shim/src/led.cpp (second producer of `ipc_queue`)
- emulator/shim/src/rgb_led.cpp (third producer of `ipc_queue`)
- emulator/runtime/ipc_server.cpp (producer of `midi_queue`, IPC-dispatch thread)
- emulator/shim/src/midi_uart_handler.cpp (second producer of `midi_queue`)
- emulator/shim/src/midi_usb_handler.cpp (third producer of `midi_queue`)

### Recommended Fix
Apply the same fix already used for `oled_queue`: give LED/RGB-LED telemetry
its own dedicated `SpscIpcQueue` instance (owned by the effect thread only),
and split `midi_queue` into a `midi_tx_queue` (effect-thread producer) and
`midi_rx_telemetry_queue` (IPC-thread producer), each with a single producer.
Update the drain loop in `run_audio_engine()` (`audio_engine.cpp:728-793`)
to drain the new queue(s) alongside the existing ones. Alternatively, if a
shared queue across the effect thread and RT/IPC thread is truly desired for
message-ordering reasons, `SpscIpcQueue` must be upgraded to a genuine MPSC
design (e.g. a CAS loop on `write_`, or a mutex around `push()` — acceptable
here since none of the new producers are the actual RT audio thread).

### Urgency Level
HIGH

---

## Scope/spectrum JSON serialization and FFT computation run on the CoreAudio real-time render callback

### Description

Both real-time-mode audio (`run_realtime`) and CoreAudio-output-driven
simulated-mode audio (`run_simulated`'s `start_output_only` path) build the
scope and FFT JSON payloads *synchronously inside the CoreAudio render
callback* — the actual real-time audio thread — rather than deferring that
work to the non-RT drain thread that already exists for exactly this
purpose (`run_audio_engine()`'s `drain_thread`, `audio_engine.cpp:728-793`).

`build_scope_json()` (`audio_engine.cpp:166-191`) formats up to
`ScopeState::SCOPE_SAMPLES_MAX` (~1704, derived at `audio_engine.cpp:231-234`)
samples per channel — up to roughly 5,000 `std::snprintf("%.6g", ...)` calls
plus `std::string` concatenation — and `build_spectrum_json()`
(`audio_engine.cpp:87-109`) formats another ~1,024 values, on top of running
a 1024-point FFT twice (`fft_radix2`/`magnitude_spectrum`,
`audio_engine.cpp:43-84`). All of this executes directly inside:
- `run_realtime`'s `processBlock` lambda (`audio_engine.cpp:559-651`,
  specifically lines 611-618), registered as the AUHAL render callback via
  `device.start()` (line 653) — this **is** the OS's real-time audio thread.
- `run_simulated`'s `process_one_block` (`audio_engine.cpp:316-455`, lines
  447-453), invoked via the `ca_process`/`renderCallbackOutputOnly` path
  whenever a CoreAudio output device is available (the common case — the
  silent fallback loop at line 483 only runs headless/CI).

The scope emission cadence is fixed at once every `SCOPE_BLOCKS` (33)
callback invocations regardless of buffer size — so at small
`rt_buffer_size`/`bufferSize` values (accepted by `ipc_server.cpp`'s
`audioDevice`/`config` handlers down to 1 frame, `ipc_server.cpp:338,516`),
this multi-thousand-call formatting burst recurs on a proportionally shorter
per-callback deadline, making an xrun far more likely exactly when the user
has configured the tightest, most hardware-realistic buffer size.

### Evidence

```cpp
// audio_engine.cpp:611-618 — inside processBlock, the CoreAudio RT callback
if (scope.accumulate(in_buf, out_buf, frames)) {
    build_scope_json(scope.in, scope.out, scope.out_r, scope.json_buf);
    ipc_send(scope.json_buf);
    scope.reset();
}
emit_spectrum_if_ready(fft, in_buf, out_buf, frames, static_cast<float>(sample_rate));
```
`ipc_send()` itself is cheap (a lock-free push), but `build_scope_json`,
`emit_spectrum_if_ready` → `magnitude_spectrum` → `fft_radix2`, and
`build_spectrum_json` all run to completion on this thread *before*
`ipc_send()` is even called. The code is aware that RT-thread deadline
overruns are a risk — it measures `elapsed_ms` vs. `budget_ms` and counts
xruns (`core_audio_device.cpp:141-151,192-200`) — but it does not exempt
this formatting/FFT work from the callback, it merely reports the resulting
xrun after the fact.

### Impact

Audible glitches/dropouts specifically correlated with turning on the
scope/spectrum view, at exactly the moments a developer is using the
emulator to judge whether their effect's real-time behavior is acceptable
— i.e. the tool itself introduces the glitch it's meant to help diagnose,
undermining the core "preview real hardware-like timing" purpose of
real-time mode.

### Affected Files
- emulator/runtime/audio_engine.cpp (`build_scope_json`, `build_spectrum_json`, `fft_radix2`, `magnitude_spectrum`, `run_realtime`'s `processBlock`, `run_simulated`'s `process_one_block`)
- emulator/runtime/core_audio_device.cpp (render callbacks that invoke `processBlock` on the RT thread)

### Recommended Fix
Move scope/spectrum accumulation to a cheap RT-safe copy (e.g. push raw
samples into a lock-free ring, mirroring `SessionRecorder`'s existing
RT-safe `enqueueBlock` pattern) and perform the FFT + JSON formatting on the
existing non-RT `drain_thread` instead of inline in the render callback.

### Urgency Level
HIGH

---

## Process shutdown races between the "clean" join path and the forced `_Exit(0)` watcher

### Description

`main()` (`emulator/runtime/main.cpp`) has two independent shutdown paths
that are not coordinated with each other:

1. A detached `shutdown_watcher` thread (`main.cpp:59-69`) polls
   `g_state.shutdown`, and as soon as it's set, locks `recorder_mutex`,
   calls `recorder.stop()`, and immediately calls `std::_Exit(0)` —
   terminating the process without running any further C++ destructors and
   without joining `ipc_thread`/`audio_thread`.
2. The "normal" path after `effect_main()` returns (`main.cpp:71-83`) sets
   `shutdown`, stops the recorder itself, and then calls
   `ipc_thread.join(); audio_thread.join(); return 0;`.

Because `shutdown_watcher` polls every 20 ms and reacts to the *same*
`shutdown` flag the normal path just set, both paths race to call
`recorder.stop()` and to end the process. `recorder.stop()`'s own
idempotency (guarded by `recorder_mutex`, `session_recorder.cpp:226-238`)
prevents a crash from that specific call, but the watcher thread's
`std::_Exit(0)` can — and in practice usually will — fire before
`ipc_thread.join()`/`audio_thread.join()` complete, since it does not wait
on anything but the mutex. This makes the "normal" join/return-0 path
effectively dead code in the common case: any remaining queued IPC/scope/
event messages in `ipc_queue`/`oled_queue`/`midi_queue` that the drain
thread hasn't flushed yet are simply discarded by `_Exit(0)` instead of
being flushed by the joins the normal path was trying to perform.

### Evidence

```cpp
// main.cpp:59-69
std::thread shutdown_watcher([] {
    while (!daisy_emu::g_state.shutdown.load(std::memory_order_relaxed)) {
        std::this_thread::sleep_for(std::chrono::milliseconds(20));
    }
    { std::lock_guard<std::mutex> lk(daisy_emu::g_state.recorder_mutex);
      daisy_emu::g_state.recorder.stop(); }
    std::_Exit(0);
});
shutdown_watcher.detach();
...
// main.cpp:74-83 — races against the thread above once shutdown is set
daisy_emu::g_state.shutdown.store(true);
{ std::lock_guard<std::mutex> lk(daisy_emu::g_state.recorder_mutex);
  daisy_emu::g_state.recorder.stop(); }
ipc_thread.join();
audio_thread.join();
return 0;
```

### Impact

Not a crash risk (the mutex serializes the two `recorder.stop()` calls, and
`_Exit(0)` is safe to call at any point), but it means the graceful shutdown
path is unreliable/effectively unreachable, and any not-yet-drained IPC
telemetry is silently lost on every shutdown rather than only on the
signal-driven (SIGTERM/SIGINT) path the watcher was designed for
(`FR-EMU-8`). This is a maintainability trap: a future reader modifying the
"normal" path's cleanup logic (e.g. adding a final flush) would find it
doesn't reliably run.

### Affected Files
- emulator/runtime/main.cpp

### Recommended Fix
Have the normal `effect_main()`-returned path also just set `shutdown` and
let `shutdown_watcher` be the single, sole owner of process termination
(remove the duplicate `recorder.stop()`/join/`return 0` sequence, or replace
it with joining `shutdown_watcher` itself instead of running a second,
racing shutdown sequence).

### Urgency Level
MEDIUM

---

## `CoreAudioDevice::Impl` setup-field visibility to the render thread relies on undocumented ordering

### Description

`CoreAudioDevice::start()`/`start_output_only()` write several plain
(non-atomic) `Impl` fields — `processBlock`, `sampleRate`, `bufferSize`,
`inputChannels` — on the calling thread, then later call
`AudioOutputUnitStart()`, after which the render callback (running on
CoreAudio's internal real-time thread) reads those same fields with no
explicit synchronization. This relies on `AudioOutputUnitStart()`
transitively establishing a happens-before relationship with the render
callback's first invocation (a property of the CoreAudio/HAL implementation,
not something the C++ standard or this code guarantees). The codebase
clearly understands this exact concern — it calls it out explicitly for one
field:

```cpp
// core_audio_device.cpp:46-48
// Stored before AudioOutputUnitStart so the RT thread reads a stable value
// without races against the construction thread (FR-QA-19).
double mach_ns_per_tick{1.0};
```

but the identical reasoning is not documented (or verified) for
`processBlock`, `sampleRate`, `bufferSize`, or `inputChannels`, even though
they're set the same way, at the same call sites, for the same reason.

### Evidence
`core_audio_device.cpp:229-232` (`start()`) and `398-401`
(`start_output_only()`) set `sampleRate`/`bufferSize`/`processBlock` before
`AudioUnitInitialize`/`AudioOutputUnitStart` (lines 388-389, 481-482);
`inputChannels` is set later at line 312. None of these are `std::atomic`
or otherwise fenced, unlike `xruns`/`latencyMs`/`renderErrors`/
`actualInputSampleRate` which are correctly atomic.

### Impact
Low practical risk in the current single-call-path usage (this is a
standard, widely-used pattern in CoreAudio-based audio code, and in
practice `AudioOutputUnitStart` does provide the necessary ordering), but it
is formally a data race per the C++ memory model, and the asymmetric
documentation (one field explained, four not) makes it easy for a future
change — e.g. calling `start()` again to hot-swap `processBlock` while a
previous instance's callback might still be draining — to introduce a real
bug without realizing this invariant exists.

### Affected Files
- emulator/runtime/core_audio_device.cpp

### Recommended Fix
Either extend the `FR-QA-19` comment to cover all four fields explicitly (so
the reliance on `AudioOutputUnitStart`'s ordering guarantee is documented
once, in one place, for all of them), or make them `std::atomic`/store them
through a single fenced handoff point for defense-in-depth, matching the
pattern already used for `mach_ns_per_tick` and the metrics fields.

### Urgency Level
LOW

---

## Out of Scope

External dependency source auditing, hardware verification against real
silicon, real-time performance benchmarking, GUI/rendering correctness
(unless it affects the emulation core), security auditing beyond memory
safety/input validation, formal verification, binary asset review (ROMs/
audio/firmware).
