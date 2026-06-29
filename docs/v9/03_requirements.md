# 03 — Requirements (v9)

> **v8 complete** — all v8 requirements implemented; ACs green.
> Archived: [`docs/v8/03_requirements.md`](v8/03_requirements.md).

## v9 Requirements

All requirements below are derived from the 2026-06-28 code review findings. See `01_input-ideas.md` for the raw bug list.

---

### RT-thread Safety (Emulator — C/C++)

**FR-RTS-1 — No blocking I/O on the RT thread**  
The CoreAudio render callback must never call blocking system calls (disk reads/writes, socket sends, `::sleep`, `::nanosleep`) directly or indirectly. Session recorder writes must be handled by a dedicated non-RT thread that drains data enqueued by the audio thread.  
AC: recording-active `ca_process` path contains no syscalls that can block; verified by code inspection and testing with `TSAN` + `LSAN`.

**FR-RTS-2 — No heap allocation on the RT thread**  
The CoreAudio render callback must not trigger heap allocation. This includes: constructing or assigning `std::string` for IPC messages, calling `std::vector::assign/resize` for buffer growth, or any path that invokes `malloc`/`new` that could block on the allocator lock.  
AC: SPSC slot capacity (`MAX_MSG`) is ≥ the maximum scope message size; working buffers in the render callback are pre-allocated before `AudioOutputUnitStart`; no `std::string` temporaries are constructed on the RT path.

**FR-RTS-3 — No mutex acquisition on the RT thread**  
Code called from the CoreAudio render callback (including shim implementations such as `Led::Update` and `DaisySeed::SetLed`) must not acquire any mutex. LED and other shim-generated messages must be enqueued via the existing SPSC queue and forwarded by the drain thread.  
AC: `emit_led_change` calls `ipc_queue.push()` instead of `send_mutex` + `send_ipc`; audio effect code that calls `SetLed` from the audio callback produces no mutex contention.

---

### Pin Mapping Correctness (TypeScript)

**FR-PIN-1 — All ADC-capable pins map to the correct libDaisy ADC index**  
The code generator must produce valid `daisy::seed::A<n>` identifiers for all pins documented as ADC-capable in the wiring editor. D28 must map to index 11 (`A11`); D15–D25 map to indices 0–10 linearly.  
AC: assigning a potentiometer to D28 generates `daisy::seed::A11` (not `A13`); the generated project compiles without error; a single canonical `pinToAdcChannel` function is the source of truth for both the TypeScript code generator and the webview JS.

---

### Extension Host Reliability

**FR-EXT-1 — No synchronous blocking calls in the extension host event loop**  
All file I/O (`fs.readFileSync`, `fs.writeFileSync`, `fs.readdirSync`, `fs.statSync`, `fs.unlinkSync`) and process spawning (`cp.execSync`) must be replaced with their async equivalents in any function invoked from a VS Code command handler, webview message handler, debug adapter descriptor factory, or event listener.  
AC: `detectArmToolchain`, `detectDfuUtil`, `findLldbDap`, `detectEffectSrc`, `detectDaisySP`, `killStalePid`, `writePid`, `clearPid`, and `controllers.yaml` persistence are all non-blocking; the VS Code "extension host is busy" indicator does not appear during normal build/deploy/debug flows.

**FR-EXT-2 — Concurrent deploy calls coalesce on the in-flight promise**  
When `EmulatorManager.deploy()` is called while a deploy is already in progress, it must return the existing `deployLock` promise (not `undefined`). Callers must not show a success message or push post-deploy state until the deploy actually completes.  
AC: rapid double-deploy does not produce a spurious "emulator running" notification; post-deploy state (pot/button/sine/audio) is sent exactly once per successful deploy.

**FR-EXT-3 — Extension settings are declared in `contributes.configuration`**  
`ds-ide.effectSource` and `ds-ide.armToolchainPath` must appear in the VS Code Settings UI with type, default value, and description.  
AC: `package.json` contains a `contributes.configuration` block with both properties; settings are visible and editable in the VS Code Settings editor.

**FR-EXT-4 — Webview disposables are tracked and released**  
`Disposable` objects returned by `view.webview.onDidReceiveMessage` and `view.onDidChangeVisibility` in `ControlsViewProvider` and `WiringViewProvider` must be stored and disposed when the view is disposed, preventing stale listeners from accumulating if the view is re-resolved.  
AC: re-resolving a webview view does not cause duplicate state mutations (double pot sends, double `loadEditor` calls).

**FR-EXT-5 — Controls webview document event listeners are removed before each re-render**  
`document.addEventListener('mousemove', ...)` and `('mouseup', ...)` calls in `buildConventionCard` and `makeDraggable` must be balanced by corresponding `removeEventListener` calls before the canvas is cleared. After N render cycles, there must be no more than one active pair of `mousemove`/`mouseup` handlers per card type.  
AC: webview responsiveness is not degraded after 20+ re-render cycles (file saves, deploys, config loads).

---

### Emulator Robustness

**FR-EMU-1 — Malformed or oversized WAV files are rejected without crashing**  
`parse_wav` must validate the computed `total_samples` against a maximum (e.g., 10 minutes stereo @ 48 kHz) and return a user-readable error rather than calling `std::vector::resize` with an unbounded value. `std::bad_alloc` must not propagate to the IPC server's read loop.  
AC: loading a WAV file with `data_size = 0xFFFFFFFF` produces an error IPC event and returns control to the VS Code extension without terminating the emulator process.

**FR-EMU-2 — IPC client file descriptor is closed exactly once**  
The `send_ipc` lambda must not call `::close(client_fd)` on send failure; the single authoritative `::close` must remain in the cleanup block. This eliminates the risk of closing an unrelated file descriptor if the fd number is recycled between the two closes.  
AC: code inspection confirms one `::close(client_fd)` call per connection; `ASAN` / `TSAN` show no double-free on send error.

**FR-EMU-3 — Stale emulator process is confirmed dead before new process is spawned**  
After `killStalePid` sends `SIGKILL`, the extension must wait (poll or brief delay) until the killed PID is no longer alive before spawning a new emulator, preventing the new process from failing to acquire the UNIX socket address or audio device.  
AC: rapid redeploy cycles (kill→spawn within 100 ms) do not produce "socket ready" timeout errors on a normally loaded system.

---

### Packaging

**FR-PKG-1 — `@vscode/vsce` is a tracked dev dependency**  
`@vscode/vsce` must be listed in `devDependencies` and the `package` npm script must invoke it via `npx vsce` (or the local `node_modules/.bin/vsce`).  
AC: `npm ci && npm run package` succeeds on a clean machine with no globally installed tools.

---

### Code Quality (M33)

**FR-QA-1 — SPSC queue drops are counted and reported**  
`ipc_send` must check the return value of `ipc_queue.push()`; dropped messages must increment an atomic counter that is periodically reported via a diagnostic IPC event or stderr line.  
AC: scope frame drops are visible in the emulator output; the SPSC queue capacity is ≥ 64 to reduce drop rate under normal usage.

**FR-QA-2 — IPC and webview messages are runtime-narrowed before use**  
Message fields received over IPC from the emulator and from webviews must be type-narrowed (e.g., with `typeof` guard helpers) before being used as typed values. The pattern in `wiring-view-provider.ts` serves as the reference.  
AC: no `as T` casts on `IpcMessage` field access; no `as unknown as T` casts on DAP message literals.

**FR-QA-3 — Post-deploy state initialization is extracted to a single function**  
The block that sends pot/button/sine/audio mode/audio device/WAV state after a successful deploy must appear exactly once in the codebase.  
AC: `grep -n sendPotSnapshot src/extension.ts` shows a single call site inside a named helper.

**FR-QA-4 — `lseek` return values are checked in `SessionPlayer::countBlocks`**  
The scan loop must break on `lseek` error to prevent silent incorrect `total_blocks_` counts on corrupted `.dsrec` files.

**FR-QA-5 — IPC receive buffer has a maximum size guard**  
`run_ipc_server` must disconnect the client if `partial.size()` exceeds a defined maximum (e.g. 1 MB), preventing memory exhaustion from malformed input.

**FR-QA-6 — Socket path length is validated before `strncpy`**  
`run_ipc_server` must check `strlen(socket_path) < sizeof(addr.sun_path)` and emit a diagnostic to stderr before attempting `bind`.

**FR-QA-7 — `decode_pcm32` uses defined-behaviour bit reinterpretation**  
The `static_cast<int32_t>(uint32_t)` cast for high-bit-set values must be replaced with `std::memcpy` to be defined in C++17.

**FR-QA-8 — `truncId` exists in exactly one place**  
The `truncId` implementation in `controls-view-provider.ts` must not be duplicated in the embedded JS string; the shared `pinToAdcChannel` (from FR-PIN-1) serves as the precedent for this consolidation pattern.

**FR-QA-9 — `detectNonPortableSymbol` returns all undefined symbols**  
The function signature changes to `string[]`; the caller surfaces all non-portable symbols in a single diagnostic message.

**FR-QA-10 — Magic numbers are replaced by named constants**  
`SOCKET_TIMEOUT_MS`, `IPC_MAX_BUFFER`, `DAP_TERMINATE_DELAY_MS`, and CMake parallelism (derived from `os.cpus().length`) are named constants.

**FR-QA-11 — `DsIdeTerminatingAdapter.dispose` cancels the pending timer**  
The 50 ms timer handle must be stored and cleared in `dispose()`.

**FR-QA-12 — Webview message range validation follows the `wiring-view-provider` pattern**  
Pot channel (0–11), pot value (0–1), output volume (0–1), and audio source enum are validated before being forwarded over IPC.

**FR-QA-13 — `debugDeploy` requires `outputChannel` as a non-optional parameter**  
Remove the fallback `createOutputChannel` path to prevent untracked output panels.

**FR-QA-14 — Stale `activationEvents` entries are removed from `package.json`**  
The two entries inferred automatically by VS Code ≥ 1.74 are deleted; the field is removed entirely if no non-inferred events remain.

**FR-QA-15 — `ScopePanel.html()` generates a fresh nonce per call**  
The nonce is moved from the constructor to the `html()` method body.

**FR-QA-16 — Wire/unwire `WorkspaceEdit` targets only the modified line ranges**  
Full-file replacement is replaced with targeted `edit.replace` calls covering only the `ds-ide:controls` and `init` marker blocks.

**FR-QA-17 — Multi-root workspace uses first folder with an info message**  
When `workspaceFolders.length > 1`, a one-time info notification states which folder ds-ide is operating on.

**FR-QA-18 — `findEffectSource` consolidated to one async implementation**  
`detectEffectSrc` (build.ts sync) and `findEffectSource` (extension.ts async) are replaced by a single exported async function; search scope is unified.

**FR-QA-19 — `s_mach_ns_per_tick` is stored as a struct member or `std::atomic`**  
The plain `static double` is replaced with a value stored before `AudioOutputUnitStart` (providing a natural publication barrier) or declared `static std::atomic<double>` (C++20).

**FR-QA-20 — Webview JS extracted to typed, testable `.ts` files**  
The JavaScript embedded in `controls-view-provider.ts`, `scope-panel.ts`, and `wiring-panel.ts` is extracted to `src/webview/*.ts` entry points, bundled by esbuild, and referenced via `asWebviewUri`. Enables type-checking, linting, and unit testing of webview logic.
