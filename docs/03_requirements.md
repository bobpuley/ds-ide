# 03 — Requirements (v12)

> **v11 complete** — all v11 requirements implemented; ACs green.
> Archived: [`docs/v11/03_requirements.md`](v11/03_requirements.md).

## v12–v13 Requirements

All requirements below are derived from the 2026-07-02 code review findings. See `01_input-ideas.md` for the raw bug list and `02_assumptions-and-risks.md` for the assumptions each requirement corrects.

---

### Emulator Correctness & Robustness (v12 / M38)

**FR-EMU-1 — Short replay blocks do not leak stale samples**
`SessionPlayer::nextBlock()` zero-fills `buf + to_read*2 .. frames*2` whenever the recorded block is shorter than the requested frame count; a `replay_rate_mismatch` event is emitted when header `block_size`/`sample_rate` diverge from the engine config.
AC: replaying a `.dsrec` recorded at a smaller block size than the current engine block size produces silence (not stale samples) in the unread tail of every block; deterministic replay produces identical output across two runs.
*(Depends on FR-RTS-3's replay-path restructuring landing first — see `02_assumptions-and-risks.md`.)*

**FR-EMU-2 — Scope/spectrum IPC messages never exceed the SPSC slot size**
The scope sample budget is derived from `SpscIpcQueue::MAX_MSG` rather than a fixed block count (decimating more aggressively for large hardware frame sizes), or `push()` truncates and counts an over-size message as a drop. A debug assert enforces `msg.size() <= MAX_MSG`.
AC: running at a 4096-frame hardware buffer produces no heap reallocation inside `push()`; the debug assert never fires in a 5-minute soak test across buffer sizes from 64 to 4096.

**FR-EMU-3 — CoreAudio setup and render failures are surfaced, not silently swallowed**
Every `OSStatus` from setup calls (`EnableIO`, format set, device selection, buffer-size set) is checked; on failure the device `stop()`s and returns `false`. `AudioUnitRender` failures increment an atomic error counter drained alongside xruns and surfaced as an IPC event. The queried input `mSampleRate` is compared against the engine rate, emitting `sample_rate_mismatch` when they diverge.
AC: forcing a CoreAudio setup call to fail (test harness or unplugged device) produces a `realtime_unavailable` event instead of silent misconfiguration; a mismatched input sample rate produces a `sample_rate_mismatch` IPC event.

**FR-EMU-4 — Recorder write failures produce a diagnosable, non-silent result**
Any `writeBytes` failure in `flushPending`/`drainLoop` sets an atomic `write_error_` flag, stops draining, and pushes a `record_error` IPC event. `recordStop` reports final status (block count / error) over IPC.
AC: simulating ENOSPC during a recording session produces a `record_error` event and `recordStop` reports the failure rather than a false success.

**FR-EMU-5 — WAV files are validated before being fully buffered**
`load_wav_file` reads and validates the first 12 bytes (`RIFF`/`WAVE` magic) before allocating for the full file; a hard file-size ceiling (e.g. 256 MB) is enforced with checked `fseek`/`ftell`/`fstat`.
AC: selecting a non-WAV multi-GB file produces an immediate, bounded-memory error instead of a multi-GB transient allocation.

**FR-EMU-6 — IPC JSON handling is structurally correct**
Key lookup does not match inside string values; all interpolated output values pass through a `json_escape()` helper (or the codebase adopts a minimal structural JSON tokenizer for the bounded message vocabulary).
AC: a `wavFile` path containing a literal `"type":` substring parses correctly; exception text containing quotes/backslashes produces valid JSON in outbound events.

**FR-EMU-7 — Runtime audio configuration changes take effect without a restart**
`sample_rate`/`block_size` are re-read from `g_state` at the top of each outer engine loop iteration; the `config` IPC handler notifies `mode_cv` (as `audioDevice` already does) so the active mode loop restarts with fresh values.
AC: sending a `config` message with a new sample rate mid-session changes WAV playback rate and FFT bin labeling within one engine loop iteration; `status` replies always match actual engine behavior.

**FR-EMU-8 — Recording data is not lost on process shutdown**
`SessionRecorder` gets a destructor that calls `stop()`; `main` calls `g_state.recorder.stop()` after `effect_main()` returns; SIGTERM/SIGINT handlers set `g_state.shutdown` via an async-signal-safe atomic store.
AC: killing the emulator process via the IDE's normal stop path while recording is active produces a `.dsrec` file with a valid `END` marker and no un-drained trailing blocks.

---

### IPC & Data Validation Hardening (v12 / M39)

**FR-IPC-1 — Deploy's IPC connect phase has a bounded timeout**
The deploy timeout stays active through `connectIpc()` completion — `resolved` is not set until the connect phase settles, or `IpcClient.connect()` carries its own timeout via `Promise.race`.
AC: an emulator that announces its socket but never accepts the connection causes `deploy()` to reject within a bounded time (e.g. 5 s) rather than hanging forever; the deploy lock clears and a subsequent deploy attempt can proceed.

**FR-IPC-2 — IPC messages are validated at the socket boundary before use**
A discriminated-union schema for the IPC protocol is validated in `narrow.ts` (or equivalent) at the point messages are parsed. Only explicitly whitelisted, typed fields are forwarded to webviews — never an object spread of the raw message. Webviews render status text via `textContent`, never `innerHTML`, and guard `typeof` before calling string methods on message fields (e.g. `msg.kind`).
AC: a malformed or version-skewed IPC message produces a logged rejection, not a webview exception or markup injection; `grep -rn '\.\.\.msg' src/webview src/sidebar` returns no matches in message-forwarding code.

**FR-IPC-3 — `editorSave` validates webview payload shape before use**
`m['cfg']` is structurally validated (arrays present, items are well-formed objects) before being passed to `serializeControllerConfig`, or the serialize/parse round trip is wrapped in try/catch with a user-visible warning. Serialized `id` fields are quoted via `yamlQuote` (or restricted to a `/^[A-Za-z_]\w*$/` allowlist) on both serialization and editor input.
AC: posting `{ cfg: { pots: [{}] } }` from a webview does not throw inside the extension host message handler; an id containing `:` or `#` is rejected or safely escaped, never silently changed on round-trip.

**FR-IPC-4 — `controllers.yaml` read failures are distinguished from an absent file**
`loadControllerConfig` treats `ENOENT` as "no config" but surfaces a warning and marks the config `unreadable: true` for any other error (`EACCES`, `EMFILE`, encoding). Save paths refuse to write while `unreadable: true`.
AC: a simulated transient read error followed by a save action does not overwrite `controllers.yaml`; the user sees a warning distinguishing "no config" from "couldn't read config."

**FR-IPC-5 — Wiring edits report failure and keep views consistent**
The `WorkspaceEdit` boolean result from wire/unwire operations is checked; `false` surfaces an error instead of proceeding as if it succeeded. After a successful edit, either the document is saved or `buildControlsConfig` consumes the already-known in-memory text instead of re-reading disk. `makeBlockEdit`'s marker search safely handles a duplicated marker line (reject or full-file fallback with confirmation, not a silent wrong-range edit).
AC: forcing `applyEdit` to return `false` surfaces a visible error and does not update the Wiring/Controls views; after a successful wire operation, both views reflect the same state without requiring a manual save.

**FR-IPC-6 — Webview scripts are type-checked and unit-tested**
`@ts-nocheck` is removed from `controls-webview.ts`, `scope-webview.ts`, and `wiring-webview.ts`; webviews get their own `tsconfig.webview.json` (`lib: ["ES2022", "DOM"]`). The host↔webview message protocol is a shared discriminated union imported by both sides. `tsc --noEmit` covers `src/test`.
AC: `npm run typecheck` type-checks all webview scripts and the test directory with zero suppressions; at least the knob-math, id-validation, and wired-pin state-transition logic are extracted into tested, non-DOM modules with unit test coverage.

**FR-IPC-7 — Deploy sequencing has a single implementation**
The post-deploy state replay sequence (`sendPotSnapshot`, `sendButtonSnapshot`, `sendSine`, `sendAudioMode`, `sendAudioDevice`, WAV state) exists in exactly one place, called identically by `ds-ide.deploy` and `ds-ide.debug`.
AC: `grep -n sendPotSnapshot src/extension.ts` (or its extracted successor) shows a single call site; `activate()` shrinks by extracting a `DeployCoordinator` and `SessionState` object.

---

### Extension UX & Workspace Safety (v12 / M40)

**FR-UX-1 — Output channels are created once and tracked**
The `"Daisy IDE Flash"` channel (and `buildForHardware`'s fallback channel) is created once in `activate()`, registered in `context.subscriptions`, and passed into command handlers rather than created per-invocation.
AC: flashing to hardware 10 times in one session leaves exactly one `"Daisy IDE Flash"` entry in the Output panel dropdown.

**FR-UX-2 — Notifications are proportionate to what happened**
YAML validation errors are aggregated into a single warning (or published to a `DiagnosticCollection` with no toast) and deduplicated across repeated saves. `EmulatorManager` exposes connection state; transport commands show a warning instead of a false "started/stopped" toast when disconnected. Routine build/deploy successes rely on the status bar, not an additional toast.
AC: a `controllers.yaml` with 5 validation errors produces at most one toast per distinct error set, not one per save; triggering `startAudio` with no emulator connected shows a "no emulator running" warning, never a false success toast.

**FR-UX-3 — Wiring Editor edits stay inside the workspace**
`findEffectSource` rejects a configured `effectSource` path that resolves outside any workspace folder, with an actionable error. The full-file-replacement fallback in `makeBlockEdit` is replaced by a one-time modal confirmation before appending marker blocks to a file that has none; no edit rewrites lines outside the marker ranges once markers exist.
AC: a workspace-committed `settings.json` pointing `effectSource` outside the workspace produces an error, not a silent edit; a file missing marker blocks requires a user confirmation before the first block is appended.

**FR-UX-4 — Multi-root workspace behavior is correct, not just disclosed**
The save-listener's "is this file in our project" check uses `vscode.workspace.getWorkspaceFolder(doc.uri)` (or a prefix check that respects `path.sep` boundaries) instead of a raw `startsWith`. Project-root resolution is centralized in one helper; when multiple folders exist, the active folder is user-selectable (quick-pick, persisted in `workspaceState`) rather than always folder 0.
AC: a save in a sibling directory sharing a path prefix with the active project folder does not trigger ds-ide's save-listener logic; a user in a multi-root workspace can select which folder ds-ide operates on.

**FR-UX-5 — Real-time control interactions do not flood persisted storage**
`workspaceState` writes from pot/slider drags are debounced (flushed on `mouseup` or ~250 ms idle) while IPC sends continue at input rate. Webview-side mousemove handlers coalesce updates with `requestAnimationFrame`.
AC: a 5-second continuous knob drag produces at most ~20 `workspaceState.update` calls (not one per mousemove); IPC responsiveness during the same drag is unchanged from today's behavior.

---

### Emulator Code Quality & Hygiene (v13 / M41)

**FR-QA-EMU-1 — Reported latency is either real or honestly labeled**
`lastLatencyMs()` either sums measured `kAudioDevicePropertyLatency` + safety offset + buffer frames for input/output, or the IPC field is renamed `estimatedMs` to stop implying a measurement.

**FR-QA-EMU-2 — `CoreAudioDevice` cannot be double-freed via accidental copy**
`Impl*` is replaced with `std::unique_ptr<Impl>`; copy constructor/assignment are explicitly deleted.

**FR-QA-EMU-3 — `StartAudio` registration reflects the most recent call**
Each `StartAudio` overload nulls the other callback pointer; `use_block` is re-evaluated per block (callback pointers made `std::atomic`); a warning event fires if `StartAudio` is called more than once.

**FR-QA-EMU-4 — `System::Delay` does not accumulate drift**
`Delay(ms)` computes an absolute deadline and sleeps to `min(deadline, now + 1ms)` per iteration instead of a fixed 1ms-per-iteration loop.

**FR-QA-EMU-5 — Pot values from IPC are physically plausible**
The `pot`/`potSnapshot` handlers clamp to `[0, 1]` and reject non-finite (`NaN`/`Inf`) values, matching the existing `outputVolume` handler's behavior.

**FR-QA-EMU-6 — `json_get` decodes standard JSON escapes**
The string-value scanner translates `\n \t \r \b \f \" \\ \/` and decodes or rejects `\uXXXX`, instead of dropping the backslash.

**FR-QA-EMU-7 — `PrintLine` is format-checked and hardware-faithful**
The declaration gains `__attribute__((format(printf, 2, 3)))`; output emits `\r\n` to match hardware.

**FR-QA-EMU-8 — Runtime code builds with optimization and stronger warnings**
`effect_obj` keeps `-O0 -g`; `RUNTIME_SRC`/`SHIM_SRC` build at `-O2 -g`; `-Wextra -Wshadow` are added to both targets and any resulting warnings are fixed.

---

### Extension/Tooling Polish (v13 / M42)

**FR-QA-EXT-1 — Webview and extension bundles use platform-appropriate esbuild configs**
`esbuild.js` is split into an extension config (`platform: 'node'`, `external: ['vscode']`) and a webview config (`platform: 'browser'`, `format: 'iife'`).

**FR-QA-EXT-2 — IPC client failures are observable**
`IpcClient.send()` emits a counted warn-level event when the socket is absent/destroyed; malformed JSON lines are logged, not silently discarded; a receive-buffer overflow resynchronizes to the next `\n` instead of resuming mid-fragment.

**FR-QA-EXT-3 — dfu-util success detection is version-robust**
The non-zero-exit-code success path accepts only the specific known code(s) for "download OK, device left DFU mode"; the output-string match remains a secondary signal only, with a comment pinning the dfu-util versions verified.

**FR-QA-EXT-4 — The YAML parser and project scaffold agree on section names**
Non-blank, non-comment lines matching no parser rule produce a parse error instead of silent skipping; `create-effect-project.ts`'s scaffolded file uses a key the parser actually reads (`controllers:`, not `controls:`).

**FR-QA-EXT-5 — Toolchain/type hygiene matches the actual runtime**
`@types/node` is pinned to `^18` (matching the `node18` esbuild target); `which`-shelling via `cp.exec` is replaced with `execFile`; duplicated knob geometry constants are hoisted to one shared location; `buildForHardware`'s output-channel parameter is required, not defaulted.

**FR-QA-EXT-6 — Marketplace metadata is internally consistent**
`package.json`'s `version` matches the latest CHANGELOG entry; the referenced icon asset exists; unused or missing icon theme variants are resolved (used or deleted); keybindings gain `when`/`enablement` gates scoped to Daisy projects.

**FR-QA-EXT-7 — Extension Host command paths avoid synchronous I/O**
`mkdirSync`, `readdirSync`, `statSync` in command paths are replaced with `fs.promises` equivalents; `ScopePanel.show()` posts current state on reveal instead of regenerating `webview.html` (which discards scope/spectrum history).

**FR-QA-EXT-8 — Machine/workspace-specific settings declare the correct scope**
`armToolchainPath` declares `"scope": "machine-overridable"`; `effectSource` declares `"scope": "resource"` (or documents its `window`-scope resolution order); both gain `markdownDescription`.

**FR-QA-EXT-9 — The debug contribution is discoverable and responsive**
`daisy-debug` is marked internal or gains a configuration snippet; the build+deploy step inside `resolveDebugConfiguration` reports progress via `vscode.window.withProgress`; lldb-dap discovery extends to versioned Linux binary names on PATH.
