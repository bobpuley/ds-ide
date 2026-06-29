# M31 — Emulator RT-thread Safety

**Version:** 0.9.0  
**Status:** planned  
**Source:** 2026-06-28 C/C++ emulator code review — HIGH findings

## Goal

Eliminate all real-time thread safety violations in the CoreAudio render callback path. After M31, the audio thread never performs blocking I/O, never allocates heap memory, and never acquires a mutex.

## Sprint Tasks

### [x] fix: Move session recorder writes off the RT thread (FR-RTS-1)

The `SessionRecorder::writeBlock` call inside `ca_process` (the CoreAudio render callback) performs blocking POSIX `::write()` on the RT thread. Audio blocks must instead be enqueued into a non-blocking ring buffer (or the existing `pending_` queue), and a dedicated recorder-drain thread must flush the queue to disk.

**Affected files:** `emulator/runtime/audio_engine.cpp`, `emulator/runtime/session_recorder.cpp`

**DoD:**
- `ca_process` contains no `::write()`, `::pwrite()`, or any other syscall that can block
- A recorder-drain thread (or the existing IPC drain thread) performs all `::write()` calls
- Recording a 1-minute session at 48 kHz produces no xruns on a normally loaded system
- TSAN reports no data races on `SessionRecorder` state

---

### [x] fix: Eliminate heap allocation on the RT thread — SPSC slot size and JSON strings (FR-RTS-2)

Three heap-allocation paths exist on the CoreAudio RT thread:
1. `build_scope_json` and `build_spectrum_json` each construct a `std::string` per emission
2. The SPSC slot capacity (`MAX_MSG = 16 kB`) is smaller than the actual scope message (~76 kB), causing `std::string::assign` to heap-reallocate in `ipc_queue.push()`
3. String-literal `ipc_send` calls construct `std::string` temporaries on the RT thread

**Affected files:** `emulator/runtime/audio_engine.cpp`, `emulator/runtime/emulator_state.h`

**DoD:**
- `MAX_MSG` increased to ≥ 80 kB (or the formula `ceil(64 + 3 × SCOPE_BLOCKS/SCOPE_STEP × block_size × 12)` is documented and enforced via a `static_assert`)
- Working buffers in `renderCallback` and `renderCallbackOutputOnly` are pre-sized after `AudioOutputUnitStart` before the first callback fires
- No `std::string` temporaries are constructed inside `processBlock` or `ca_process`
- ASAN + TSAN pass on a 60-second recording session

---

### [x] fix: Route LED messages through the SPSC queue, not send_mutex (FR-RTS-3)

`emit_led_change` acquires `send_mutex` and calls `send_ipc()` (a `::send()` syscall) on whatever thread calls `Led::Update()` or `DaisySeed::SetLed()`. If that thread is the CoreAudio RT thread (a valid usage pattern in embedded audio code), priority inversion occurs.

**Affected files:** `emulator/shim/src/led.cpp`, `emulator/runtime/audio_engine.cpp`

**DoD:**
- `emit_led_change` calls `g_state.ipc_queue.push(buf)` instead of `g_state.send_mutex` + `g_state.send_ipc`
- An audio effect that calls `SetLed` 48,000 times per second from the audio callback produces no xruns and no mutex contention
- LED messages appear in the VS Code extension with the same latency as scope messages (~33-block cadence)
