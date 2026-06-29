# 01 — Input Ideas (v9)

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
> **v6 complete** — archived to `docs/v6/` on 2026-06-21. This file now seeds v7 planning.
>
> **v7 complete** — archived to `docs/v7/` on 2026-06-21. This file now seeds v8 planning.
>
> **v8 complete** — archived to `docs/v8/` on 2026-06-22. This file now seeds v9 planning.

## v9 Planning — Bug Reports from Code Review (2026-06-28)

The three automated code reviews (C/C++ emulator, Node.js/TypeScript, VS Code extension) produced findings grouped below by target milestone.

---

### M31 — Emulator RT-thread Safety (C/C++ emulator HIGH bugs)

- **Bug (HIGH):** Blocking disk I/O in the CoreAudio real-time callback — `SessionRecorder::writeBlock` calls `::write(fd_)` directly on the audio RT thread, causing xruns when recording is active.  
  *Observed:* `ca_process` → `process_one_block` → `writeBlock` → `::write()` on the CoreAudio render thread.  
  *Expected:* All file writes occur on a dedicated non-RT thread; audio thread only enqueues data.

- **Bug (HIGH):** Heap allocations inside the CoreAudio RT callback — `build_scope_json` / `build_spectrum_json` allocate `std::string` on every scope/spectrum emit; SPSC slot size (16 kB) is smaller than the actual scope message (~76 kB), triggering `std::string::assign` heap reallocation inside `ipc_queue.push()` on the RT thread.  
  *Observed:* Priority inversion with system allocator; SPSC pre-allocation defeated by message oversize.  
  *Expected:* No heap allocation occurs on the RT thread; SPSC slots are pre-sized to accommodate the largest message.

- **Bug (HIGH):** `send_mutex` and `::send()` called from the RT thread via `Led::Update()` / `DaisySeed::SetLed()` — if the IPC socket write stalls, the RT thread blocks on `send_mutex`, causing xruns.  
  *Observed:* `emit_led_change` → `std::lock_guard(send_mutex)` → `send_ipc()` → `::send()` on CoreAudio thread.  
  *Expected:* LED messages are enqueued in the SPSC queue (same path as `ipc_send`) and forwarded by the drain thread.

---

### M32 — Extension & Emulator Correctness (HIGH TS + impactful MEDIUM bugs)

- **Bug (HIGH):** `analogIndex(pin)` in `controls-writer.ts` uses `pin - 15` for all pins; D28 (A11) produces index 13, generating `daisy::seed::A13` which does not exist in libDaisy — the user's project fails to compile with a cryptic error.  
  *Observed:* Assigning a pot to D28 writes `A13` into the generated C++ init call.  
  *Expected:* D28 → index 11 (`A11`), matching the libDaisy API and the existing correct JS handler in the webview.

- **Bug (MEDIUM):** `EmulatorManager.deploy()` returns bare `undefined` when a concurrent deploy is in progress; all callers (`deployToEmulator`, `performBuildAndDeploy`, `debugDeploy`) await the result and unconditionally show a success message and return `true`, even though the emulator was not started.  
  *Observed:* Double-deploy (keybinding or build+deploy race) shows "emulator running" while the first deploy is still in flight or failed.  
  *Expected:* Concurrent deploy calls coalesce on the existing in-flight deploy promise.

- **Bug (MEDIUM):** `ds-ide.effectSource` and `ds-ide.armToolchainPath` are read by the extension but not declared in `contributes.configuration` — settings are invisible in the VS Code Settings UI and have no documented type, default, or description.  
  *Observed:* No `contributes.configuration` section in `package.json`.  
  *Expected:* Both settings appear in the Settings UI with descriptions and defaults.

- **Bug (MEDIUM):** `@vscode/vsce` is not listed in `devDependencies`; the `package` npm script calls `vsce package` which fails on a clean machine or CI agent without a global install.  
  *Expected:* `npm run package` works on any machine after `npm install`.

- **Bug (MEDIUM):** Controls webview registers `document.addEventListener('mousemove', ...)` and `('mouseup', ...)` for every control card but never removes them. Cards are removed from the DOM on every re-render (`renderConventionCanvas`), but the document-level listeners accumulate — degrading webview responsiveness over a session.

- **Bug (MEDIUM):** `view.webview.onDidReceiveMessage` and `view.onDidChangeVisibility` disposables are discarded in `ControlsViewProvider.resolveWebviewView` and `WiringViewProvider.resolveWebviewView`. If a view is re-resolved, stale listeners fire alongside new ones.

- **Bug (MEDIUM):** Emulator crashes with `std::terminate` when a malformed or pathologically large WAV file is loaded — `parse_wav` calls `out.samples.resize(total_samples)` where `total_samples` can reach ~4 billion, throwing `std::bad_alloc` that propagates uncaught through the IPC server read loop.

- **Bug (MEDIUM):** Double-close of the IPC client file descriptor: on a `::send()` failure, the `send_ipc` lambda calls `::close(client_fd)` and the cleanup block calls it again unconditionally, risking closure of an unrelated descriptor if the fd number was recycled.

- **Bug (MEDIUM):** `detectArmToolchain`, `detectDfuUtil` (toolchain.ts) and `findLldbDap` (debug-adapter.ts) call `cp.execSync('which ...')` / `cp.execSync('xcrun --find ...')` on the extension host event loop, blocking all extension callbacks for the duration of the call.

- **Bug (MEDIUM):** `controllers.yaml` is persisted with `fs.writeFileSync` inside the `onEditorSave` webview message handler — a synchronous disk write on the extension host event loop.

- **Bug (MEDIUM):** `killStalePid` sends `SIGKILL` and immediately proceeds to spawn a new emulator without confirming the old process has exited — a race where the killed process still holds the UNIX socket address or audio device handle when the new process starts.

---

### M33 — Quality Polish (remaining MEDIUM + all LOW bugs)

- **Bug (MEDIUM):** RT heap reallocation when CoreAudio delivers more frames than requested — `renderCallback` and `renderCallbackOutputOnly` call `std::vector::assign/resize` on the RT thread if `frames > bufferSize`. Risk is limited to the first few callbacks on affected hardware but produces an xrun each time.

- **Bug (MEDIUM):** IPC and webview messages are cast to concrete types with `as T` without runtime narrowing (`msg['kind'] as string`, `msg['running'] as boolean`, etc.). Malformed or buggy messages silently produce undefined runtime behaviour.

- **Bug (MEDIUM):** `as unknown as vscode.DebugProtocolMessage` double-cast in `run-config-provider.ts` bypasses TypeScript structural checking on DAP response/event objects.

- **Bug (MEDIUM):** Deploy post-state initialization block (`sendPotSnapshot`, `sendButtonSnapshot`, `sendSine`, `sendAudioMode`, `sendAudioDevice`, optional WAV) is copy-pasted verbatim in `performBuildAndDeploy` and the `ds-ide.deploy` command handler; will diverge silently as features are added.

- **Bug (LOW):** UNIX socket files (`/tmp/daisy_emu_<ts>.sock`) are not unlinked on `dispose()` or extension crash — accumulate across sessions. `socketPath` is a local variable in `deploy()` so `dispose()` cannot reference it.

- **Bug (LOW):** `s_mach_ns_per_tick` is a plain `static double` read from the CoreAudio RT thread without C++ memory ordering guarantees (safe in practice due to Apple's memory model and implicit `AudioOutputUnitStart` barrier, but non-standard).

- **Bug (LOW):** `ipc_send` silently discards the `bool` return value of `ipc_queue.push()`; scope frames, spectrum bins, and event messages are dropped with no diagnostic when all 32 SPSC slots are occupied. With `SCOPE_BLOCKS=33`, the queue fills before scope messages are processed.

- **Bug (LOW):** `SessionPlayer::countBlocks` discards all `::lseek()` return values in the scan loop; a corrupted `.dsrec` file produces an incorrect `total_blocks_` count with no error indication.

- **Bug (LOW):** IPC `partial` receive buffer in `run_ipc_server` grows without bound if the VS Code extension sends data without newlines — a development-tool concern but causes memory exhaustion on malformed input.

- **Bug (LOW):** `socket_path` is copied into `addr.sun_path` with `strncpy` with no prior length check; paths ≥ 104 chars are silently truncated, causing `bind` to fail with a confusing error.

- **Bug (LOW):** `json_get` handles `\"` correctly but maps all other escape sequences (e.g. `\n`, `\\`) to the literal following character — Windows-style backslash paths would be silently corrupted (macOS-only tool, low practical risk).

- **Bug (LOW):** `decode_pcm32` in `wav_reader.cpp` casts `uint32_t` to `int32_t` with high bit set — implementation-defined in C++17, well-defined only in C++20.

- **Bug (LOW):** `truncId` is exported from `controls-view-provider.ts` (line 99) and re-implemented identically inside the same file's embedded JS string (line 315); the two copies will diverge silently if the truncation logic changes.

- **Bug (LOW):** `adcChannelFromPin` diverged between webview JS (correct, handles D28) and TypeScript `analogIndex` (incorrect, root cause of the D28 HIGH bug). Two implementations of the same mapping exist where one should be the source of truth.

- **Bug (LOW):** `detectEffectSrc` (build.ts) uses `fs.readdirSync`; `findEffectSource` (extension.ts) uses `fs.promises.readdir` — two implementations of the same file search with diverging scope and I/O strategy.

- **Bug (LOW):** `detectNonPortableSymbol` returns on the first undefined reference match; users with multiple non-portable symbols must fix and rebuild repeatedly to see all errors.

- **Bug (LOW):** Several magic numbers are used without named constants: `10000` (deploy socket timeout), `1 << 20` (IPC buffer limit), `50` (DAP termination delay), `'-j4'` (CMake parallelism hard-coded to 4 cores).

- **Bug (LOW):** `extension.ts` activation lifecycle (command registration, disposable wiring, `_exclusionGuard`) is not covered by any unit test; regressions are only caught during manual QA.

- **Bug (LOW):** `DsIdeTerminatingAdapter.dispose()` does not cancel the 50 ms `setTimeout` scheduled by `handleMessage`; if disposed early, the callback fires on a disposed `EventEmitter`.

- **Bug (LOW):** Several webview message handlers (`controls-view-provider.ts`, `scope-panel.ts`) forward values to IPC without range-checking: pot channel (0–11), pot value (0–1), output volume (0–1), sine amplitude, audio source enum.

- **Bug (LOW):** Wire/unwire handlers in `extension.ts` replace the entire `.cpp` file with a single `WorkspaceEdit`, creating a coarse undo step; targeted block replacement would give granular undo.

- **Bug (LOW):** All command paths silently use `workspaceFolders[0]` with no user feedback in multi-root workspaces containing multiple Daisy projects.

- **Bug (LOW):** `debugDeploy` creates a new `OutputChannel` if none is passed, but the channel is local to the function and never disposed — risks leaked output panels in future callers.

- **Bug (LOW):** `activationEvents` in `package.json` declares events already inferred automatically by VS Code ≥ 1.74 from `contributes.debuggers` — redundant and a maintenance burden.

- **Bug (LOW):** `ScopePanel` generates its CSP nonce once in the constructor; the same nonce is reused on every `show()` call. Per-load nonces are the security intent of CSP.

- **Bug (LOW):** `controls-view-provider.ts` (604 lines), `scope-panel.ts` (722 lines), and `wiring-panel.ts` (455 lines) each embed hundreds of lines of untyped, untested JavaScript in template-string HTML — type errors and refactoring renames are invisible to the compiler.
