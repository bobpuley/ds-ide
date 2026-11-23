> **v27 complete** — archived to `docs/v27/` on 2026-11-23. This file now seeds v28 planning.

# 04 — Architecture (v28)

> **v23 complete** — full v23 architecture in
> [`docs/v23/04_architecture.md`](v23/04_architecture.md).
>
> **v24 complete** — full v24 architecture in
> [`docs/v24/04_architecture.md`](v24/04_architecture.md).
>
> **v25 complete** — full v25 architecture in
> [`docs/v25/04_architecture.md`](v25/04_architecture.md).
>
> **v26 complete** — full v26 architecture in
> [`docs/v26/04_architecture.md`](v26/04_architecture.md).
>
> **v27 complete** — full v27 architecture in
> [`docs/v27/04_architecture.md`](v27/04_architecture.md).

## Review fixes — HIGH findings (M93–M95, intake 2026-11-23)

The process model is unchanged (VS Code extension + `effect_emu` native process over line-based JSON IPC). No IPC message is added or changed. The changes are local to the modules below.

**M93 — extension robustness (no architecture impact).**
- `src/ipc/narrow.ts`: `NARROWERS` becomes a `Map<string, Narrower>` (own keys only). `IpcClient.onData` wraps each line (parse, narrow, emit) in `try/catch` and counts failures as malformed (FR-IPC-8).
- `src/debug/debug-adapter.ts`: `FilteringLldbDapAdapter` listens to `stdin`/`stdout` `error` and to the child's `exit`; a `_dead` flag turns `handleMessage` into a no-op and guarantees one `terminated` event (FR-DBG-1).
- `src/debug/run-session-adapter.ts`: `launch()` catches errors and calls a new `respondError(req, err)`, then `stopOwnEmulator()` and `sendTerminated()` (FR-DBG-2).

**M94 — Wiring Editor edit queue (FR-WE-13).** One promise chain in `extension.ts` serializes every source-mutating handler, so each one starts after the previous edit has been applied (and saved, if applicable). Each handler:
1. runs any confirmation prompt first;
2. reads `doc.getText()` and records `doc.version` and `doc.isDirty`;
3. builds the `WorkspaceEdit` with `makeBlockEdit()`;
4. checks `doc.version` again just before `applyEdit` and, if it changed, recomputes once from the new text, then refuses with a message;
5. saves only when the document was clean at step 2.

**M94 — Re-blocking adapter (FR-EMU-12).** A new non-allocating `BlockAdapter` in `emulator/runtime/` sits between the device callback and the effect in `run_simulated()` (device path) and `run_realtime()`. It has an input FIFO and an output FIFO, both sized before the stream starts (`maxCallbackFrames() + block_size`). On each device callback it appends the device input, calls the effect once per complete `block_size` chunk, and copies the device's frame count from the output FIFO, primed with one block of silence so it never runs dry. Latency increases by at most one block. The headless loop already calls the effect with `block_size` and does not use the adapter. The 256-frame minimum device buffer stays, to avoid the callback storm small device buffers cause.

**M94 — LED state and MIDI stream (FR-EMU-13).** The two kinds of telemetry use different mechanisms because they promise different things:
- **LEDs** stop using `led_queue`. Each LED pin (and each RGB channel) has a `std::atomic` "latest value" slot in `g_state`, written with a relaxed store from any thread. The telemetry drain thread samples the slots at its existing rate and sends an update when a value differs from the last one sent. Dedup moves to the drain side, so a full queue can no longer lose an update.
- **MIDI** `midi_tx_queue` becomes a bounded multi-producer, single-consumer ring (Vyukov-style per-slot sequence numbers) of fixed-size slots. The payload is a fixed byte array, not a `std::string`, so the audio thread does not allocate. Push order defines the total order. A full ring increments a dropped-message counter that is reported with the existing telemetry.
- In debug builds, each remaining single-producer queue asserts (`thread_local` id) that it only ever sees one producer.

**M95 — WAV hazard pointer (FR-RTS-6).** Reader (audio thread): load `wav_data_ptr`, store it into `wav_data_in_use`, reload and retry until both match (all `seq_cst`); clear `wav_data_in_use` after the block is rendered. Retirer (IPC thread): `seq_cst` exchange, then wait while `wav_data_in_use == old`. It never deletes on timeout: after the wait budget it pushes `old` onto a retire list, which is reclaimed at the next retire (when not in use) and at engine shutdown.

**M95 — Replay stop-and-ack (FR-RTS-7).** The audio thread sets an atomic `replay_in_use` around its `popBlock()` call, using the same publish-and-recheck pattern as the WAV reader. `replayStart` (while running) and `replayStop` first set `replay_active = false`, wait until `replay_in_use` is false, and only then call `close()`/`open()`. The wait is short and happens on the IPC thread, never on the audio thread. One `SessionPlayer` instance stays.

**M95 — Engine wake-ups (FR-RTS-8).** A single helper `notify_engine(mutate)` takes `mode_mutex`, applies the change (`audio_mode`, `config_generation`, `shutdown`), releases the lock and calls `notify_all()`. It is used by the `config`, `audioMode`, `audioDevice` and `shutdown` handlers, the signal path and the `effect_main()` return. `callback_cv` gets the same treatment. `audioDevice` increments `config_generation`, so the running mode loop exits and re-enters with the new sample rate and buffer size. `shutdown_watcher` notifies under each mutex, in a loop, until an atomic `engine_exited` flag is set.

**Verification.** The C++ changes add runtime tests to the existing native suite and TSAN/ASAN stress targets (WAV swap loop, double `replayStart`, two-thread LED/MIDI pushes, start/shutdown loop). These run in the macOS emulator CI job.
