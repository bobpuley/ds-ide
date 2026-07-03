# 04 — Architecture (v11)

> **v10 complete** — full v10 architecture in
> [`docs/v10/04_architecture.md`](v10/04_architecture.md).

## v11–v13 Architecture Notes

### Overall system design — unchanged

The two-process architecture (VS Code extension ↔ native emulator process over a UNIX domain socket) is unchanged across v11–v13. No new processes and no IPC transport changes are required; several fixes change *what* is sent over existing channels or *where in the codebase* work happens, not the transport itself.

---

### Replay audio path (corrected — v11 / M36, FR-RTS-3)

**Current path (incorrect):** CoreAudio RT callback (`ca_process`) → `process_one_block` → `SessionPlayer::nextBlock()` → blocking `::read()`/`::lseek()` on the RT thread, plus a per-block heap-allocated `std::vector<ReplayEvent>` and a `wav_mutex`-guarded `shared_ptr` copy that can free a multi-MB `WavData` on the RT thread.

**Corrected path:** a dedicated reader thread performs `::read()`/`::lseek()` and event parsing, pushing pre-decoded blocks into a lock-free SPSC ring (the same structural pattern `SessionRecorder` already uses for its write path, just reversed — reader thread produces, RT thread consumes). The RT path only pops pre-decoded blocks with atomics; no syscalls, no mutex, no allocation. `wav_mutex` + `shared_ptr` copy is replaced with an atomic pointer swap; the IPC thread retires old `WavData` only after the engine's generation counter (already present) confirms the swap was observed.

This reuses existing SPSC infrastructure — no new queue type is introduced, only a second instance of the pattern for the read direction.

---

### `SessionRecorder` synchronization (corrected — v11 / M36, FR-RTS-4)

**Current:** `enqueueBlock()` (RT thread) loads `active_` with `memory_order_relaxed`; `start()` (IPC thread) stores it with `memory_order_release` after resizing `audio_slots_`. On a weakly-ordered target the relaxed load is not guaranteed to observe the resize.

**Corrected:** `enqueueBlock()` loads `active_` with `memory_order_acquire`, forming a proper release/acquire pair with `start()`'s store. `audio_slots_` and per-slot buffers are allocated once in the constructor (fixed capacity for the lifetime of the object) so `start()` never resizes them — removing the resize from the synchronization-sensitive path entirely rather than just fixing the ordering around it. A generation counter (or `in_use` flag) closes the residual stop/start overlap window.

No new data structures; this is a memory-ordering and allocation-lifetime fix within the existing class.

---

### Socket & PID lifecycle (corrected — v11 / M37, FR-EXT-2)

**Current:** socket path is `/tmp/daisy_emu_${Date.now()}.sock` (predictable, global `/tmp`); activation sweeps and deletes *every* `/tmp/daisy_emu_*.sock`; `killStalePid` signals a PID with no identity check.

**Corrected:** each workspace gets a dedicated directory (e.g. `<projectRoot>/.ds-ide/` or a per-user, per-workspace path under `os.tmpdir()` with `0700` permissions) holding both `emu.pid` and the socket file, named with a random component (`randomBytes(6).toString('hex')`) rather than a timestamp. Activation cleanup only touches this workspace's directory — never a global `/tmp` sweep — and only after confirming (via `ps`/`/proc` command-name check) that the recorded PID no longer belongs to an `effect_emu` process, or is dead. This is a change to *where* existing artifacts (pid file, socket) live and *what checks gate* deleting them — no new IPC message types or process topology.

---

### ADC init code generation (corrected — v11 / M37, FR-CODEGEN-1)

**Current:** Wiring Editor emits `hardware.adc.Init(pot1, pot2, ..., N)`; the emulator shim declares a variadic `template<typename... Args> Init(Args...)` overload that exists *only* to make this non-portable call shape compile.

**Corrected:** generator emits the canonical libDaisy pattern — a declared `AdcChannelConfig` array, per-channel `.InitSingle(...)` calls, and `hardware.adc.Init(array, N)` (pointer + count, matching real libDaisy's signature). The shim's variadic overload is deleted once the generator is fixed, so the shim's `AdcHandle::Init` API surface exactly matches hardware again. This restores the architectural invariant the shim is supposed to guarantee (emulator and hardware compile the same source) rather than adding a new one.

---

### Packaging pipeline (corrected — v11 / M37, FR-PKG-1)

`.vscodeignore` currently excludes `emulator/**` wholesale. The fix un-excludes emulator *sources* while still excluding build output directories (`emulator/**/build/**`), so `vsce package` bundles the CMake project the packaged extension needs at `buildForEmulator` time. A CI packaging smoke test (unzip the `.vsix`, assert `emulator/CMakeLists.txt` and `dist/extension.js` exist) is added to the existing test pipeline — no new pipeline, an additional assertion in it.

---

### Scope/spectrum message sizing (corrected — v12 / M38, FR-EMU-2)

**Current:** `SpscIpcQueue::MAX_MSG` is a fixed constant (81,920 bytes) sized for one specific `rt_buffer_size`; the scope sample budget (`SCOPE_SAMPLES_MAX`) is independent of it and can produce messages up to ~30× larger at bigger hardware frame sizes.

**Corrected:** the scope sample budget is derived *from* `MAX_MSG` (decimating more aggressively as hardware frame size grows) rather than the two being sized independently, closing the gap structurally instead of just raising the constant again (which is what v9's equivalent fix did before frame-size-dependent growth reopened it). A debug assert (`msg.size() <= MAX_MSG`) in `push()` catches any future regression at the source.

---

### IPC message validation (new layer — v12 / M39, FR-IPC-2)

A discriminated-union schema for the IPC protocol is introduced at the boundary where lines are parsed (extending the existing `src/ipc/narrow.ts` rather than adding a new dependency, consistent with the project's zero-runtime-dependency stance). Every message type the emulator can emit gets a narrowing function; `ipc-client.ts` calls `parseIpcMessage(line): IpcMessage | undefined` and logs+drops anything that fails to parse. Downstream consumers (`scope-panel.ts`, `controls-editor-panel.ts`) stop forwarding `...msg` spreads to webviews and instead forward an explicitly constructed, typed payload. This is additive — the wire format is unchanged; only the TS-side trust boundary moves from "the socket" to "the narrowing function."

---

### Webview build & type-checking split (new — v12 / M39 + v13 / M42, FR-IPC-6 / FR-QA-EXT-1)

Two related changes land together since they touch the same files:
- **Type-checking:** webviews get their own `tsconfig.webview.json` (`lib: ["ES2022", "DOM"]`, using the existing `webview-api.d.ts` shim) so `@ts-nocheck` can be removed; the host↔webview message protocol becomes a shared discriminated union imported by both the extension host and webview bundles.
- **Bundling:** `esbuild.js` splits into two build configs — extension (`platform: 'node'`, `format: 'cjs'`, `external: ['vscode']`, unchanged) and webviews (`platform: 'browser'`, `format: 'iife'`, `target: 'chrome114'`-equivalent). This is required *before* the webviews can safely import the shared message-protocol types module, since a Node-platform bundle would resolve/emit incorrectly for browser-context code the moment webview scripts gain an import.

No new build tool is introduced — `esbuild` already supports multiple entry configs (as `esbuild.js` demonstrates for extension vs. webview entry *points*; the fix is giving them separate *options*, not separate tooling).

---

### `extension.ts` decomposition (v12 / M39, FR-IPC-7)

`activate()`'s inline command/state wiring is factored into a `DeployCoordinator` (owning `performDeploy`, `sendPostDeployState`, status-bar transitions) and a `SessionState` object (owning `sineState`/`audioSourceState`/`activeRecordPath` persistence). `ds-ide.deploy` and `ds-ide.debug` call the same coordinator method with flags rather than re-implementing the post-deploy sequence. This is an internal refactor of the extension host's own module boundaries — no VS Code API surface, IPC format, or webview contract changes.

---

### No other architectural changes

The remaining v11–v13 fixes are localized to their implementation files and require no architectural decisions:

- Duplex/render buffer sizing, CoreAudio error checking, `System::Delay` drift, pot clamping, `PrintLine` fidelity, build flags: localized to `emulator/runtime/core_audio_device.cpp`, `emulator/shim/src/*`, `emulator/CMakeLists.txt`.
- `json_get` escape handling and substring-key matching: localized to `emulator/runtime/ipc_server.cpp` (a real JSON tokenizer would be an architecture change; the minimum fix applied here is not).
- WAV validation ordering, recorder write-error reporting, recorder shutdown/destructor: localized to `wav_reader.cpp`, `session_recorder.cpp`, `main.cpp`.
- `editorSave` payload validation, config-read error handling, wiring `applyEdit` result checks, multi-root workspace resolution, notification aggregation, output-channel lifecycle, workspace-state debouncing: all API-substitution or validation-addition fixes within `extension.ts` and the command/sidebar modules — no new modules or data flows.
- Marketplace metadata, configuration `scope` declarations, debug contribution snippets/progress UI: `package.json`-only or single-file changes.
