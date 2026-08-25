# 03 — Requirements (v18)

> **v17 complete** — all v17 requirements implemented; ACs green.
> Archived: [`docs/v17/03_requirements.md`](v17/03_requirements.md).

*v18 requirements not yet defined.*

---

**FR-UX-6 — Debug-session start respects the active workspace folder**

FR-UX-4 (v11/v12) established `resolveActiveFolder()` as the single source of truth for "which workspace folder does ds-ide operate on" in a multi-root workspace, but its acceptance criteria only covered the save-listener and general folder-selection UX — it did not explicitly require every *new* workspace-scoped call site to route through it. Two debug-attach call sites were added/left after FR-UX-4 shipped and still read `vscode.workspace.workspaceFolders?.[0]` directly: `src/commands/debug-deploy.ts:39` (`ds-ide.debug` PID-attach) and `src/debug/run-config-provider.ts:42` (F5 launch-configuration attach). Both must instead resolve the active folder the same way every other workspace-scoped command does.

AC: in a multi-root workspace with a non-first folder selected as active (via `ds-ide.selectActiveFolder`), both the `ds-ide.debug` command and the F5 launch-configuration path start the `daisy-debug` attach session against the selected active folder, not `workspaceFolders[0]`.

AC: a static check (wired into `npm run lint`) fails the build if any file under `src/` outside `src/workspace/active-folder.ts` and test files reads `workspace.workspaceFolders` by direct index — closing the gap that let this regression land silently after FR-UX-4 shipped.

---

## Emulator RT & concurrency safety (M54) — full evidence in `docs/06_emulator_review.md`

**FR-EMU-9 — `SpscIpcQueue` producers are never shared across threads**
`ipc_queue` and `midi_queue` are single-producer/single-consumer ring buffers but each has two-to-three independently-scheduled OS threads calling `push()` on them (LED/RGB-LED shim + audio RT thread on `ipc_queue`; IPC thread + MIDI UART/USB handlers on `midi_queue`), racing on a shared non-atomic `std::string`.
AC: each `SpscIpcQueue` instance has exactly one producer thread, verified by code inspection of every `push()` call site (LED/RGB-LED telemetry gets its own queue; `midi_queue` splits into a TX queue and an RX-telemetry queue), or the queue is upgraded to a genuine MPSC design.

**FR-EMU-10 — Scope/spectrum JSON serialization and FFT do not run on the audio RT thread**
`build_scope_json`/`build_spectrum_json`/`fft_radix2` currently execute synchronously inside the CoreAudio render callback in both real-time and CoreAudio-driven simulated mode.
AC: scope/spectrum formatting and FFT computation happen on the existing non-RT `drain_thread`, not inline in `processBlock`/`process_one_block`; the RT callback only pushes raw samples into a lock-free structure.

**FR-EMU-11 — Process shutdown has one authoritative termination path**
`main.cpp`'s detached `shutdown_watcher` (`std::_Exit(0)`) races the "normal" join/return-0 path, making the latter effectively dead code and discarding not-yet-drained telemetry on every shutdown.
AC: exactly one code path owns process termination; a clean shutdown flushes `ipc_queue`/`oled_queue`/`midi_queue` before the process exits, verified by a test that triggers shutdown and asserts queued telemetry was sent.

---

## Extension critical fixes (M55) — full evidence in `docs/06_nodejs_review.md`

**FR-EXT-6 — `EmulatorManager` "error" events have a production listener**
No `manager.on('error', ...)` is registered in `activate()`; Node's `EventEmitter` throws in-process on an unhandled `'error'` emission, which can crash the Extension Host on any raw socket error.
AC: `activate()` registers an `'error'` listener on `EmulatorManager` that surfaces the error to the user (`showErrorMessage` + output channel) instead of throwing.

**FR-EXT-7 — Spawned emulator child process is killed when the IPC handshake fails**
`connectIpc()`'s rejection path (`manager.ts:159-208`) only closes the socket; the already-spawned `effect_emu` child is orphaned until the next stale-PID reaper runs.
AC: on connect-timeout or malformed/version-mismatched handshake, the spawned child process is explicitly killed before the rejection propagates.

**FR-EXT-8 — `WiringViewProvider`'s message handler cannot produce an unhandled rejection**
The `async onDidReceiveMessage` callback awaits three file-I/O-performing handlers with no surrounding try/catch.
AC: all three awaited calls in `wiring-editor-panel.ts` are wrapped so a thrown error surfaces via `showErrorMessage`, matching `controls-editor-panel.ts`'s existing pattern.

**FR-EXT-9 — `activate()` is decomposed into named, testable units**
A single ~640-line function in `extension.ts` builds every store, panel, provider, and command registration inline, which is also root cause of FR-EXT-6 and FR-EXT-10 (cross-cutting gaps missed because the function is too large to review as a whole).
AC: view-provider construction, command registration, save-listener logic, and status/message routing are extracted into named factory functions/modules that `activate()` merely composes; `activate()` itself is materially shorter.

**FR-EXT-10 — `ds-ide.effectSource` setting is honored by the build command**
`build.ts` calls `findEffectSource(projectRoot)` with one argument, so the configured-path branch is always skipped even though the build failure message tells the user to set `ds-ide.effectSource`.
AC: setting `ds-ide.effectSource` changes which file the build command compiles, verified by a test with multiple/zero heuristic-matched `.cpp` files present.

**FR-EXT-11 — User-supplied wiring `id` cannot corrupt generated C++ source**
`validateId()` only checks emptiness/duplication; the free-text value is interpolated unescaped into generated declaration/init lines.
AC: `validateId` rejects any value that is not a valid C++ identifier (or reserved keyword), verified by a test asserting an id like `x; SystemInit(); //` is rejected before reaching `controls-writer.ts`.

---

## Extension reliability & validation hardening (M56) — full evidence in `docs/06_nodejs_review.md`

**FR-EXT-12** `child_process` stdout/stderr line-splitting buffers partial lines across chunk boundaries (`hardware-build.ts`, `dfu-flash.ts`) — a diagnostic or the flash-success string split across a chunk is currently dropped/misreported.

**FR-EXT-13** `killExisting()` escalates SIGTERM→SIGKILL the same way `killStalePid` already does, instead of SIGTERM-only.

**FR-EXT-14** `HostMidiBridge.start()`'s per-port `openPort`/`on` calls are individually guarded so one bad MIDI port doesn't throw out of `activate()`.

**FR-EXT-15** `HostMidiBridge`'s port-count probe `Input` is closed (`closePort()`) immediately after use instead of leaked.

**FR-EXT-16** Long-running child processes (`make`, `dfu-util`, emulator build/deploy) accept a timeout or cancellation token wired to `proc.kill()`.

**FR-EXT-17** `atob()`/`decodeOledFrame` calls are wrapped in try/catch so malformed base64 degrades the OLED preview instead of throwing uncaught inside a message listener.

**FR-EXT-18** `dispose()` cannot race an in-flight `deploy()` and leave a spawned child unkilled — deploy-in-progress state is tracked and checked/awaited in `dispose()`.

**FR-EXT-19** `workspaceState.update()` calls in `button-store.ts`/`toggle-store.ts`/`pot-store.ts` attach a `.catch()` handler instead of discarding via bare `void`.

**FR-EXT-20** The hand-rolled YAML `yamlQuote()`/parser round-trips labels containing embedded newlines without data loss.

**FR-EXT-21** `gpio_pin`'s validated upper bound matches the pin table's actual maximum (derived from `PIN_DEFS`, not a hardcoded `31`).

**FR-EXT-22** Incoming `postMessage` payloads in `*-webview.ts` files are runtime-validated against the `messages.ts` contract before use.

**FR-EXT-23** `create-effect-project.ts`'s existence check distinguishes ENOENT ("doesn't exist") from other `fs.stat` failures (permission, unavailable drive).

**FR-EXT-24** `create-effect-project.ts`'s final `vscode.openFolder` step is wrapped in try/catch consistent with the rest of the function.

**FR-EXT-25** `IpcClient`'s `'warning'` events are forwarded through `EmulatorManager` and surfaced via the `emulatorChannel` output channel, not just `console.warn`.

**FR-EXT-26** The `safeJson()` HTML/script-escaping helper is centralized into one shared module instead of duplicated in `controls-editor-panel.ts` and `wiring-panel.ts`.

---

## Extension API, type, and maintainability polish (M57) — full evidence in `docs/06_nodejs_review.md`

**FR-EXT-27** The duplicated `el<T>()` DOM-lookup helper (5 webview files) is consolidated into one shared utility that either throws descriptively or returns `T | null`.

**FR-EXT-28** `JSON.parse`'d data-island content (`controls-webview.ts`, `wiring-webview.ts`) is runtime-shape-checked before being cast, failing loudly on drift instead of silently defaulting to `{}`/`[]`.

**FR-EXT-29** `REGISTRY[kind]` indexing in `controls-writer.ts` uses one consistent null-safety convention (not a mix of `?.` and `!`).

**FR-EXT-30** `DeployCoordinator`'s 17-positional-parameter constructor is replaced with a grouped options object for named, order-independent construction.

**FR-EXT-31** `codegen/*.ts` strategies (`oled.ts`, `midi-usb.ts`, `pot.ts`, `toggle.ts`) adopt one documented error contract for invalid/out-of-range input instead of four different behaviors.

**FR-EXT-32** `controls-webview.ts`'s 6 unrelated UI subsystems (convention canvas, YAML editor, drag-drop, save, SD viewer, OLED strip) are split into per-concern modules, matching the project's existing pure-module extraction pattern.

**FR-EXT-33** The `messages.ts` discriminated-union contract is actually enforced (via a runtime type guard) at each of the five `onDidReceiveMessage`/`postMessage` handler sites instead of being re-derived ad hoc per file.

**FR-EXT-34** Scope/spectrum webview updates are routed through `raf-coalesce.ts` (already used for pot/encoder drag) instead of redrawing synchronously on every IPC message.

**FR-EXT-35** The MIDI monitor batches its DOM rebuild via `raf-coalesce.ts` instead of rebuilding the full row list on every message.

**FR-EXT-36** The native `midi` dependency is pinned to an exact (or `~`) version instead of an unrestricted `^2.0.0` caret range.

**FR-EXT-37** `codegen/*.ts` peripheral strategies share a `makeSimplePeripheralCodegen()` helper instead of ~70% copy-pasted boilerplate across 4 files.

**FR-EXT-38** `truncId`/`TRUNC_MAX_LEN`/`TRUNC_SUFFIX` are defined once in a shared webview-importable module instead of duplicated across the panel/webview boundary.

**FR-EXT-39** An integration-style test asserts that an `EmulatorManager` `'error'` emission is handled without crashing the process, so the test suite can no longer mask the FR-EXT-6 gap by registering handlers production code omits.
