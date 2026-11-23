# M94 — Daily-Use Correctness Fixes

**Version:** 0.27.3
**Status:** in progress
**Source:** 2026-11-21 code reviews (VS Code extension, C/C++ emulator) — HIGH findings #9, #1, #5 (intake 2026-11-23)

## Goal

Fix the three HIGH defects that ordinary use triggers: Wiring Editor edits that can corrupt the effect source, an audio callback that receives the device's frame count instead of the configured block size, and LED/MIDI telemetry that races when called from the audio callback. After this milestone, wiring edits always apply to the current text, every callback gets exactly `SetAudioBlockSize()` frames as on hardware, and LED and MIDI calls are safe from any thread.

## Sprint Tasks

### [x] fix: Serialize Wiring Editor edits and apply them to the current document version (FR-WE-13)

The source-mutating handlers compute line ranges from a snapshot taken before several `await`s and run interleaved, so two quick actions, or an outside change, apply ranges to the wrong lines; each handler also saves unrelated unsaved edits.

**Affected files:** `src/extension.ts`, `src/sidebar/wiring-editor-panel.ts`

**DoD:**
- `wirePin`, `unwirePin`, `moveControl`, `setPeripheralEnabled` and `placeControl` run through one promise queue, in arrival order
- Confirmation prompts run before the text used for the edit is read
- `doc.version` is re-checked just before `applyEdit`; on mismatch the edit is recomputed once from the new text, otherwise refused with a "the file changed, try again" message
- The file is saved after the edit only if it was not dirty before
- Tests: two concurrent actions both land in the source; a change between read and apply never corrupts a block; a dirty document stays dirty
- `npm test` green

---

### [x] fix: Re-block device audio so the effect callback always gets the configured block size (FR-EMU-12)

With a real audio device the effect is called with the device's frame count (at least 256), not `SetAudioBlockSize()`, so per-callback timing is off by `device_frames / block_size` and effect arrays sized from the block size overflow.

**Affected files:** `emulator/runtime/audio_engine.cpp`, `emulator/runtime/block_adapter.h` (new), `emulator/shim/src/daisy_seed.cpp`, `tests/`

**DoD:**
- A non-allocating `BlockAdapter` (input and output FIFOs sized before the stream starts) feeds the effect in exact `block_size` chunks in both `run_simulated()` (device path) and `run_realtime()`
- Runtime test: block sizes 4, 48 and 512 against a fake device delivering 256 frames and a varying frame count; every callback receives exactly the configured size, and the output has no gaps or repeated frames
- `AudioCallbackRate()` equals the measured callback rate in the test
- No allocation on the RT thread (adapter capacity fixed before start)
- Native and `npm test` suites green

---

### [x] fix: Make LED output latest-state atomics and MIDI output a multi-producer stream (FR-EMU-13)

`led_queue` and `midi_tx_queue` assume one producer, but `Led::Update`, `SetLed`, `RgbLed::Update` and `SendMessage` are also called from the audio callback, so two threads write the same `std::string` slot.

**Affected files:** `emulator/runtime/emulator_state.h`, `emulator/runtime/audio_engine.cpp` (drain loop), `emulator/shim/src/led.cpp`, `emulator/shim/src/rgb_led.cpp`, `emulator/shim/src/daisy_seed.cpp`, `emulator/shim/src/midi_uart_handler.cpp`, `emulator/shim/src/midi_usb_handler.cpp`, `tests/`

**DoD:**
- LED and RGB values are per-pin/channel atomic "latest value" slots; the drain thread samples them and sends only changed values; `led_queue` is removed
- `midi_tx_queue` is a bounded MPSC ring with fixed-size byte payloads (no `std::string`, no allocation on push); a full ring increments a dropped-message counter reported with telemetry
- Debug builds assert one producer thread per remaining SPSC queue
- TSAN stress test: two threads call `Led::Update` and `SendMessage` in a tight loop with no race report; every MIDI message arrives intact in per-thread order or is counted as dropped; the last LED value set is the last one received
- Native and `npm test` suites green
