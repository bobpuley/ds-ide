# Emulator Code Review Report

## Heap Allocations in the Real-Time CoreAudio Render Callback

### Description
`CoreAudioDevice::Impl::renderCallback` (the full-duplex callback, called from
the CoreAudio real-time thread) allocates two `std::vector<float>` objects on
the heap at the top of every single callback invocation.

### Evidence
`emulator/runtime/core_audio_device.cpp`, lines 64–65:
```cpp
std::vector<float> in_interleaved(frames * 2, 0.f);
std::vector<float> out_interleaved(frames * 2, 0.f);
```
These are local variables inside `renderCallback`, which is registered as the
CoreAudio render callback and therefore runs on a real-time OS thread. Both
vectors are freshly `malloc`d on entry and `free`d on return, every callback,
at ~23 callbacks/second for a 48 kHz / 2048-frame setup or ~375/second for 128
frames. The output-only callback (`renderCallbackOutputOnly`) avoids this by
reusing `Impl::silentInput` and `Impl::workOut`, making the inconsistency
visible.

### Impact
`malloc`/`free` in a real-time thread is the canonical cause of audio xruns and
glitching. The allocator can block on a kernel lock at any point, bursting
latency beyond the callback budget. This is a direct correctness risk for
the full-duplex ("Realtime") mode.

### Affected Files
- `emulator/runtime/core_audio_device.cpp`

### Recommended Fix
Promote `in_interleaved` and `out_interleaved` to `Impl` member vectors (like
`silentInput` and `workOut`). Pre-size them in `start()` and guard against
hardware enlargements with a `resize` guarded by `if (frames*2 > size())` —
the same pattern the output-only callback already uses. No dynamic allocation
on the hot path.

### Urgency Level
HIGH

---

## IPC `send_line` Ignores Write Errors Silently

### Description
`send_line` calls `::send()` but discards the return value entirely, so any
partial write or EPIPE is silently swallowed. The same pattern appears in the
lambda captured in `g_state.send_ipc` registered per-client.

### Evidence
`emulator/runtime/ipc_server.cpp`, lines 270–273:
```cpp
static void send_line(int fd, const std::string& msg) {
    std::string line = msg + '\n';
    ::send(fd, line.c_str(), line.size(), 0);  // return value ignored
}
```
And lines 322–324:
```cpp
g_state.send_ipc = [client_fd](std::string msg) {
    std::string line = msg + '\n';
    ::send(client_fd, line.c_str(), line.size(), 0);  // return value ignored
};
```
`send()` can return a short count or `-1` on any partial delivery. No retry
loop and no disconnect detection.

### Impact
IPC messages (scope frames, spectrum data, LED state changes, xrun events)
are silently dropped on a congested or slow client. The client will silently
desync with no indication. `SIGPIPE` is suppressed at startup (`SIG_IGN`), but
`EPIPE` is still returned as `-1`; this is never acted on, so the server
continues writing to a dead socket rather than detecting the disconnect.

### Affected Files
- `emulator/runtime/ipc_server.cpp`

### Recommended Fix
Check the return value of `::send()`. On `<= 0` or `EPIPE`, break out of the
read loop, clear `send_ipc`, and close the client fd. For partial sends add a
write loop (analogous to `writeBytes` in the session recorder). Setting
`MSG_NOSIGNAL` on Linux (`send` flag) avoids needing the global `SIG_IGN` and
gives per-call control.

### Urgency Level
MEDIUM

---

## JSON Parsing via Custom Hand-Rolled `json_get` Is Fragile and Exploitable

### Description
All incoming IPC messages are parsed by a custom minimal-JSON extractor
(`json_get` / `parse_kv_object`) that does no schema validation, has no
nesting depth limit for the `{` scanner, and makes no attempt to handle
escaped characters inside string values.

### Evidence
`emulator/runtime/ipc_server.cpp`, lines 20–50 (`json_get`) and 54–73
(`parse_kv_object`). Specific issues:

1. **No depth limit** — the `{` case in `json_get` (line 36-41) increments
   `depth` on every `{` it encounters, but a crafted message with hundreds of
   nested braces will iterate the full string.
2. **Escaped quotes not handled** — the string-value scanner (lines 30–32) does
   `json.find('"', pos)` which stops at the first `"`, including `\"` escape
   sequences. A value like `{"path":"/tmp/a\"b"}` will truncate the path.
3. **`stoi`/`stof`/`stoul` with bare catch(...)** — lines 70 and 104–116 catch
   all exceptions, which is correct, but no error is reported and the parse
   result is silently dropped. An invalid `sampleRate` value leaves
   `g_state.sample_rate` unchanged with no indication to the caller.

### Impact
A malformed or hostile IPC message can cause silent configuration failures
(wrong sample rate, wrong pot channel, wrong WAV path) or denial of service
through a pathological input that takes O(N) time in the depth counter. This
is a developer-tool scenario, but the socket is locally accessible to anything
running as the same user.

### Affected Files
- `emulator/runtime/ipc_server.cpp`

### Recommended Fix
Use a minimal compliant JSON library (e.g. nlohmann/json single-header, or
PicoJSON — both header-only). If the custom parser is retained: add a
maximum-depth guard; implement proper `\"` handling in the string scanner; log
a warning when `stof`/`stoi` throws so configuration errors are not silent.

### Urgency Level
MEDIUM

---

## `CoreAudioDevice::stop()` Called Redundantly from Destructor After `impl_` Already Freed

### Description
`CoreAudioDevice::~CoreAudioDevice()` calls `stop()`. `stop()` deletes
`impl_` and sets it to `nullptr`. On non-Apple builds the non-Apple stub sets
`running_ = false` without touching `impl_`. On Apple builds, if `stop()` was
already called before destruction, `impl_` is `nullptr` — the guard `if (impl_
&& impl_->unit)` is safe. However, on a double-`stop()` call (e.g. `stop()`
followed by destruction), the same `delete impl_; impl_ = nullptr;` path runs
twice, which is safe only because `nullptr` is set first. This is benign today
but fragile.

### Evidence
`emulator/runtime/core_audio_device.cpp`, lines 163–166:
```cpp
CoreAudioDevice::~CoreAudioDevice() {
    stop();
    delete impl_;  // already deleted inside stop() — always nullptr here
}
```
`stop()` (line 370): `delete impl_; impl_ = nullptr;` — so the `delete` in
the destructor body is always a no-op `delete nullptr`, which is defined
behaviour, but the code is misleading.

### Impact
Currently safe (deleting `nullptr` is a no-op in C++). Risk is a maintenance
hazard: a future refactor that changes what `stop()` leaves behind could
introduce a double-free.

### Affected Files
- `emulator/runtime/core_audio_device.cpp`

### Recommended Fix
Remove `delete impl_;` from the destructor body — `stop()` already handles it
and sets `impl_ = nullptr`. Leave only `stop();` in the destructor. Optionally
convert `impl_` to `std::unique_ptr<Impl>` with a custom deleter that calls
`stop()`, which makes ownership explicit.

### Urgency Level
LOW

---

## `AudioBufferList` Allocated with `malloc` for Variable-Length Array; Buffer Channel Data Not Freed on Early Exit in `start()`

### Description
`CoreAudioDevice::start()` allocates the `AudioBufferList` struct and then
separately mallocs each channel's audio buffer. If any step between the first
channel malloc and the call to `stop()` fails early, some channel buffers may
not be freed. In the current code, after the loop that allocates channel
buffers there are two more `AudioUnitSetProperty` / `AudioUnitInitialize` /
`AudioOutputUnitStart` calls, each of which may fail with `stop(); return false`.

### Evidence
`emulator/runtime/core_audio_device.cpp`, lines 256–263 (allocation) and 271–276 (failure paths):
```cpp
impl_->inputBufList = static_cast<AudioBufferList*>(
    std::malloc(sizeof(AudioBufferList) + (nBufs - 1) * sizeof(AudioBuffer)));
impl_->inputBufList->mNumberBuffers = nBufs;
for (uint32_t ch = 0; ch < nBufs; ++ch) {
    ...
    impl_->inputBufList->mBuffers[ch].mData = std::malloc(dataBytes);
    ...
}
// Later failure paths:
if (AudioUnitSetProperty(...) != noErr) { stop(); return false; }
if (AudioUnitInitialize(...) != noErr)  { stop(); return false; }
if (AudioOutputUnitStart(...) != noErr) { stop(); return false; }
```
`stop()` does free all allocated channel buffers, so as long as
`mNumberBuffers` is already set before the failure, the cleanup is correct.
However, the partial-allocation window (after the struct malloc but before the
loop completes) is not safe: if `std::malloc(dataBytes)` returns `nullptr` for
channel _k_, `mData` of channel _k_ is null, and `stop()` will `std::free(nullptr)`
(safe), but channels 0..k-1 already allocated are still freed. So correctness
is preserved — but the code silently continues the loop without checking the
return value of each inner `malloc`, so a failed channel data allocation would
leave that buffer pointer as `nullptr` and `AudioUnitRender` would write to it,
causing a null-pointer dereference.

### Impact
If `std::malloc` for any channel's audio data buffer returns `nullptr` (OOM),
`AudioUnitRender` will write through a null `mData` pointer — this is a crash.

### Affected Files
- `emulator/runtime/core_audio_device.cpp`

### Recommended Fix
Check the return value of each `impl_->inputBufList->mBuffers[ch].mData = std::malloc(...)` call.
If null is returned, set `mNumberBuffers` to the count successfully allocated
before calling `stop()` and returning false. Alternatively, use a single
contiguous allocation sized for header + all channel buffers, which also
eliminates the mismatch between `mData` as `malloc`'d memory and the outer
struct as a separate `malloc`.

### Urgency Level
HIGH

---

## `ipc_send` Called from Real-Time Audio Thread (Blocking Mutex Acquisition)

### Description
The audio engine — running in the CoreAudio real-time callback — calls
`ipc_send()`, which acquires `g_state.send_mutex`. This mutex is also held by
the IPC server thread when it is sending the initial status line. Acquiring a
`std::mutex` from a real-time thread is undefined latency and can cause
priority inversion (real-time thread blocks behind a SCHED_OTHER IPC thread).

### Evidence
`emulator/runtime/audio_engine.cpp`, lines 28–31 (`ipc_send` helper):
```cpp
static void ipc_send(const std::string& msg) {
    std::lock_guard<std::mutex> lk(g_state.send_mutex);
    if (g_state.send_ipc) g_state.send_ipc(msg);
}
```
This is called from within the CoreAudio render callback (via
`scan_output_and_notify`, `build_scope_json`, `emit_spectrum_if_ready`,
`ipc_send` for latency/xrun) on the real-time thread, when in both simulated
and realtime audio modes. `g_state.send_ipc` itself calls `::send()`, a
syscall, inside the locked region — further extending the blocking period.

### Impact
Priority inversion: the CoreAudio real-time thread can block behind the IPC
server thread, causing deadline overruns, xruns, and audible glitches. On a
loaded system this is a reproducible bug, not a theoretical one.

### Affected Files
- `emulator/runtime/audio_engine.cpp`
- `emulator/runtime/ipc_server.cpp`
- `emulator/runtime/emulator_state.h`

### Recommended Fix
Replace the direct `ipc_send` calls from the audio callback with a lock-free
single-producer / single-consumer ring buffer (SPSC queue). The audio thread
posts messages into the queue without locking; a dedicated low-priority IPC
drain thread reads from the queue and calls `::send()`. This is the standard
pattern for real-time-safe logging/telemetry. Alternatively, scope and spectrum
events could be sent at a reduced cadence from a non-real-time context.

### Urgency Level
HIGH

---

## `SessionRecorder::stop()` Can Be Called Without `recorder_mutex` Guard (Race with Audio Thread)

### Description
`SessionRecorder::stop()` writes the END record and closes the file. It is
called from `ipc_server.cpp` (the IPC thread) under `recorder_mutex`. However,
the `active_` flag is checked inside `writeBlock` under the same mutex, but
after `stop()` clears `active_` and closes `fd_`, a concurrent `writeBlock`
call from the audio thread might observe `active_ == false` via relaxed load
before the audio thread's mutex acquisition, so it will return early safely.
The real risk is the ordering of `active_.store(false)` (release) in `stop()`
and `fd_` being closed — the audio thread uses `recorder_mutex` to guard its
`writeBlock` call, which means the two are serialized. This is correct.

However, `stop()` checks `active_` with `relaxed` order and does not hold
`recorder_mutex` itself — the mutex is held by the caller:

`ipc_server.cpp` line 193: `std::lock_guard<std::mutex> lk(g_state.recorder_mutex);`
`session_recorder.cpp` line 97: `if (!active_.load(std::memory_order_relaxed)) return;`

The issue: `flushPending()` inside `stop()` drains `pending_` under
`queue_mutex_`, while `enqueuePot`/`enqueueButton` also use `queue_mutex_`. A
pot or button event enqueued by the IPC thread AFTER the `recorder_mutex` lock
is taken in `recordStop` but BEFORE `flushPending` completes (impossible since
the IPC thread is the one holding `recorder_mutex` — it cannot enqueue and stop
simultaneously) — so this is structurally safe. The real gap: `pot` and `button`
IPC message handlers (lines 119–151) enqueue to the recorder WITHOUT holding
`recorder_mutex`, they only call `g_state.recorder.enqueuePot()` which uses
`queue_mutex_`. This is safe for the queue, but `g_state.recorder.active()` is
checked without `recorder_mutex`, creating a TOCTOU:

```
IPC thread checks active() == true         → decides to enqueue
                                           ← recordStop acquires recorder_mutex, clears active_, closes fd_
IPC thread calls enqueuePot()              → pushed to pending_
stop() finishes, flushPending() already done → event stays in pending_ forever, never written
```

### Impact
A pot or button event enqueued after `stop()` completes but while `active()`
still returned true (race window) is silently lost. The session file is
correct; the lost event just means the last control change is not recorded. Low
severity in practice (race window is microseconds wide) but is a real data race
on a load of `active_` outside any synchronisation.

### Affected Files
- `emulator/runtime/ipc_server.cpp`
- `emulator/runtime/session_recorder.cpp`

### Recommended Fix
In `dispatch()`, take `recorder_mutex` before calling `recorder.enqueuePot()` /
`recorder.enqueueButton()` and the `active()` check, eliminating the TOCTOU.
Alternatively, have `enqueuePot`/`enqueueButton` check `active_` under
`queue_mutex_` themselves — the flag can be moved inside that lock.

### Urgency Level
MEDIUM

---

## `ScopeState::accumulate` Can Overflow `in`, `out`, `out_r` Vectors

### Description
`ScopeState::accumulate` pushes samples into `in`, `out`, `out_r` every block
until `block_count >= SCOPE_BLOCKS`. These vectors are pre-reserved for 512
samples but never capped — if `frames` is large (e.g. the hardware gives 2048
frames), a single call can push 512+ elements (one per `SCOPE_STEP=4` frames:
2048/4 = 512), completely ignoring the reserve and causing reallocation on the
real-time thread.

### Evidence
`emulator/runtime/audio_engine.cpp`, lines 213–226:
```cpp
bool accumulate(const std::vector<float>& in_buf,
                const std::vector<float>& out_buf,
                size_t frames) {
    size_t buf_samples = frames * 2;
    for (size_t i = 0; i < buf_samples; i += SCOPE_STEP * 2) {
        in.push_back(in_buf[i]);
        out.push_back(out_buf[i]);
        out_r.push_back(out_buf[i + 1]);
    }
```
With `frames = 2048` and `SCOPE_STEP = 4`, the loop runs 512 iterations.
`SCOPE_BLOCKS = 33`, so 33 blocks × 512 samples = 16,896 samples are pushed
before emit — far beyond the `reserve(512)` hint.

### Impact
`push_back` triggers heap reallocation on the real-time CoreAudio callback
thread, causing unpredictable latency and xruns. With large hardware buffers
(common on macOS when the system output is an HDMI/Bluetooth device), this
happens every scope frame cycle.

### Affected Files
- `emulator/runtime/audio_engine.cpp`

### Recommended Fix
Compute the maximum expected scope frame size upfront (`SCOPE_BLOCKS * (max_frames / SCOPE_STEP)`)
and reserve accordingly. Or switch to a fixed-size ring buffer that overwrites
rather than grows. At a minimum, add a pre-check so `in.size()` can never
exceed a hard cap and call `scope.reset()` if exceeded.

### Urgency Level
HIGH

---

## WAV Parser: `bytes_per_sample = bits / 8` Is Zero When `bits < 8`; Subsequent Division Used as Loop Stride

### Description
`parse_wav` computes `bytes_per_sample = bits / 8` (integer division) without
validating that `bits` is a multiple of 8 or is at least 8. A WAV with
`bits = 4` (valid for some compressed encodings or malformed files) gives
`bytes_per_sample = 0`. The `decode` pointer is null for such inputs (the
switch has no case for 4-bit), so `parse_wav` returns false correctly — but
only because no decoder is found. If a future contributor adds a case for an
unusual bit depth that happens to divide badly, the stride becomes 0 and the
`for` loop at line 128 would read the same byte address `total_samples` times.

A second issue: `total_samples = data_size / bytes_per_sample` divides by zero
when `bytes_per_sample == 0` before the `!decode` check, causing UB/crash.

### Evidence
`emulator/runtime/wav_reader.cpp`, lines 105 and 124:
```cpp
uint32_t bytes_per_sample = bits / 8;
...
uint32_t total_samples = data_size / bytes_per_sample;  // BEFORE !decode check
```
The `if (!decode)` guard is at line 116, AFTER `total_samples` is computed.

### Impact
A malformed WAV file with `bits = 0` (which passes all earlier validation
checks) causes a division-by-zero at line 124 — this is undefined behaviour and
crashes in practice.

### Affected Files
- `emulator/runtime/wav_reader.cpp`

### Recommended Fix
Move the `bytes_per_sample == 0` / `!decode` guard BEFORE computing
`total_samples`. Add an explicit check: `if (bytes_per_sample == 0) { err = "unsupported bit depth"; return false; }` immediately after computing it.

### Urgency Level
HIGH

---

## `SessionPlayer::nextBlock` Does Not Check That `buf` Has Enough Space for `to_read * 2` Floats

### Description
`nextBlock` is documented to require `buf` pre-allocated to at least
`block_size * 2` floats. It uses `frames` (the caller's buffer size) to clamp
`to_read`, but it still calls `readBytes(buf, to_read * 2 * sizeof(float))`
where `to_read = min(frames, block_size_)`. If `frames` equals the live block
size (e.g. 48), but the file's recorded `block_size_` is larger (e.g. 2048),
`to_read = frames = 48`. This is safe. However, if `frames` is zero (which can
happen if `block_size` is reconfigured to 0 via an unexpected IPC message),
`to_read = 0` and `readBytes` is called with size 0, which returns immediately
— likely correct. The inverse: if `block_size_` is read from a malformed file
header as 0, `open()` closes the file and returns false (line 64), so this
path is guarded. The check at line 64 is adequate. This is LOW severity but
worth noting.

The real gap: `nextBlock` calls `::lseek(fd_, skip, SEEK_CUR)` (line 109) to
skip the rest of a block whose recorded size was larger than `frames`. `skip`
is `size_t` cast to `off_t`; on a 64-bit system this is fine, but if
`block_size_` is attacker-controlled (via a malformed `.dsrec` file) to be
a very large value, `skip` can be a multi-gigabyte seek that silently fails
(lseek returns error, not checked), leaving the file pointer at the wrong
position — causing all subsequent reads to parse garbage.

### Evidence
`emulator/runtime/session_player.cpp`, lines 107–109:
```cpp
if (block_size_ > static_cast<uint32_t>(frames)) {
    size_t skip = (block_size_ - static_cast<uint32_t>(frames)) * 2 * sizeof(float);
    ::lseek(fd_, static_cast<off_t>(skip), SEEK_CUR);  // return value ignored
}
```

### Impact
Malformed or edited `.dsrec` files can desync the file pointer, causing all
subsequent blocks to be parsed as corrupted data, leading to garbage audio and
incorrect pot/button replay. Not a crash, but incorrect emulation.

### Affected Files
- `emulator/runtime/session_player.cpp`

### Recommended Fix
Check the return value of `::lseek`. If it returns `-1`, set `done_ = true` and
return false. Add a sanity cap on `block_size_` in `open()` (e.g. reject files
with `block_size > 65536`).

### Urgency Level
MEDIUM

---

## `dispatch()` Calls `std::stof` / `std::stoul` Without Bounds Validation Before Use

### Description
IPC handlers for `sampleRate`, `blockSize`, `bufferSize`, and numeric pot/button
values call `stof`/`stoul` inside try/catch blocks but never validate the
resulting value is within any meaningful range before storing it into
`g_state`. An extremely large `sampleRate` (e.g. `1e38`) stored atomically and
used as a divisor later causes divide-by-zero or floating-point overflow
throughout the audio engine.

### Evidence
`emulator/runtime/ipc_server.cpp`, lines 104–105:
```cpp
if (!sr.empty()) g_state.sample_rate.store(std::stof(sr));
if (!bs.empty()) g_state.block_size.store(static_cast<size_t>(std::stoul(bs)));
```
And lines 175–176 for `audioDevice`. No range checks on either value.
`audio_engine.cpp` uses `g_state.sample_rate.load()` as a divisor in WAV
resampling (`ratio = wav.sample_rate / engine_sr`) and in sine phase accumulation
(`freq / sample_rate`). A zero or astronomically large sample rate causes
incorrect audio or FP exception.

Similarly, `blockSize = 0` would make `AudioCallbackRate()` return 0 or
divide-by-zero — line 23 in `daisy_seed.cpp` guards this with `bs > 0 ? bs : 1`
but only in `AudioCallbackRate`; the raw `block_size` is exposed and used
unguarded elsewhere.

### Impact
Denial-of-service via FP overflow/NaN propagation through the entire audio
pipeline. Silent misconfiguration that produces wrong audio without any error
indication.

### Affected Files
- `emulator/runtime/ipc_server.cpp`
- `emulator/runtime/audio_engine.cpp`

### Recommended Fix
Add explicit range checks immediately after parsing: reject `sampleRate` outside
`[100, 384000]` Hz and `blockSize` outside `[1, 65536]`. Emit an IPC error
event on rejection so the IDE is notified.

### Urgency Level
MEDIUM

---

## `run_simulated` Uses Shared Work Buffers Passed by Reference Into CoreAudio Callback Closure

### Description
In `run_simulated`, the vectors `in_buf`, `out_buf`, `in_ch0`, `in_ch1`,
`out_ch0`, `out_ch1` are passed into `run_audio_engine` by reference, then
captured by reference into the `ca_process` lambda, which is handed to
`device.start_output_only()` as the CoreAudio render callback. Those same
buffer references originate in `run_audio_engine` where they are local stack
variables — but they have the lifetime of the `run_audio_engine` call, not
the `run_simulated` call.

### Evidence
`emulator/runtime/audio_engine.cpp`, lines 365–375 (`ca_process` lambda
captures `out_buf` by reference) and lines 584–586 (buffers are locals in
`run_audio_engine`, passed into `run_simulated` by reference).

The critical window: after `device.stop()` returns (line 422), CoreAudio
guarantees no further callbacks. The `mode_cv.wait` on line 408 only unblocks
when mode changes or shutdown — at which point `run_simulated` returns, then
`run_audio_engine`'s loop may call `run_simulated` again (or exit). If the
sequence is:
1. `mode_cv` wakes → `run_simulated` calls `device.stop()`
2. `device.stop()` calls `AudioOutputUnitStop` — documented to be synchronous,
   draining in-flight callbacks
3. Only then does `run_simulated` return

Step 2 is the key: `AudioOutputUnitStop` blocks until the current render
callback completes. This is the Apple-documented safe stop sequence, so the
capture is safe as long as that guarantee holds. However, there is no assertion
or documentation in the code about this dependency on CoreAudio's stop
semantics.

### Impact
If `AudioOutputUnitStop` does not drain outstanding callbacks (which can happen
if `AudioUnitUninitialize` is called first in some configurations), the callback
can access freed stack memory — use-after-free and UB. Currently safe due to
CoreAudio semantics, but fragile and undocumented.

### Affected Files
- `emulator/runtime/audio_engine.cpp`
- `emulator/runtime/core_audio_device.cpp`

### Recommended Fix
Add a comment in `CoreAudioDevice::stop()` explicitly documenting that
`AudioOutputUnitStop` is called first (before `AudioUnitUninitialize`) and that
this guarantees no further callbacks, making the reference-capture lifetime
safe. Alternatively, promote the work buffers into `g_state` or the
`CoreAudioDevice` itself and pass them by value/pointer, eliminating the
lifetime dependency.

### Urgency Level
LOW

---

## CMakeLists.txt: No AddressSanitizer / UBSanitizer / ThreadSanitizer Options

### Description
The build system enables `-O0 -g -Wall` but does not offer any sanitizer
preset. ASan, UBSan, and TSan are the primary tools for catching the categories
of bugs described in this review (memory safety, UB, data races). Their absence
means regressions are detectable only at runtime.

### Evidence
`emulator/CMakeLists.txt`, lines 75–77 and 94–96:
```cmake
target_compile_options(effect_obj PRIVATE
    -O0 -g -Wall -Wno-unused-parameter -Wno-unused-variable
)
...
target_compile_options(effect_emu PRIVATE
    -O0 -g -Wall -Wno-unused-parameter -Wno-unused-variable
)
```
No `-fsanitize=address,undefined` or `-fsanitize=thread` option, no
`CMAKE_BUILD_TYPE` handling, no sanitizer `OPTION()` variables.

### Impact
Data races and UB found in this review (heap allocation in RT callback, the
IPC send race, WAV division-by-zero) would be caught immediately by ASan/TSan
during development if sanitizers were wired up. Without them, bugs can silently
corrupt state.

### Affected Files
- `emulator/CMakeLists.txt`

### Recommended Fix
Add CMake options:
```cmake
option(ASAN  "Build with AddressSanitizer + UBSanitizer" OFF)
option(TSAN  "Build with ThreadSanitizer" OFF)
if(ASAN)
    add_compile_options(-fsanitize=address,undefined -fno-omit-frame-pointer)
    add_link_options(-fsanitize=address,undefined)
endif()
if(TSAN)
    add_compile_options(-fsanitize=thread)
    add_link_options(-fsanitize=thread)
endif()
```
Note: ASAN and TSAN are mutually exclusive; document this.

### Urgency Level
MEDIUM

---

## `Led::Init` Uses `pin.pin` (uint8_t) as GPIO Pin Index Without Upper Bound Check

### Description
`Led::Init` stores `pin_ = static_cast<int>(pin.pin)`. The pin number comes
from effect code via `hw.GetPin(n)` which sets `p.pin = pin_num` (a `uint8_t`,
so 0–255). `emit_led_change` checks `pin >= 0 && pin < kNumGpioPins (32)` and
returns early if out of range, so the gate exists. However, `Switch::Init`
does the same: `pin_ = static_cast<int>(pin.pin)` and `Debounce` checks
`pin_ >= 0 && pin_ < kNumGpioPins`. Pin 0 maps to `D0` in gpio.h which is
`{0, 0}` — so `pin.pin = 0` is legitimate and distinct from "uninitialized
(-1)". This means an uninitialized `Switch` (never `Init`'d) has `pin_ = -1`
which is caught by `>= 0`. The LED case initializes `pin_ = -1` in the class
definition; `emit_led_change` guards negative. Structurally sound.

The subtle gap: `GetPin(pin_num)` only sets `p.pin = pin_num`; it leaves
`p.port = 0` (zero-initialized). A pin number like 30 (`D30`) would be mapped
by the Switch shim using `pin.pin = 30`. But `button_states` is only indexed
0..31 (`kNumGpioPins = 32`). The guard in `Debounce` is `pin_ < 32`, so pin
31 is valid. Pin 32+ would be caught. This is correct.

The real gap: `A0..A11` in gpio.h have non-zero `port` (port=0 for A0..A5,
port=1 for A6..A11), but `pin.pin` values for A6..A11 are 0..5, overlapping
with D0..D5. If an effect uses `Switch::Init(seed::A6)`, the switch shim reads
`button_states[0]` — the same slot as `D0`. Pot-channel and GPIO-channel
namespaces are conflated through the single `pin.pin` field.

### Impact
An effect that initializes a `Switch` on an analogue pin (`A6..A11`) will read
the wrong `button_states` slot (aliased with D0..D5), producing incorrect
switch state. This is an emulator-specific divergence from hardware behaviour
(on hardware, ADC and GPIO pin numbers don't alias).

### Affected Files
- `emulator/shim/src/switch.cpp`
- `emulator/shim/include/daisy/gpio.h`

### Recommended Fix
Switch the index key from `pin.pin` to a composite that includes `pin.port`, or
define a canonical pin-to-index mapping function that mirrors libDaisy's actual
hardware numbering. At minimum, document the aliasing limitation in `gpio.h` and
`switch.h`.

### Urgency Level
MEDIUM

---

## `decode_pcm24` Uses Signed Shift and Bitwise OR on Potentially Negative Values (Undefined Behaviour)

### Description
`decode_pcm24` performs sign extension of a 24-bit value by OR-ing a negative
mask into an `int32_t`. The method used is:
```cpp
int32_t v = static_cast<int32_t>(p[0] | (p[1] << 8) | (p[2] << 16));
if (v & 0x800000) v |= ~0xFFFFFF;
```
`p[1] << 8` and `p[2] << 16` operate on `uint8_t` values. `uint8_t` is
promoted to `int` before shifting. On platforms where `int` is 16 bits
(uncommon but standard-conformant), `p[2] << 16` is undefined behaviour
(shift past width). On 32-bit `int` platforms (all current targets), this is
safe. The `~0xFFFFFF` mask is computed on `int` (`int` is signed); the
expression `v |= ~0xFFFFFF` is fine since `v` is already `int32_t`.

`rd_u16` has the same pattern: `p[1] << 8` promotes `p[1]` to `int`
before shifting; if `int` were 16 bits this shifts by 8 into the sign bit.
Again safe on all real platforms, but technically UB on non-standard `int`.

### Evidence
`emulator/runtime/wav_reader.cpp`, lines 27–28 and 33–35:
```cpp
static float decode_pcm16(const uint8_t* p) {
    int16_t v = static_cast<int16_t>(rd_u16(p));
```
```cpp
static float decode_pcm24(const uint8_t* p) {
    int32_t v = static_cast<int32_t>(p[0] | (p[1] << 8) | (p[2] << 16));
```

### Impact
Theoretical UB on non-standard `int` widths. Zero practical risk on the
target (macOS / Apple Silicon, where `int` is always 32 bits). LOW severity
but flagged for portability.

### Affected Files
- `emulator/runtime/wav_reader.cpp`

### Recommended Fix
Cast byte values to `uint32_t` before shifting to avoid any integer-promotion
ambiguity:
```cpp
int32_t v = static_cast<int32_t>(
    static_cast<uint32_t>(p[0])
  | (static_cast<uint32_t>(p[1]) << 8)
  | (static_cast<uint32_t>(p[2]) << 16));
```
Apply the same pattern to `rd_u16` and `rd_u32`.

### Urgency Level
LOW

---

## `mach_timebase_info` Return Value Ignored; `s_mach_ns_per_tick` Division-by-Zero Risk

### Description
`init_mach_timebase()` calls `mach_timebase_info(&info)` and divides
`info.numer` by `info.denom` without checking either the return value of the
call or that `info.denom != 0`.

### Evidence
`emulator/runtime/core_audio_device.cpp`, lines 17–21:
```cpp
static void init_mach_timebase() {
    if (s_mach_ns_per_tick != 0.0) return;
    mach_timebase_info_data_t info;
    mach_timebase_info(&info);
    s_mach_ns_per_tick = static_cast<double>(info.numer) / static_cast<double>(info.denom);
}
```
`mach_timebase_info` can theoretically return `KERN_FAILURE`. If `info.denom`
is 0 (which cannot happen in practice on Apple hardware but is not statically
guaranteed), the division produces `+inf`, making all subsequent latency
measurements infinite — and xrun detection fires on every callback.

### Impact
In practice this never fails on Apple Silicon or Intel Macs, so the risk is
effectively zero. However, no error check means an unlikely platform error
would silently corrupt latency measurement.

### Affected Files
- `emulator/runtime/core_audio_device.cpp`

### Recommended Fix
Check the return value and fall back to 1.0 (1 tick = 1 ns approximation):
```cpp
kern_return_t kr = mach_timebase_info(&info);
if (kr != KERN_SUCCESS || info.denom == 0)
    s_mach_ns_per_tick = 1.0;
else
    s_mach_ns_per_tick = static_cast<double>(info.numer) / static_cast<double>(info.denom);
```

### Urgency Level
LOW

---

## `run_simulated` Soft Loop: Sleep Duration Based on `block_ns` Ignores Execution Time (Drift)

### Description
The silent software fallback loop in `run_simulated` sleeps for exactly
`block_ns` nanoseconds after each `process_one_block()` call, regardless of how
long `process_one_block()` took to execute.

### Evidence
`emulator/runtime/audio_engine.cpp`, lines 392–402:
```cpp
auto block_ns = static_cast<long long>(
    static_cast<double>(block_size) / static_cast<double>(sample_rate) * 1e9);

while (!g_state.shutdown.load()) {
    if (!process_one_block(block_size)) break;
    ...
    std::this_thread::sleep_for(std::chrono::nanoseconds(block_ns));
}
```
Each iteration takes `block_ns + execution_time`, causing the simulated clock
to run slower than wall time. Over minutes, this produces noticeable drift in
scope timing and WAV playback speed.

### Impact
WAV playback rate is slower than nominal when the effect is CPU-intensive.
Scope and FFT timestamps (relative to wall time) drift. Visually the scope
appears to update at a slower rate than expected.

### Affected Files
- `emulator/runtime/audio_engine.cpp`

### Recommended Fix
Use a wall-clock target: record the deadline before `process_one_block`,
compute how long the call took, and sleep only for `block_ns - elapsed`. Cap
the minimum sleep at zero to avoid negative sleep on overloaded systems:
```cpp
auto t0 = std::chrono::steady_clock::now();
if (!process_one_block(block_size)) break;
auto elapsed = std::chrono::steady_clock::now() - t0;
auto remaining = std::chrono::nanoseconds(block_ns) - elapsed;
if (remaining.count() > 0)
    std::this_thread::sleep_for(remaining);
```

### Urgency Level
LOW

---

## Out of Scope

This review does NOT include:
- External dependency auditing (third-party libraries assumed trusted)
- Hardware verification against real Daisy Seed silicon
- Performance benchmarking with real-time measurements
- GUI/visual rendering correctness unless it impacts emulation core
- Security auditing beyond memory safety and input validation
- Formal verification or mathematical correctness proofs
- Review of binary assets (ROMs, audio files, firmware blobs)
