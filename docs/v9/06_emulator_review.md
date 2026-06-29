# C/C++ Emulator Code Review

**Date:** 2026-06-28
**Scope:** ./emulator/
**Reviewer:** Automated static review

## Summary

| Urgency | Count |
|---------|-------|
| HIGH    | 3     |
| MEDIUM  | 3     |
| LOW     | 7     |

The emulator is well-structured for a development tool. The most critical issues are all real-time thread safety violations in the CoreAudio callback path: blocking disk I/O during recording, heap allocation for scope/spectrum JSON strings, and potential mutex acquisition from the audio callback thread via the LED shim. None of these cause memory corruption, but all can produce audio glitches (xruns) and, in the disk-I/O case, sustained pauses under load.

---

## HIGH

## Blocking Disk I/O in the CoreAudio Real-Time Callback (session recorder)

### Description
When a session recording is active and the emulator runs in **simulated+audio mode** (CoreAudio driving the loop via `start_output_only`), the render callback (`ca_process`) calls `process_one_block`, which in turn calls `SessionRecorder::writeBlock`. `writeBlock` calls `flushPending()` and then `::write(fd_, …)` — a blocking POSIX I/O call on the CoreAudio real-time thread. Blocking system calls on a real-time audio thread are prohibited because the kernel can pause the thread for arbitrarily long, causing xruns and audio distortion.

### Evidence
`audio_engine.cpp`, `run_simulated`, inside the `ca_process` lambda (which is the CoreAudio render callback in simulated mode):

```cpp
// Record input block (M14).
if (g_state.recorder.active()) {
    std::lock_guard<std::mutex> lk(g_state.recorder_mutex);
    g_state.recorder.writeBlock(in_buf.data(), frames);   // <-- disk I/O on RT thread
}
```

`session_recorder.cpp`, call chain `writeBlock` → `flushPending` → `writeBytes`:

```cpp
ssize_t r = ::write(fd_, p + written, n - written);   // blocking syscall
```

The same `process_one_block` path executes from the CoreAudio render callback (`ca_process` is passed to `device.start_output_only`).

### Impact
Audio dropouts / xruns when recording is active in simulated mode. Under sustained write pressure (fast block size, slow disk) the RT thread can stall for tens of milliseconds. On Apple Silicon with SSD this is usually benign, but on spinning disks or network filesystems it can cause total audio failure.

### Affected Files
- `emulator/runtime/audio_engine.cpp`
- `emulator/runtime/session_recorder.cpp`

### Recommended Fix
Move all file writes off the RT thread. The existing `SessionRecorder::pending_` queue infrastructure is almost the right abstraction: instead of flushing from `writeBlock`, let the audio thread enqueue audio-block data (alongside pot/button events) and let a dedicated recorder-drain thread (or the existing IPC drain thread) flush the queue to disk. Alternatively, use a ring buffer of pre-allocated audio frames that a non-RT thread drains.

### Urgency Level
HIGH

---

## Heap Allocations Inside the CoreAudio Real-Time Callback (scope/spectrum JSON strings and SPSC slot overflow)

### Description
Three distinct heap-allocation paths execute on the CoreAudio real-time thread inside the `processBlock` lambda of `run_realtime` (and `run_simulated` with CoreAudio):

1. **`build_scope_json` and `build_spectrum_json` each allocate a `std::string`** on the heap in the RT callback. Every call to `ipc_send(build_scope_json(…))` or `ipc_send(build_spectrum_json(…))` triggers a heap allocation. These functions are called every 33 audio blocks (scope) and every 1024 accumulated samples (spectrum).

2. **Scope messages exceed the SPSC slot capacity (`MAX_MSG = 16384` bytes).** The `SpscIpcQueue` constructor pre-reserves each slot's `std::string` to `MAX_MSG` to avoid reallocation in `push`. A scope message with default settings (256 frames/block, `SCOPE_STEP=4`, `SCOPE_BLOCKS=33`) accumulates approximately 2,112 samples per channel across three channels:
   - estimated message size ≈ `64 + 3 × 2112 × 12` ≈ **76 kB**
   - `MAX_MSG = 16 kB`
   - `slots_[w].msg.assign(m)` in `push()` will trigger a heap reallocation to accommodate the 76 kB string, directly on the RT thread.

3. **String-literal arguments to `ipc_send` also heap-allocate** because the function signature takes `const std::string&`; temporaries are constructed from the literal on the RT thread (e.g. `ipc_send("{\"type\":\"event\",\"kind\":\"nan\"}")` in `scan_output_and_notify`).

### Evidence
`emulator/runtime/emulator_state.h`, `SpscIpcQueue`:

```cpp
static constexpr size_t MAX_MSG = 16384;  // 16 kB per slot
```

`emulator/runtime/audio_engine.cpp`, `ScopeState`:

```cpp
static constexpr size_t SCOPE_BLOCKS = 33;
static constexpr size_t SCOPE_STEP   = 4;
```

Message-size calculation with default `rt_buffer_size = 256`:
- samples/block = `256 / SCOPE_STEP` = 64
- total samples = `64 × 33` = 2,112 per channel (3 channels)
- JSON size ≈ 76,032 bytes → exceeds `MAX_MSG` by ≈ 4.7×

`audio_engine.cpp`, `processBlock` in `run_realtime` (runs on CoreAudio RT thread):

```cpp
if (scope.accumulate(in_buf, out_buf, frames)) {
    ipc_send(build_scope_json(scope.in, scope.out, scope.out_r));  // heap alloc
    scope.reset();
}
emit_spectrum_if_ready(fft, in_buf, out_buf, frames, ...);  // heap alloc
```

### Impact
Priority inversion: heap allocation on the RT thread acquires the allocator lock, which may be held by a lower-priority non-RT thread. This manifests as audio glitches or xruns proportional to scope/FFT emission frequency. The SPSC slot reallocation additionally defeats the entire purpose of the lock-free design, as the allocator itself is not lock-free.

### Affected Files
- `emulator/runtime/audio_engine.cpp`
- `emulator/runtime/emulator_state.h`

### Recommended Fix
1. **Increase `MAX_MSG`** to cover the actual scope message size (at least 80 kB), so `assign()` never reallocates. Pre-reserve slots accordingly. This is a one-line fix and eliminates the RT-thread reallocation in the SPSC push.
2. For a fully lock-free RT path, format JSON directly into a fixed-size per-slot byte array rather than a `std::string`, avoiding any heap involvement.
3. For string-literal `ipc_send` calls: use a `std::string_view` or `const char*` overload that copies directly into the pre-reserved SPSC slot without constructing a temporary string.

### Urgency Level
HIGH

---

## `send_mutex` Acquisition from the Audio Callback Thread (LED shim)

### Description
`Led::Update()` and `DaisySeed::SetLed()` both call `emit_led_change`, which acquires `g_state.send_mutex` and then calls `g_state.send_ipc`. The `send_ipc` closure calls `::send()` on the IPC socket — a blocking system call — while holding `send_mutex`. If an effect calls `Led::Update()` or `DaisySeed::SetLed()` from inside its audio callback (a common pattern for clip/gate indicators in embedded audio code), the following sequence produces a priority inversion:

1. CoreAudio RT thread calls the audio callback → effect calls `Led::Update()` → `emit_led_change` tries to acquire `send_mutex`.
2. The drain thread holds `send_mutex` and is blocked in `::send()` (socket write stalled due to a full socket buffer or slow reader).
3. The RT thread blocks on `send_mutex` indefinitely, causing an xrun.

The emulator has no way to prevent effects from calling LED functions from the audio callback — this is a valid usage pattern in embedded audio code.

### Evidence
`emulator/shim/src/led.cpp`:

```cpp
void emit_led_change(int pin, bool lit) {
    // ...
    std::lock_guard<std::mutex> lk(daisy_emu::g_state.send_mutex);  // blocks RT thread
    if (daisy_emu::g_state.send_ipc) daisy_emu::g_state.send_ipc(buf);  // calls ::send()
}
```

`emulator/runtime/audio_engine.cpp`, drain thread:

```cpp
if (g_state.ipc_queue.pop(msg)) {
    std::lock_guard<std::mutex> lk(g_state.send_mutex);  // held while ::send() blocks
    if (g_state.send_ipc) g_state.send_ipc(msg);
}
```

### Impact
If an effect calls `SetLed` or `Led::Update` inside the audio callback (e.g., to signal clipping), and the IPC socket write stalls, the CoreAudio RT thread is blocked, causing xruns. The worst case is a sustained priority inversion if the VS Code client stops reading the socket.

### Affected Files
- `emulator/shim/src/led.cpp`
- `emulator/runtime/audio_engine.cpp`

### Recommended Fix
Route LED messages through the existing SPSC queue rather than calling `send_ipc` directly. Change `emit_led_change` to call `g_state.ipc_queue.push(buf)` (the same path `ipc_send` uses). The drain thread will forward the message off the RT path without any mutex acquisition on the emitting side.

### Urgency Level
HIGH

---

## MEDIUM

## Double-Close of the IPC Client File Descriptor

### Description
When `::send()` fails inside the `send_ipc` lambda, the lambda calls `::close(client_fd)` and sets `client_dead = true`. The outer `recv()` loop then exits (the fd is now invalid; `::recv()` returns `n <= 0`). The cleanup block unconditionally calls `::close(client_fd)` a second time. On POSIX systems, if another thread opens a file descriptor between the two `::close` calls (recycling that fd number), the second close silently closes the wrong, unrelated descriptor, corrupting another resource.

### Evidence
`emulator/runtime/ipc_server.cpp`:

```cpp
// In the send_ipc lambda:
ssize_t r = ::send(client_fd, line.c_str(), line.size(), 0);
if (r <= 0) {
    client_dead->store(true, std::memory_order_relaxed);
    ::close(client_fd);     // first close
}

// After the recv() loop exits:
{
    std::lock_guard<std::mutex> lk(g_state.send_mutex);
    g_state.send_ipc = nullptr;
}
::close(client_fd);         // second close — unconditional (line ~445)
```

### Impact
In the normal disconnection path (client closes first), no double-close occurs. In the error path (send fails), the fd is closed twice. Between the two closes, the emulator opens no new files in steady state, so fd reuse is unlikely in practice — but the bug is latent and would surface if concurrent file operations (e.g., WAV loading) happen at the same instant on another thread.

### Affected Files
- `emulator/runtime/ipc_server.cpp`

### Recommended Fix
Remove the `::close(client_fd)` from inside the lambda and rely solely on the cleanup block:

```cpp
// In the lambda: mark dead but do not close
if (r <= 0) {
    client_dead->store(true, std::memory_order_relaxed);
    // do NOT close here
}
// ...
// At cleanup (single, authoritative close):
::close(client_fd);
```

### Urgency Level
MEDIUM

---

## Uncaught `std::bad_alloc` from Oversized WAV Files Crashes the Process

### Description
`parse_wav` calls `out.samples.resize(total_samples)` where `total_samples = data_size / bytes_per_sample`. For an 8-bit mono WAV with `data_size = 0xFFFFFFFF` (~4 GB), `total_samples` approaches 4 billion, causing `resize` to throw `std::bad_alloc`. Neither `parse_wav`, `load_wav_file`, nor `dispatch` catch this exception. It propagates up through the IPC server's read loop and terminates the entire emulator process.

### Evidence
`emulator/runtime/wav_reader.cpp`:

```cpp
uint32_t total_samples = data_size / bytes_per_sample;
out.samples.resize(total_samples);  // throws std::bad_alloc for huge data_size
```

`emulator/runtime/ipc_server.cpp`, `dispatch` (called from the IPC server thread, no try/catch):

```cpp
auto wav = std::make_shared<WavData>();
std::string err;
if (load_wav_file(path, *wav, err)) {  // exception can propagate here uncaught
```

### Impact
A malformed or pathologically large WAV file (or a binary blob with a RIFF header) terminates the emulator process. The VS Code extension must restart the emulator, losing any in-progress recording or playback session.

### Affected Files
- `emulator/runtime/wav_reader.cpp`
- `emulator/runtime/ipc_server.cpp`

### Recommended Fix
Add a size guard in `parse_wav` before resizing:

```cpp
// Before out.samples.resize():
constexpr uint32_t MAX_WAV_SAMPLES = 48000u * 600u * 2u; // 10 min stereo @48 kHz
if (total_samples > MAX_WAV_SAMPLES) {
    err = "WAV file too large (exceeds 10 min stereo @48kHz)";
    return false;
}
out.samples.resize(total_samples);
```

Alternatively, wrap the `dispatch` call site with a `try/catch(const std::exception&)` that emits an error IPC event instead of crashing.

### Urgency Level
MEDIUM

---

## Heap Reallocation in CoreAudio RT Callback When Hardware Delivers More Frames Than Requested

### Description
When CoreAudio delivers more frames than the requested `bufferSize` (hardware minimum clamping), the render callbacks for both duplex (`renderCallback`) and output-only (`renderCallbackOutputOnly`) modes call `std::vector::assign()` or `std::vector::resize()` to grow their working buffers on the RT thread. Additionally, the `processBlock` lambda in `run_realtime` resizes its captured vectors on the RT thread under the same condition.

### Evidence
`emulator/runtime/core_audio_device.cpp`, `renderCallback`:

```cpp
if (self->in_interleaved.size() < frames * 2)
    self->in_interleaved.assign(frames * 2, 0.f);  // heap alloc on RT thread
if (self->out_interleaved.size() < frames * 2)
    self->out_interleaved.assign(frames * 2, 0.f); // heap alloc on RT thread
```

`renderCallbackOutputOnly`:

```cpp
if (self->silentInput.size() < frames * 2)
    self->silentInput.assign(frames * 2, 0.f);  // heap alloc on RT thread
if (self->workOut.size() < frames * 2)
    self->workOut.resize(frames * 2, 0.f);      // heap alloc on RT thread
```

`audio_engine.cpp`, `processBlock` in `run_realtime`:

```cpp
if (frames * 2 > in_buf.size()) {
    in_buf.resize(frames * 2, 0.f);   // heap alloc on RT thread
    out_buf.resize(frames * 2, 0.f);
    // ... channel buffers too
}
```

The code comments acknowledge this can happen (hardware minimum clamping) but treat it as a rare fallback. In practice some macOS USB audio devices enforce large minimum buffer sizes (512 or 1024 frames) regardless of the requested value.

### Impact
Each reallocation on the RT thread risks priority inversion with the system allocator. The risk is limited to the startup window (first few callbacks on affected hardware), after which buffers do not shrink. An xrun is likely on the first oversized callback.

### Affected Files
- `emulator/runtime/core_audio_device.cpp`
- `emulator/runtime/audio_engine.cpp`

### Recommended Fix
After `AudioOutputUnitStart`, query the actual hardware buffer frame count and pre-size all working buffers to that value before the first callback fires:

```cpp
// After AudioOutputUnitStart:
UInt32 actualFrames = bufferSize;
UInt32 sz = sizeof(actualFrames);
AudioObjectPropertyAddress ba{kAudioDevicePropertyBufferFrameSize, ...};
AudioObjectGetPropertyData(defaultOutput, &ba, 0, nullptr, &sz, &actualFrames);
impl_->in_interleaved.assign(static_cast<size_t>(actualFrames) * 2, 0.f);
impl_->out_interleaved.assign(static_cast<size_t>(actualFrames) * 2, 0.f);
```

### Urgency Level
MEDIUM

---

## LOW

## Non-Atomic Static `s_mach_ns_per_tick` Read from the RT Thread

### Description
`s_mach_ns_per_tick` is a plain `static double` global initialized by `init_mach_timebase()` in the `CoreAudioDevice` constructor. It is subsequently read from the CoreAudio RT callback without any formal memory ordering guarantee from the C++ standard.

### Evidence
`emulator/runtime/core_audio_device.cpp`:

```cpp
static double s_mach_ns_per_tick = 0.0;  // plain static, no atomic

// In RT callback:
double elapsed_ms = static_cast<double>(t_end - t_start) * s_mach_ns_per_tick / 1e6;
```

### Impact
In practice the value is set once before `AudioOutputUnitStart` and never written again. Apple's memory model and the implicit barrier from `AudioOutputUnitStart` make this safe on all current hardware. A stale zero value would compute `elapsed_ms = 0`, disabling xrun detection — incorrect but not crashing.

### Affected Files
- `emulator/runtime/core_audio_device.cpp`

### Recommended Fix
Declare as `static std::atomic<double>` (C++20), or store the computed value as a member of `Impl` set before `AudioOutputUnitStart`, which provides a natural publication barrier.

### Urgency Level
LOW

---

## `ipc_send` Return Value Silently Ignored — Messages Dropped on Full SPSC Queue

### Description
`g_state.ipc_queue.push()` returns `false` when all 32 slots are occupied. `ipc_send` discards this return value; scope frames, spectrum bins, NaN/clip events, and xrun reports are silently dropped with no diagnostic.

### Evidence
`emulator/runtime/audio_engine.cpp`:

```cpp
static void ipc_send(const std::string& msg) {
    g_state.ipc_queue.push(msg);   // return value ignored
}
```

With `SCOPE_BLOCKS = 33`, up to 33 scope messages are emitted in rapid succession, immediately filling the 32-slot queue. Subsequent spectrum and event messages are dropped.

### Impact
The VS Code extension receives incomplete scope or FFT data. No crash or data corruption; diagnostic quality is degraded.

### Affected Files
- `emulator/runtime/audio_engine.cpp`

### Recommended Fix
Track drops with an atomic counter and report them periodically:

```cpp
if (!g_state.ipc_queue.push(msg)) {
    g_state.ipc_queue_drops.fetch_add(1, std::memory_order_relaxed);
}
```

Also consider increasing `CAPACITY` from 32 to 64 or 128; the fixed-size slot design makes this trivially safe.

### Urgency Level
LOW

---

## `countBlocks` Ignores `lseek` Return Values in the Inner Scan Loop

### Description
`SessionPlayer::countBlocks` scans the file to count total audio blocks for progress reporting. Inside the scan loop, the return values of `::lseek()` are discarded. A corrupted or truncated `.dsrec` file can cause silent seek failures, leaving the file position indeterminate and producing an incorrect `total_blocks_` count.

### Evidence
`emulator/runtime/session_player.cpp`:

```cpp
while (::read(fd_, &type, 1) == 1) {
    if (type == kRecTypeAudioBlock) {
        ++total_blocks_;
        ::lseek(fd_, static_cast<off_t>(block_size_ * 2 * sizeof(float)), SEEK_CUR);  // return ignored
    } else if (type == kRecTypePotEvent) {
        ::lseek(fd_, 5, SEEK_CUR);   // return ignored
    } else if (type == kRecTypeButtonEvent) {
        ::lseek(fd_, 2, SEEK_CUR);   // return ignored
    }
}
```

### Impact
`total_blocks_` under-counts on corrupt files, causing incorrect progress display in the VS Code extension. The `nextBlock()` path has its own error handling and is unaffected.

### Affected Files
- `emulator/runtime/session_player.cpp`

### Recommended Fix
Break the scan loop on `lseek` error:

```cpp
if (::lseek(fd_, ..., SEEK_CUR) < 0) break;
```

### Urgency Level
LOW

---

## `decode_pcm32` — Implementation-Defined Behavior for High-Bit-Set Values (C++17)

### Description
`rd_u32` returns a `uint32_t`. Casting it to `int32_t` when the high bit is set is implementation-defined in C++17 (it becomes well-defined only in C++20, which mandates two's complement). On all current platforms the cast produces the expected two's complement result, but the compiler is technically free to behave differently.

### Evidence
`emulator/runtime/wav_reader.cpp`:

```cpp
static float decode_pcm32(const uint8_t* p) {
    int32_t v = static_cast<int32_t>(rd_u32(p));  // implementation-defined in C++17
    return static_cast<float>(v) / 2147483648.0;
}
```

### Impact
No practical impact on any supported platform (LLVM/GCC/Apple Clang all implement two's complement). Risk is limited to exotic or future targets.

### Affected Files
- `emulator/runtime/wav_reader.cpp`

### Recommended Fix
Use `std::memcpy` to reinterpret the bits in a defined way:

```cpp
uint32_t u = rd_u32(p);
int32_t v;
std::memcpy(&v, &u, sizeof(v));  // always defined
```

### Urgency Level
LOW

---

## `json_get` Does Not Fully Handle JSON Escape Sequences

### Description
The minimal JSON parser treats `\"` correctly but handles all other escape sequences (`\n`, `\t`, `\\`, `\uXXXX`) by including the literal character that follows the backslash (e.g. `\n` → `'n'`). For the emulator's actual payloads (file paths, mode strings, numbers), this is not a problem on macOS. A Windows-style file path such as `C:\foo` would be parsed as `C:foo`.

### Evidence
`emulator/runtime/ipc_server.cpp`:

```cpp
if (c == '\\' && pos + 1 < json.size()) {
    ++pos;  // skip backslash
    result += json[pos];  // adds the raw char after '\' — '\n' becomes 'n'
}
```

### Impact
File paths containing backslashes (Windows) or other escape sequences would be silently corrupted. On macOS (the primary target) there is no impact.

### Affected Files
- `emulator/runtime/ipc_server.cpp`

### Recommended Fix
Either document the limitation explicitly (acceptable for a macOS-only dev tool) or implement the full JSON string unescaping table. Since the VS Code extension controls the JSON format, a comment noting the limitation is an acceptable minimum fix.

### Urgency Level
LOW

---

## `socket_path` Silently Truncated by `strncpy` for Long Paths

### Description
`run_ipc_server` copies `socket_path` into `addr.sun_path` via `strncpy`. On macOS `sun_path` is 104 bytes. Paths longer than 103 characters are silently truncated, causing `bind` to fail or bind to an unintended path.

### Evidence
`emulator/runtime/ipc_server.cpp`:

```cpp
std::strncpy(addr.sun_path, socket_path, sizeof(addr.sun_path) - 1);
// No length check before this call
```

### Impact
The emulator fails to bind its socket (the VS Code extension cannot connect), with a confusing error message. In practice the extension generates paths of the form `/tmp/daisy_emu_<pid>.sock` which are well within 104 bytes.

### Affected Files
- `emulator/runtime/ipc_server.cpp`

### Recommended Fix
Validate length before copying:

```cpp
if (std::strlen(socket_path) >= sizeof(addr.sun_path)) {
    std::fprintf(stderr, "[daisy-emu] socket path too long (max %zu)\n",
                 sizeof(addr.sun_path) - 1);
    ::close(server_fd);
    return;
}
std::strncpy(addr.sun_path, socket_path, sizeof(addr.sun_path) - 1);
```

### Urgency Level
LOW

---

## IPC `partial` Buffer Is Unbounded Under Adversarial or Malformed Input

### Description
In `run_ipc_server`, received bytes are appended to `partial` (a `std::string`) until a newline delimiter is found. If a client (or a bug in the VS Code extension) sends data without newlines, `partial` grows without bound, eventually exhausting process memory.

### Evidence
`emulator/runtime/ipc_server.cpp`:

```cpp
partial.append(raw, static_cast<size_t>(n));
// Flush only triggered on '\n':
while ((nl = partial.find('\n')) != std::string::npos) { ... }
// No maximum size guard on partial
```

### Impact
Memory exhaustion if the VS Code extension sends a malformed (no-newline) message stream. This is a development tool without external network exposure; the risk is low.

### Affected Files
- `emulator/runtime/ipc_server.cpp`

### Recommended Fix
Add a maximum size guard and disconnect the client if exceeded:

```cpp
if (partial.size() > 1024 * 1024) {  // 1 MB max in-flight message
    std::fprintf(stderr, "[daisy-emu] client message too long — disconnecting\n");
    break;
}
```

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
