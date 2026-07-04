# 01 — Input Ideas (v11)

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

## v11–v13 Planning — Bug Reports from Code Review (2026-07-02)

The three automated code reviews (`docs/06_emulator_review.md`, `docs/06_nodejs_review.md`, `docs/06_vscode_extension_review.md`) produced 46 distinct findings after merging duplicates independently flagged by both the Node.js/TS review and the VS Code extension review (the deploy-lock unhandled rejection, the stale-PID kill, and the unvalidated-IPC-forwarded-to-webview finding each appeared in two reports and are logged once below).

Grouping: spread across three versions by severity tier — **v11 = all HIGH findings**, **v12 = all MEDIUM findings**, **v13 = all LOW findings** — with milestones inside each version split by subsystem (emulator C/C++ vs. extension/IPC TypeScript). This mirrors the v9 bugfix intake, scaled to multiple versions per this intake's instruction to spread tasks across versions.

---

### v11 / M36 — Emulator RT & Memory Safety Critical Fixes (emulator HIGH)

- **Bug (HIGH):** Duplex render callback allocates `inputBufList` for exactly `bufferSize` frames, but CoreAudio's `inNumberFrames` can exceed `bufferSize` (hardware minimum clamping) — the callback's `memset`/`AudioUnitRender` write past the `malloc`'d buffer.
  *Observed:* Heap corruption on the RT thread, reachable via a small `bufferSize` IPC config (as low as 1).
  *Expected:* `inputBufList` sized for the maximum possible frame count; callback clamps writes to the allocated size.

- **Bug (HIGH):** `start()`/`start_output_only()` call `AudioOutputUnitStart()` and only afterward resize the render callback's work buffers (`in_interleaved`, `out_interleaved`, `silentInput`, `workOut`) — the RT callback can already be running concurrently when the control thread reallocates them.
  *Observed:* Use-after-free / torn pointer reads on the RT thread; intermittent, load-dependent crash.
  *Expected:* All callback-visible buffers sized before `AudioOutputUnitStart()`.

- **Bug (HIGH):** In simulated mode with an output device, `process_one_block` runs inside the CoreAudio render callback and performs blocking `::read()`/`::lseek()` via `SessionPlayer::nextBlock()`, heap-allocates a per-block `std::vector<ReplayEvent>`, and can free a multi-MB `WavData` on the RT thread when the IPC thread swaps files under `wav_mutex`. The IPC thread also holds `player_mutex` across a full-file `countBlocks()` scan.
  *Observed:* Priority inversion, multi-hundred-ms audio dropouts when a replay start coincides with rendering — violates the project's own RT-safety rules.
  *Expected:* Replay audio fed through a pre-filled lock-free SPSC ring (mirroring `SessionRecorder`); `wav_mutex` + `shared_ptr` copy replaced with atomic pointer swap; work buffers pre-sized before device start.

- **Bug (HIGH):** `SessionRecorder::enqueueBlock()` (RT thread, no lock) loads `active_` with `memory_order_relaxed`, which does not synchronize with the `memory_order_release` store at the end of `start()` — on Apple Silicon's weak memory model, the RT thread can observe `active_ == true` before observing initialized ring-buffer slots and `memcpy` through a stale pointer. `stop()` can also complete mid-`enqueueBlock`, silently dropping or misfiling blocks.
  *Observed:* Data race (UB); potential crash or corrupted first recording blocks; lost/misfiled blocks at session boundaries.
  *Expected:* `enqueueBlock()` loads `active_` with `memory_order_acquire`; slot vectors allocated once in the constructor; stop/start overlap closed with a generation counter or `in_use` flag.

- **Bug (HIGH):** `SessionRecorder::start()` does not guard against being called while already active — a duplicate `recordStart` IPC message assigns to a still-joinable `drain_thread_`, which calls `std::terminate()` and aborts the whole emulator process. The old fd also leaks and the old drain thread corrupts the new file's header before the abort.
  *Observed:* A single duplicate IPC message crashes the emulator and kills the user's debug session.
  *Expected:* `start()` rejects re-entry (`if (active()) return false;`) with a `record_error` IPC reply; defense-in-depth join-before-assign on `drain_thread_`.

---

### v11 / M37 — Extension/IPC Critical Reliability & Packaging (merged HIGH)

- **Bug (HIGH):** `EmulatorManager.deploy()` clears its coalescing lock via `deployPromise.finally(() => { this.deployLock = null; })`. `.finally()` returns a *new* promise whose rejection is never observed — every failed deploy (build not run, emulator crash, socket timeout) produces an unhandled promise rejection in the Extension Host. *(Independently flagged by both the Node.js and VS Code extension reviews.)*
  *Observed:* `UnhandledPromiseRejection` on every deploy failure — an expected, common path.
  *Expected:* The derived promise is observed (`.catch(() => {})` or equivalent) so cleanup never leaves a rejected promise dangling.

- **Bug (HIGH):** Stale-process and socket lifecycle has no ownership checks: `killStalePid` sends `SIGKILL` to whatever PID is in `emu.pid` with no verification it's still an `effect_emu` process (PID reuse after reboot can kill an arbitrary user process); on activation the extension deletes *every* `/tmp/daisy_emu_*.sock`, severing other concurrently running VS Code windows' live emulator connections; socket names (`daisy_emu_${Date.now()}.sock`) are predictable in world-writable `/tmp`, enabling local squatting/DoS. `/tmp` is also hardcoded instead of `os.tmpdir()`. *(Independently flagged by both the Node.js and VS Code extension reviews.)*
  *Observed:* Worst case, an arbitrary user process is force-killed after a reboot; second-window activation breaks the first window's emulator session.
  *Expected:* PID identity verified (process name/command-line match) before SIGKILL, with SIGTERM-first escalation; sockets live under a per-workspace directory with random names; cleanup scoped to sockets this workspace owns.

- **Bug (HIGH):** `buildForEmulator` resolves the emulator CMake project from `path.join(extensionPath, 'emulator')`, but `.vscodeignore` excludes `emulator/**` from the packaged `.vsix` and nothing copies emulator sources into the package. `package.json` also declares a non-existent `images/icon.png`, so `vsce package` fails outright.
  *Observed:* Every user installing the published extension gets a build that fails "Build for Emulator" / "Build & Deploy" / F5 debugging — total failure of the core workflow, uncaught by any test (tests run against the repo checkout).
  *Expected:* `emulator/**` (minus build outputs) included in the package; a packaging smoke test asserts `emulator/CMakeLists.txt` and `dist/extension.js` are present in the `.vsix`; the icon asset exists or the field is removed.

- **Bug (HIGH):** The Wiring Editor generates `hardware.adc.Init(pot1, pot2, ..., N)` — separate variadic arguments — which only compiles against a shim-only catch-all `Init(Args...)` overload added to paper over the mismatch. Real libDaisy's `AdcHandle::Init` takes `(AdcChannelConfig* cfg, size_t num_channels)`, an array pointer.
  *Observed:* Any project with a wired pot fails `ds-ide.buildHardware` with confusing template/overload errors — breaks the emulator↔hardware parity that is the product's core promise.
  *Expected:* Generated code declares `AdcChannelConfig ds_ide_adc_cfg[N]`, calls `.InitSingle(...)` per pot, and `hardware.adc.Init(ds_ide_adc_cfg, N)` — the canonical libDaisy pattern; the shim's variadic overload is removed so emulator and hardware compile the same source.

---

### v12 / M38 — Emulator Correctness & Robustness (emulator MEDIUM)

- **Bug (MEDIUM):** `SessionPlayer::nextBlock()` reads `min(frames, block_size_)` into the caller's buffer but never zero-fills the tail when the recorded block size is smaller than the engine's current block size — stale samples from the previous block leak into replay.
  *Expected:* Zero-fill `buf + to_read*2 .. frames*2` after a short read; emit a `replay_rate_mismatch` event when header `block_size`/`sample_rate` diverge from the engine config.

- **Bug (MEDIUM):** Scope/spectrum JSON size scales with the actual hardware frame count and can reach ~900 kB at 4096 frames/block — 30× the pre-reserved `SpscIpcQueue::MAX_MSG` (81,920 bytes) — silently re-enabling RT heap allocation via `slots_[w].msg.assign(m)`.
  *Expected:* Scope sample budget derived from `MAX_MSG` (decimate more aggressively for large frames), or truncate-and-count-as-drop in `push()`; debug assert `msg.size() <= MAX_MSG`.

- **Bug (MEDIUM):** Nearly every CoreAudio setup call's `OSStatus` is discarded (`EnableIO`, format set, device selection, buffer-size set, and `AudioUnitRender` itself); the input format is only queried, never reconciled against the engine's sample rate.
  *Expected:* Check each `OSStatus`; on setup failure, `stop()` and return `false`; on render failure, increment an atomic error counter surfaced as an IPC event; compare input `mSampleRate` to the engine rate and emit `sample_rate_mismatch` if they diverge.

- **Bug (MEDIUM):** `writeBytes()` failures in the recorder drain path (`flushPending`, `drainLoop`) are discarded — on ENOSPC/EIO the drain loop keeps "writing," producing a silently truncated `.dsrec` with no error event.
  *Expected:* On any `writeBytes` failure, set an atomic `write_error_` flag, stop draining, and push a `record_error` IPC event; `recordStop` reports final status.

- **Bug (MEDIUM):** `load_wav_file` allocates and reads the entire file before checking the RIFF magic or the 10-minute sample cap; `fseek`/`ftell` returns are unchecked.
  *Expected:* Validate the first 12 bytes (`RIFF`/`WAVE`) before buffering; enforce a hard file-size ceiling (e.g. 256 MB) with checked `fseek`/`ftell`/`fstat`.

- **Bug (MEDIUM):** The hand-rolled `json_get` locates keys by substring search, matching inside string values (e.g. a `wavFile` path containing `"type":`); outbound JSON splices `e.what()` unescaped into a JSON string, producing malformed JSON on quote/backslash content.
  *Expected:* A minimal structural JSON tokenizer for the bounded message vocabulary, or at minimum: skip string values when scanning for keys, plus a `json_escape()` helper on every interpolated output value.

- **Bug (MEDIUM):** `sample_rate`/`block_size` are captured once at engine start and never refreshed — subsequent `config`/`audioDevice` IPC updates change `g_state` and `status` replies, but the running engine keeps pacing at stale values (wrong WAV playback rate, wrong FFT bin labeling, stale CoreAudio sample rate).
  *Expected:* Re-load `sample_rate`/`block_size` from `g_state` at the top of each outer-loop iteration; have `config` notify `mode_cv` (as `audioDevice` already does) so the active mode restarts with fresh values.

- **Bug (MEDIUM):** No `SessionRecorder::stop()` is called on clean process exit (`g_state`'s destructor destroys a joinable `drain_thread_` → `std::terminate()`); there is no SIGINT/SIGTERM handler, so the common IDE-initiated kill path always drops the recording's `END` marker plus up to 4 MB of un-drained blocks.
  *Expected:* `SessionRecorder` gets a destructor that calls `stop()`; `main` calls `g_state.recorder.stop()` after `effect_main()` returns; SIGTERM/SIGINT handlers set `g_state.shutdown` so IDE-initiated stops still get an `END` marker.

---

### v12 / M39 — IPC & Data Validation Hardening

- **Bug (MEDIUM):** `deploy()`'s 10 s timeout guards only the socket-announcement phase; `resolved = true` is set before `connectIpc()` completes, and `IpcClient.connect()` has no timeout of its own. A wedged emulator that announces its socket but never accepts the connection leaves the coalesced deploy promise pending forever — bricking build/deploy/debug until VS Code restarts.
  *Expected:* Keep the deadline alive through the connect phase (don't set `resolved` until `connectIpc` settles), or give `IpcClient.connect()` its own timeout via `Promise.race`.

- **Bug (MEDIUM):** IPC messages are parsed with bare `JSON.parse` into an untyped `Record<string, unknown>` and mostly forwarded unchecked; `postStatus` object-spreads the entire untrusted message into webview `postMessage` calls, which in the scope webview reaches an `innerHTML` sink (`msg.sampleRate`/`msg.blockSize` interpolated without type-checking) and an unguarded `msg.kind.toUpperCase()`. *(Independently flagged by both the Node.js and VS Code extension reviews — the VS Code review additionally identifies the `innerHTML` injection and `querySelectorAll` selector-injection angles.)*
  *Expected:* A discriminated-union IPC schema validated at the socket boundary (extend `narrow.ts` with per-message-type narrowing); forward only explicitly whitelisted, typed fields to webviews — never `...msg`; webviews use `textContent`, never build `innerHTML` from message data; guard `typeof msg.kind === 'string'` before `.toUpperCase()`.

- **Bug (MEDIUM):** The `editorSave` handler casts the webview payload directly to `ControllerConfig` and feeds it to `serializeControllerConfig`, which dereferences `cfg.pots`/`p.range[0]` without a shape check — a malformed message throws inside the message handler. Separately, serialized `id` values are unquoted (only `label` goes through `yamlQuote`), so an id containing `:`/`#` round-trips to a different id with no error.
  *Expected:* Structurally validate `m['cfg']` before serializing (or wrap the round trip in try/catch with a warning); apply `yamlQuote`/an identifier allowlist to `id` fields on both serialization and editor input.

- **Bug (MEDIUM):** `loadControllerConfig()` treats *any* read failure (including transient `EACCES`/`EMFILE`/encoding errors) as "no config," returning an empty `ControllerConfig` that the editor then displays — pressing "save" while this state is loaded overwrites the user's real `controllers.yaml` with an empty one.
  *Expected:* Distinguish `ENOENT` (legitimately empty) from other errors; on unexpected errors, surface a warning and mark the config `unreadable: true` so save paths refuse to write until a clean load succeeds.

- **Bug (MEDIUM):** Wire/unwire handlers apply a `WorkspaceEdit` and ignore its boolean success result, then rebuild the Controls Editor state by re-reading the effect source **from disk** — on `applyEdit` failure the UI claims success anyway, and even on success the Wiring view (in-memory) and Controls view (disk) disagree until a manual save. `findRange`'s `findIndex` also silently pairs the wrong begin/end marker when a marker line is duplicated.
  *Expected:* Check the `applyEdit` return value and surface an error on `false`; either `await doc.save()` after a successful edit or have `buildControlsConfig` accept the already-known in-memory text; reject or fall back safely when a marker appears more than once.

- **Bug (MEDIUM):** All three webview scripts (`controls-webview.ts`, `scope-webview.ts`, `wiring-webview.ts`, ~1,000 lines) opt out of TypeScript with `@ts-nocheck`, and `tsconfig.json` excludes `src/test` so even the test suite's type errors go unnoticed. This is the highest-churn UI code with no static safety net and no unit tests.
  *Expected:* Remove `@ts-nocheck`; give webviews their own `tsconfig.webview.json`; type the host↔webview message protocol as a shared discriminated union; extract pure webview logic (knob math, id validation, wired-pin state transitions) into checked, testable modules.

- **Bug (MEDIUM):** `extension.ts`'s `activate()` is a 396-line function wiring every subsystem via nested closures over shared mutable state; the post-deploy state replay sequence exists three times with slight variations, and divergence has already happened (the debug path omits pot-snapshot replay ordering used elsewhere).
  *Expected:* Extract a `DeployCoordinator` (owns `performDeploy`, `sendPostDeployState`, status-bar transitions) and a small `SessionState` object; `ds-ide.deploy` and `ds-ide.debug` call the same coordinator method with flags instead of re-implementing the sequence.

---

### v12 / M40 — Extension UX & Workspace Safety

- **Bug (MEDIUM):** `flashToHardware` creates a new `"Daisy IDE Flash"` output channel on every invocation and never disposes it — VS Code does not deduplicate by name, so repeated flashing accumulates orphan channels in the Output panel dropdown.
  *Expected:* Create the channel once in `activate()`, register it in `context.subscriptions`, pass it into `flashToHardware`; make `buildForHardware`'s channel parameter required (remove the per-call fallback).

- **Bug (MEDIUM):** `loadControllerConfig` shows one warning toast *per validation error* from at least six call sites including the save listener (fires on every relevant save); transport commands show unconditional "audio started/stopped" toasts even when no emulator is connected; routine build/deploy successes add toasts duplicating the status bar.
  *Expected:* Aggregate YAML errors into a single warning or publish to `DiagnosticCollection` with no toast, deduplicated across saves; expose `EmulatorManager.isConnected` and show a warning instead of a false success toast when disconnected; drop routine success toasts in favor of the status bar.

- **Bug (MEDIUM):** `ds-ide.effectSource` accepts an absolute path with no containment check (settable via a committed `.vscode/settings.json`), so a crafted project can direct Wiring Editor edits to an arbitrary file outside the workspace; `makeBlockEdit` also falls back to replacing the **entire document** whenever either marker pair is missing, silently mangling a customized source file in one click.
  *Expected:* Reject configured `effectSource` paths outside the workspace folder with an actionable error; replace the full-file fallback with a one-time modal confirmation before appending blocks, and never rewrite lines outside the marker ranges.

- **Bug (MEDIUM):** Every workspace-dependent operation hardcodes `workspaceFolders[0]`; the save-listener's "in workspace" check (`saved.startsWith(folder)`) is prefix-unsafe and false-positives sibling directories sharing a path prefix.
  *Expected:* Use `vscode.workspace.getWorkspaceFolder(doc.uri)` in the save listener (or ensure the prefix check ends with `path.sep`); centralize project-root resolution and let the user pick when multiple folders exist, instead of always folder 0.

- **Bug (MEDIUM):** Dragging a Controls-webview knob posts a `pot` message on every mousemove (~60–120 Hz); each message triggers a full `workspaceState` read-modify-write persisted write plus an IPC send, with no throttling or coalescing. The sine-amplitude and output-volume sliders have the same pattern.
  *Expected:* Keep IPC sends at input rate but debounce `workspaceState` persistence (flush on `mouseup` or ~250 ms idle); coalesce webview-side mousemove updates with `requestAnimationFrame`.

---

### v13 / M41 — Emulator Code Quality & Hygiene (emulator LOW)

- **Bug (LOW):** `lastLatencyMs()` reports `budget_ms * 2.0` under the field name `measuredMs` — a synthetic constant, not a real timestamp-based measurement.
  *Expected:* Sum `kAudioDevicePropertyLatency`, safety offset, and buffer frames for input+output at start time, or rename the field to `estimatedMs`.

- **Bug (LOW):** `CoreAudioDevice` owns `Impl*` as a raw pointer with copy/move left implicit — copying a started device yields two owners and a double `delete` in `stop()`/destructor.
  *Expected:* `std::unique_ptr<Impl>` with copy explicitly deleted.

- **Bug (LOW):** An effect can register both `StartAudio(InterleavingAudioCallback)` and `StartAudio(AudioCallback)`; the shim stores both pointers without clearing the other, and `use_block` is latched once for the process lifetime — a later interleaved registration is silently ignored.
  *Expected:* Each `StartAudio` overload nulls the other pointer; re-evaluate `use_block` per block; emit a warning event on repeated `StartAudio` calls.

- **Bug (LOW):** `System::Delay(ms)` sleeps 1 ms at a time in a loop; scheduler overshoot compounds per iteration, so `Delay(1000)` can take up to 2× the requested time under load — hardware `System::Delay` is tick-accurate.
  *Expected:* Compute an absolute deadline and `sleep_until(min(deadline, now + 1ms))` each pass.

- **Bug (LOW):** Pot values from the `pot`/`potSnapshot` IPC handlers are stored verbatim, including negatives, `>1`, `NaN`, and `Inf` (`std::stof` accepts `nan`/`inf`) — unlike the `outputVolume` handler, which clamps.
  *Expected:* Clamp to `[0, 1]` and reject non-finite values in both pot paths.

- **Bug (LOW):** `json_get`'s string-value scanner drops the backslash on any escape it doesn't special-case — `\n` becomes `n`, `\uXXXX` becomes `uXXXX`.
  *Expected:* Translate the standard escape set and decode or reject `\uXXXX` (subsumed by adopting a real JSON parser, per the M38 finding).

- **Bug (LOW):** `DaisySeed::PrintLine` forwards to `vprintf` with no `format(printf, 2, 3)` attribute (mismatched varargs are undetected UB) and appends `\n` where hardware emits `\r\n`.
  *Expected:* Add the format attribute; emit `\r\n` to match hardware fidelity.

- **Bug (LOW):** Both the effect object and the entire emulator runtime compile at `-O0 -g` unconditionally with only `-Wall`; `-Wextra`/`-Wshadow`/`-Wconversion` are absent.
  *Expected:* Keep `-O0 -g` for `effect_obj` only; build `RUNTIME_SRC`/`SHIM_SRC` at `-O2 -g`; add `-Wextra -Wshadow` to both targets.

---

### v13 / M42 — Extension/Tooling Polish

- **Bug (LOW):** `esbuild.js` uses one build config (`platform: 'node'`, `format: 'cjs'`) for both the extension host and the three webview scripts — currently harmless since webviews have zero imports, but the first `import` added to a webview script produces a broken or Node-flavored bundle.
  *Expected:* Split into an extension config (`platform: 'node'`) and a webview config (`platform: 'browser'`, `format: 'iife'`).

- **Bug (LOW):** `IpcClient.send()` silently no-ops when the socket is absent/destroyed; malformed JSON lines are silently discarded; a 1 MB receive-buffer overflow resets the buffer without resynchronizing to the next newline, so the next fragment also parses as garbage.
  *Expected:* Emit a counted warn-level event on dropped sends and malformed lines; on buffer overflow, skip to the next `\n` before resuming parsing.

- **Bug (LOW):** `runDfuUtil` detects success via output-string sniffing (`File downloaded successfully`, working around dfu-util's exit-74-after-success quirk) — locale/version-fragile.
  *Expected:* Constrain the workaround to the specific known exit code(s); keep the string check as a secondary signal only.

- **Bug (LOW):** The hand-rolled YAML parser silently skips tab-indented lines and never reads the scaffolded `controls: []` key (the parser only recognizes `controllers`/`buttons`/`leds`) — new projects start with a YAML key nothing reads.
  *Expected:* Emit a parse error on non-blank, non-comment lines matching no rule; fix the project scaffold to match the parser's actual section names.

- **Bug (LOW):** Grab-bag hygiene: `@types/node ^20` vs. an `esbuild` target of `node18`; toolchain detection shells out via `cp.exec('which ...')` instead of `execFile`; magic numbers (200 ms stale-kill wait, knob geometry constants duplicated between two functions); `hardware-build.ts` creates a fresh output channel when none is passed.
  *Expected:* Pin `@types/node` to `^18`; switch to `execFile`; hoist knob geometry into shared constants; make the channel parameter required.

- **Bug (LOW):** `package.json` still declares `"version": "0.0.1"` against a CHANGELOG documenting releases through 0.11.0; the referenced `images/icon.png` doesn't exist (also breaks packaging, see M37); activity-bar contributions reference only dark icon variants though light variants exist; keybindings have no `when`/`enablement` gates, so four shortcuts are live in every workspace; `"lint"` duplicates `"typecheck"` with no actual linter configured.
  *Expected:* Sync `version` to the latest changelog tag; add the icon asset; add `enablement`/`when` gates (e.g. a `ds-ide.isDaisyProject` context key); use or delete the light icon variants; wire up a real linter or rename the script.

- **Bug (LOW):** Sync fs calls (`mkdirSync`, `readdirSync`/`statSync`) run on the Extension Host during command paths; `ScopePanel.show()` reassigns `panel.webview.html` on every reveal, discarding scope/spectrum history despite `retainContextWhenHidden: true` paying its memory cost anyway.
  *Expected:* Swap sync fs calls for `fs.promises` equivalents; on reveal, `postMessage` current state instead of regenerating HTML; consider `getState()/setState()` for the scope webview.

- **Bug (LOW):** `ds-ide.effectSource` and `ds-ide.armToolchainPath` are declared as bare strings with empty defaults, no `scope`, and no `markdownDescription` — both default to `window` scope though they're machine/workspace-specific paths, so Settings Sync can silently apply a desktop toolchain path on a laptop.
  *Expected:* `"scope": "machine-overridable"` for `armToolchainPath`; `"scope": "resource"` (or documented `window`) for `effectSource`; document resolution order in `markdownDescription`.

- **Bug (LOW):** The `daisy-debug` debugger contribution has no `initialConfigurations`/`configurationSnippets` (manual selection dead-ends on a "pid required" error); the potentially minute-long CMake build inside `resolveDebugConfiguration` has no `withProgress` UI, so F5 appears hung on a cold configure; lldb-dap discovery covers only macOS paths.
  *Expected:* Mark `daisy-debug` internal or add a snippet; wrap build/deploy in `vscode.window.withProgress`; extend lldb-dap discovery with PATH probing for versioned Linux binary names.

---

*Full grouping rationale, requirements, and DoDs continue in `02_assumptions-and-risks.md`, `03_requirements.md`, and `05_dev-plan.md` → `docs/milestones/v11/`, `docs/milestones/v12/`, `docs/milestones/v13/`.*
