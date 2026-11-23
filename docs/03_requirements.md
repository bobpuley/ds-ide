> **v27 complete** — archived to `docs/v27/` on 2026-11-23. This file now seeds v28 planning.

# 03 — Requirements (v28)

> **v23 complete** — all v23 requirements implemented; ACs green.
> Archived: [`docs/v23/03_requirements.md`](v23/03_requirements.md).
>
> **v24 complete** — all v24 requirements implemented; ACs green.
> Archived: [`docs/v24/03_requirements.md`](v24/03_requirements.md).
>
> **v25 complete** — all v25 requirements implemented; ACs green.
> Archived: [`docs/v25/03_requirements.md`](v25/03_requirements.md).
>
> **v26 complete** — all v26 requirements implemented; ACs green.
> Archived: [`docs/v26/03_requirements.md`](v26/03_requirements.md).
>
> **v27 complete** — all v27 requirements implemented; ACs green.
> Archived: [`docs/v27/03_requirements.md`](v27/03_requirements.md).

## Review fixes — HIGH findings (intake 2026-11-23)

Source: `01_input-ideas.md`, 2026-11-23; `docs/06_*_review.md` (review of `f453269`, 2026-11-21). Milestones: **M93** (fix first), **M94** (daily use), **M95** (real-time concurrency). Each requirement below states behaviour the product already promises (cited in brackets) but does not deliver: these are known gaps, not new features.

### Extension robustness (M93)

**FR-IPC-8 — The IPC whitelist accepts only its own message types.** [Gap in FR-IPC-2.] `parseIpcMessage` resolves a narrower only for a `type` that is an own entry of the whitelist; inherited object keys (`constructor`, `__proto__`, `toString`, `valueOf`, `hasOwnProperty`, …) return `undefined`. An exception while parsing, narrowing or emitting one line is caught, the line is counted as malformed (with the same warning as other malformed lines), and the remaining lines of the chunk are still processed.

**FR-DBG-1 — The lldb-dap proxy survives a dead backend.** [Gap in FR-UX-7.] An `error` event on the lldb-dap child's `stdin` or `stdout` is logged to the debug output channel and never thrown. When the child exits, the proxy sends exactly one DAP `terminated` event, and every later message from VS Code is dropped without writing. Writes are skipped when `stdin` is not writable.

**FR-DBG-2 — A failed run-session launch is answered.** [Gap in FR-TRN-*.] When `rebuildAndDeploy` or `attachDebugger` rejects during a `launch` request, `RunSessionAdapter` answers the request with `success: false` and the error message, stops the emulator it started, and sends `terminated`. No unhandled promise rejection reaches the Extension Host.

**Acceptance criteria**

- AC-IPC-8: unit tests feed `constructor`, `__proto__`, `toString`, `valueOf` and `hasOwnProperty` lines to `parseIpcMessage` and get `undefined`; an `IpcClient` test with a narrower that throws shows the next line in the same chunk is still emitted.
- AC-DBG-1: with a fake child, emitting `error` on `stdin` throws nothing; emitting `exit` produces one `terminated` event, and a later `handleMessage` writes nothing.
- AC-DBG-2: with a fake host whose `rebuildAndDeploy` rejects, the adapter emits a failed `launch` response and a `terminated` event, and the test sees no unhandled rejection.

### Daily-use correctness (M94)

**FR-WE-13 — Wiring and peripheral edits apply to the current text.** [Gap in FR-AIG-6 and the Wiring Editor's source-of-truth rule.] The source-mutating Wiring Editor actions (`wirePin`, `unwirePin`, `moveControl`, `setPeripheralEnabled`, and `placeControl`) run one at a time, in the order they arrive. Each one reads the effect source after the previous one has been applied. If the document version changes between reading the text and applying the edit (another action, the user, git or a coding agent), the edit is recomputed from the new text or refused with a "the file changed, try again" message; it is never applied to stale ranges. Any confirmation prompt is shown before the text used for the edit is read. After the edit the file is saved only if it had no unsaved changes before the edit; otherwise it is left dirty.

**FR-EMU-12 — The audio callback receives the configured block size.** [Gap in the north-star goal of reproducing hardware behaviour relevant to effect development.] In every audio mode (headless, simulated with an output device, real-time), every call of the effect's audio callback passes exactly the block size set with `SetAudioBlockSize()` (default 48), whatever frame count the host audio device delivers. `AudioCallbackRate()` therefore matches the real callback rate. The device buffer size can stay larger than the block size.

> ⚠️ ASSUMPTION: up to one extra block of latency (1 ms at 48 frames, 48 kHz) from re-blocking is acceptable in the emulator; it is not reported to the effect.

**FR-EMU-13 — LED and MIDI output is safe from any thread.** [Gap in FR-EMU-9.] The LED APIs (`DaisySeed::SetLed`, `Led::Update`, `RgbLed::Update`) and the MIDI send APIs (`MidiUartHandler::SendMessage`, `MidiUsbHandler::SendMessage`) may be called concurrently from the effect's main loop and from the audio callback, with no data race and no allocation or blocking on the audio thread. They differ in what they promise:
- **LEDs are state.** The extension receives the latest value of each LED; intermediate values set between two telemetry samples may be skipped, and an LED update can never be lost because a queue is full.
- **MIDI is an event stream.** Every message is delivered, in the order it was sent from each thread; messages sent from two threads are delivered in one total order. If the stream's fixed capacity is exceeded, the dropped messages are counted and reported; they are never silently lost or corrupted.

**Acceptance criteria**

- AC-WE-13: a test runs two wiring actions concurrently against the same document and gets both edits in the source; a test that changes the document between read and apply gets a recomputed edit or the refusal message, never a corrupted block; a test with a dirty document shows it stays dirty after the edit.
- AC-EMU-12: a runtime test sets block sizes 4, 48 and 512 with a device delivering 256 frames (and a varying count) and asserts every callback receives exactly the configured size; the output stream has no gaps or repeated frames.
- AC-EMU-13: a TSAN stress test calls `Led::Update` and `SendMessage` from two threads in a tight loop and reports no race; every MIDI message arrives intact, in per-thread order, or is counted as dropped; the final LED value received equals the last one set.

> ⚠️ ASSUMPTION: the MIDI stream already counts and reports drops when full (as the IPC queue does); if not, M94 adds the counter.

### Real-time concurrency (M95)

Each fix in this group is verified with a TSAN stress test in addition to its unit or runtime test.

**FR-RTS-6 — A WAV can be swapped or cleared during playback without use-after-free.** [Gap in FR-RTS-3.] A `WavData` buffer is freed only after the audio thread is known not to be reading it. The audio thread's publish-and-check of the buffer in use leaves no window in which the IPC thread can free it, and no timeout ever frees a buffer unconditionally; a buffer that cannot yet be freed is kept and reclaimed later (at the next swap or at shutdown).

**FR-RTS-7 — Restarting a replay never races the audio thread.** [Gap in FR-RTS-3.] `replayStart` while a replay is running, and `replayStop`, change the `SessionPlayer` (close, open, index reset) only after the audio thread has confirmed it is not inside `popBlock()`. The replay that starts is played from its first block, with no data from the previous session.

**FR-RTS-8 — Engine state changes are never missed.** Every change read by the audio engine's wait conditions (`audio_mode`, `config_generation`, `shutdown`, the callback being set) is made under the condition variable's mutex, or followed by a notification under it, so no wake-up is lost. Shutdown always ends the audio thread and flushes telemetry without needing SIGKILL. An `audioDevice` change (sample rate, buffer size) always takes effect, whether it arrives before or after the `audioMode` message, and the sample rate the effect sees always equals the device's.

**Acceptance criteria**

- AC-RTS-6: a TSAN/ASAN stress test swaps and clears WAV files in a tight loop during playback with no use-after-free or race report.
- AC-RTS-7: a TSAN test sends `replayStart` twice in rapid succession, and `replayStart` then `replayStop`, during playback, with no race report; the second replay starts from block 0.
- AC-RTS-8: a test sends `audioMode` and `audioDevice` back to back (both orders) and asserts the device opens with the new values; a stress test repeats start → shutdown many times and the process always exits on its own within the shutdown timeout.
