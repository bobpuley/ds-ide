# M54 — Emulator RT & Concurrency Safety

**Version:** 0.17.2
**Status:** planned
**Source:** parallel code-review reconciliation (`docs/06_emulator_review.md`, 2026-08-25)

## Goal

Close three RT-thread/concurrency gaps that survived the emulator's extensive prior hardening: a real multi-producer data race on the IPC telemetry queues, scope/spectrum work running on the audio real-time callback, and a shutdown sequence where the "clean" path is effectively dead code. After this milestone, every `SpscIpcQueue` instance has exactly one producer, no non-RT-safe work runs on the audio callback, and process shutdown has one authoritative path that reliably flushes pending telemetry.

## Sprint Tasks

### [x] fix: eliminate multi-producer race on SpscIpcQueue (FR-EMU-9)

`ipc_queue` and `midi_queue` are documented single-producer/single-consumer ring buffers, but LED/RGB-LED shim code and the audio RT thread both push into `ipc_queue`, and the IPC thread and MIDI UART/USB handlers both push into `midi_queue` — an unsynchronized data race on a shared `std::string` under entirely ordinary use.

**Affected files:** `emulator/runtime/emulator_state.h`, `emulator/runtime/audio_engine.cpp`, `emulator/shim/src/led.cpp`, `emulator/shim/src/rgb_led.cpp`, `emulator/runtime/ipc_server.cpp`, `emulator/shim/src/midi_uart_handler.cpp`, `emulator/shim/src/midi_usb_handler.cpp`

**DoD:**
- LED/RGB-LED telemetry pushes into its own dedicated `SpscIpcQueue` instance (owned solely by the effect thread), not the audio-RT-thread-owned `ipc_queue`
- `midi_queue` is split into a `midi_tx_queue` (effect-thread producer) and `midi_rx_telemetry_queue` (IPC-thread producer), or `SpscIpcQueue` is upgraded to a genuine MPSC design
- `run_audio_engine()`'s drain loop drains all new queue instances
- No two threads ever call `push()` on the same `SpscIpcQueue` instance, verified by code inspection of every call site

---

### [x] fix: move scope/spectrum JSON serialization and FFT off the audio RT thread (FR-EMU-10)

`build_scope_json`/`build_spectrum_json`/`fft_radix2` currently run synchronously inside the CoreAudio render callback in both real-time and CoreAudio-driven simulated mode — up to ~5,000 `snprintf` calls plus two FFTs per emission, directly on the audio thread's deadline.

**Affected files:** `emulator/runtime/audio_engine.cpp`, `emulator/runtime/core_audio_device.cpp`

**DoD:**
- `processBlock`/`process_one_block` only push raw samples into a lock-free RT-safe structure (mirroring `SessionRecorder`'s existing `enqueueBlock` pattern)
- `build_scope_json`/`build_spectrum_json`/`fft_radix2`/`magnitude_spectrum` execute on the existing non-RT `drain_thread` instead
- Enabling the scope/spectrum view does not measurably increase the xrun count

---

### [x] fix: make process shutdown single-owner (FR-EMU-11)

The detached `shutdown_watcher` thread's `std::_Exit(0)` races the "normal" join/return-0 shutdown path and almost always wins, making the normal path dead code and discarding any not-yet-drained telemetry on every shutdown, not just the signal-driven path it was designed for.

**Affected files:** `emulator/runtime/main.cpp`

**DoD:**
- Exactly one code path owns process termination (`shutdown_watcher`, or the normal path joins `shutdown_watcher` itself instead of running a second racing sequence)
- A clean shutdown flushes `ipc_queue`/`oled_queue`/`midi_queue` telemetry before the process exits
- A test triggers shutdown mid-session and asserts queued telemetry was sent before exit
