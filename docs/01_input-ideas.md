> **v27 complete** — archived to `docs/v27/` on 2026-11-23. This file now seeds v28 planning.

# 01 — Input Ideas (v28)

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
>
> **v6 complete** — archived to `docs/v6/` on 2026-06-21. Full v6 ideas archived in
> [`docs/v6/01_input-ideas.md`](v6/01_input-ideas.md).
>
> **v7 complete** — archived to `docs/v7/` on 2026-06-21. Full v7 ideas archived in
> [`docs/v7/01_input-ideas.md`](v7/01_input-ideas.md).
>
> **v8 complete** — archived to `docs/v8/` on 2026-06-22. Full v8 ideas archived in
> [`docs/v8/01_input-ideas.md`](v8/01_input-ideas.md).
>
> **v9 complete** — archived to `docs/v9/` on 2026-06-29. Full v9 ideas archived in
> [`docs/v9/01_input-ideas.md`](v9/01_input-ideas.md).
>
> **v10 complete** — archived to `docs/v10/` on 2026-06-30. Full v10 ideas archived in
> [`docs/v10/01_input-ideas.md`](v10/01_input-ideas.md).
>
> **v11 complete** — archived to `docs/v11/` on 2026-07-04. Full v11 ideas archived in
> [`docs/v11/01_input-ideas.md`](v11/01_input-ideas.md).
>
> **v12 complete** — archived to `docs/v12/` on 2026-07-05. Full v12 ideas archived in
> [`docs/v12/01_input-ideas.md`](v12/01_input-ideas.md).
>
> **v13 complete** — archived to `docs/v13/` on 2026-07-05. Full v13 ideas archived in
> [`docs/v13/01_input-ideas.md`](v13/01_input-ideas.md).
>
> **v14 complete** — archived to `docs/v14/` on 2026-07-22. Full v14 ideas archived in
> [`docs/v14/01_input-ideas.md`](v14/01_input-ideas.md).
>
> **v15 complete** — archived to `docs/v15/` on 2026-07-25. Full v15 ideas archived in
> [`docs/v15/01_input-ideas.md`](v15/01_input-ideas.md).
>
> **v16 complete** — archived to `docs/v16/` on 2026-07-25. Full v16 ideas archived in
> [`docs/v16/01_input-ideas.md`](v16/01_input-ideas.md).
>
> **v17 complete** — archived to `docs/v17/` on 2026-08-23. Full v17 ideas archived in
> [`docs/v17/01_input-ideas.md`](v17/01_input-ideas.md).
>
> **v18 complete** — archived to `docs/v18/` on 2026-08-25. Full v18 ideas archived in
> [`docs/v18/01_input-ideas.md`](v18/01_input-ideas.md).
>
> **v19 complete** — archived to `docs/v19/` on 2026-08-27. Full v19 ideas archived in
> [`docs/v19/01_input-ideas.md`](v19/01_input-ideas.md).
>
> **v20 complete** — archived to `docs/v20/` on 2026-08-30. Full v20 ideas archived in
> [`docs/v20/01_input-ideas.md`](v20/01_input-ideas.md).
>
> **v21 complete** — archived to `docs/v21/` on 2026-08-30. Full v21 ideas archived in
> [`docs/v21/01_input-ideas.md`](v21/01_input-ideas.md).
>
> **v22 complete** — archived to `docs/v22/` on 2026-09-30. Full v22 ideas archived in
> [`docs/v22/01_input-ideas.md`](v22/01_input-ideas.md).
>
> **v23 complete** — archived to `docs/v23/` on 2026-09-30. Full v23 ideas archived in
> [`docs/v23/01_input-ideas.md`](v23/01_input-ideas.md).
>
> **v24 complete** — archived to `docs/v24/` on 2026-10-03. Full v24 ideas archived in
> [`docs/v24/01_input-ideas.md`](v24/01_input-ideas.md).
>
> **v25 complete** — ds-ide 0.25.0-win.1–0.25.0-win.8 (M77–M84), Windows support, all ACs green. Full v25 ideas archived in
> [`docs/v25/01_input-ideas.md`](v25/01_input-ideas.md).
>
> **v26 complete** — ds-ide 0.24.4–0.25.0 (M85–M91), the first public preview, all ACs green. Full v26 ideas archived in
> [`docs/v26/01_input-ideas.md`](v26/01_input-ideas.md).
>
> **v27 complete** — ds-ide 0.25.1 (M92), AI agent guide, all ACs green. Full v27 ideas archived in
> [`docs/v27/01_input-ideas.md`](v27/01_input-ideas.md).

## v28 ideas

- **Bug intake — HIGH findings of the 2026-11-21 code reviews (2026-11-23).** Source: `docs/06_emulator_review.md`, `docs/06_nodejs_review.md`, `docs/06_vscode_extension_review.md` (review of `f453269`). Owner's grouping into three milestones:
  - **Fix first (cheap, high value):**
    - #6 IPC whitelist bypass. Observed: `parseIpcMessage` looks up `type` on a plain object, so `"constructor"` returns the raw message as valid and `"__proto__"` throws inside the socket `data` handler. Expected: only the whitelisted types pass; a bad line is counted as malformed and the read loop continues.
    - #7 lldb-dap proxy. Observed: no `error` listener on the child's `stdin`/`stdout` and `exit` ignored, so a crashed lldb-dap gives an uncaught EPIPE in the Extension Host and a debug session that stays "running". Expected: the error is logged, a `terminated` event is sent, and later writes are no-ops.
    - #8 `RunSessionAdapter.launch()`. Observed: run as a floating promise, so a deploy or `startDebugging` failure is an unhandled rejection and the launch request is never answered. Expected: VS Code gets a failed launch response and a `terminated` event.
  - **Most likely to hit in daily use:**
    - #9 Wiring Editor edits. Observed: ranges are computed from a stale snapshot and the handlers are not serialized, so two quick actions, or an outside change, corrupt the effect source; `doc.save()` also saves unrelated unsaved edits. Expected: each edit applies to the current text, or is refused.
    - #1 Block size. Observed: with a real audio device the effect is called with the device's frame count (≥256), not `SetAudioBlockSize()`, so per-callback timing is wrong and `float tmp[kBlockSize]` arrays overflow. Expected: every callback gets exactly the configured block size, as on hardware.
    - #5 LED/MIDI telemetry queues. Observed: assumed single-producer, but `Led::Update`/`SetLed`/`SendMessage` are also called from the audio callback, so two threads race on a `std::string` slot. Expected: calling them from any thread is safe.
  - **Harder, real-time concurrency (verify with TSAN stress tests):**
    - #3 WAV swap. Observed: the hazard-pointer protocol has a load→publish window, and the 200 ms timeout deletes unconditionally, so a WAV can be freed while the audio thread reads it. Expected: no use-after-free when a WAV is swapped or cleared during playback.
    - #4 Replay restart. Observed: `replayStart` during a replay runs `close()`/`open()` while the RT thread is inside `popBlock()` (data race, index underflow). Expected: the restart waits until the consumer has stopped.
    - #2 Engine wake-ups. Observed: config and shutdown changes notify without holding the mutex, so wake-ups are lost (shutdown can hang); `audioDevice` changes don't bump `config_generation`, so whether they apply depends on timing. Expected: no lost wake-ups, and device changes always apply.
