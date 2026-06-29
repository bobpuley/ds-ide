# M33 — Quality Polish

**Version:** 0.9.2  
**Status:** in progress  
**Source:** 2026-06-28 code reviews — remaining MEDIUM + all LOW findings across three reviews

## Goal

Improve code quality, safety margins, and long-term maintainability without changing user-visible behaviour. Items are ordered by risk (higher-risk regressions first).

## Sprint Tasks

### fix: Pre-size RT working buffers for hardware-imposed frame counts (FR-RTS-2, partial)

When CoreAudio delivers more frames than requested (hardware minimum clamping), `renderCallback` and `renderCallbackOutputOnly` call `std::vector::assign/resize` on the RT thread. After `AudioOutputUnitStart`, query the actual buffer size and pre-size all working vectors before the first callback.

**Affected files:** `emulator/runtime/core_audio_device.cpp`, `emulator/runtime/audio_engine.cpp`

**DoD:**
- After `AudioOutputUnitStart`, `impl_->in_interleaved`, `impl_->out_interleaved`, `impl_->silentInput`, `impl_->workOut` are pre-sized to the actual hardware frame count (queried via `kAudioDevicePropertyBufferFrameSize`)
- No `assign/resize` occurs inside `renderCallback` or `renderCallbackOutputOnly` during normal operation
- First callback on a USB device with 512-frame minimum produces no xrun

---

### fix: Runtime-narrow IPC and webview message fields (FR-QA-2)

`msg['kind'] as string`, `msg['running'] as boolean`, and similar casts throughout `extension.ts`, `scope-panel.ts`, `controls-view-provider.ts`, and `manager.ts` bypass TypeScript's type checker.

**Affected files:** `src/extension.ts`, `src/webview/scope-panel.ts`, `src/sidebar/controls-view-provider.ts`, `src/emulator/manager.ts`

**DoD:**
- A shared narrow-helper module (`src/ipc/narrow.ts` or similar) provides `getString`, `getBoolean`, `getNumber` guard functions
- No `as T` casts remain on `IpcMessage` field accesses
- `as unknown as vscode.DebugProtocolMessage` in `run-config-provider.ts` replaced with a documented single-cast or typed interface

---

### fix: Extract sendPostDeployState helper (FR-QA-3)

The post-deploy state block (`sendPotSnapshot`, `sendButtonSnapshot`, `sendSine`, `sendAudioMode`, `sendAudioDevice`, optional WAV) is copy-pasted in two places in `extension.ts`.

**Affected files:** `src/extension.ts`

**DoD:**
- A single private `sendPostDeployState()` function is called from both `performBuildAndDeploy` and the `ds-ide.deploy` command handler
- `grep -n sendPotSnapshot src/extension.ts` returns one result inside that function

---

### fix: Track and unlink UNIX socket files on dispose (FR-EXT related)

`socketPath` is a local variable in `deploy()`; `dispose()` cannot unlink it. On crash or repeated deploys, `/tmp/daisy_emu_*.sock` files accumulate.

**Affected files:** `src/emulator/manager.ts`

**DoD:**
- `socketPath` stored as `private socketPath: string | null`
- `killExisting()` unlinks `this.socketPath` after killing the process
- Extension `activate()` scans `/tmp/daisy_emu_*.sock` on startup and removes stale entries

---

### fix: Validate SPSC push return value and count drops (FR-QA-1)

`ipc_send` discards the `bool` return of `ipc_queue.push()`; with `SCOPE_BLOCKS=33 > CAPACITY=32`, messages are silently dropped.

**Affected files:** `emulator/runtime/audio_engine.cpp`, `emulator/runtime/emulator_state.h`

**DoD:**
- `CAPACITY` increased from 32 to ≥ 64
- `ipc_send` increments `g_state.ipc_queue_drops` (atomic counter) on drop
- The drop count is reported in a periodic diagnostic IPC event or stderr line

---

### fix: Check lseek return values in SessionPlayer::countBlocks (FR-QA-4)

Silent seek failures on corrupt `.dsrec` files produce incorrect `total_blocks_` counts.

**Affected files:** `emulator/runtime/session_player.cpp`

**DoD:**
- Each `::lseek()` in the scan loop breaks on return value < 0
- A corrupted file produces a 0 or partial block count with no crash

---

### fix: Add IPC receive buffer maximum size guard (FR-QA-5)

`partial` in `run_ipc_server` grows without bound on malformed (no-newline) input.

**Affected files:** `emulator/runtime/ipc_server.cpp`

**DoD:**
- If `partial.size() > 1 MB`, the client is disconnected and a diagnostic is emitted to stderr
- The emulator process continues running after disconnection

---

### fix: Validate socket path length before strncpy (FR-QA-6)

Paths ≥ 104 chars are silently truncated; `bind` fails with a confusing error.

**Affected files:** `emulator/runtime/ipc_server.cpp`

**DoD:**
- If `strlen(socket_path) >= sizeof(addr.sun_path)`, log to stderr and return before `bind`
- In practice the extension generates paths well under 104 bytes; this is a defensive guard

---

### fix: Use std::memcpy for decode_pcm32 bit reinterpretation (FR-QA-7)

`static_cast<int32_t>(uint32_t)` for high-bit-set values is implementation-defined in C++17.

**Affected files:** `emulator/runtime/wav_reader.cpp`

**DoD:**
- `decode_pcm32` uses `std::memcpy(&v, &u, sizeof(v))`; behavior is defined in C++17 and C++20
- Existing WAV playback tests pass

---

### fix: Eliminate truncId duplication (FR-QA-8)

`truncId` is exported from `controls-view-provider.ts` and re-implemented identically inside its own embedded JS string.

**Affected files:** `src/sidebar/controls-view-provider.ts`

**DoD:**
- The embedded JS string injects `truncId` via a `safeJson`-escaped constant rather than re-implementing it
- One call site, zero duplication

---

### fix: detectNonPortableSymbol returns all undefined symbols (FR-QA-9)

Early return on first match means users see only one non-portable symbol per build.

**Affected files:** `src/diagnostics/non-portable.ts`

**DoD:**
- Returns `string[]`; caller joins them in the diagnostic message
- Users see all non-portable symbols in one build failure message

---

### fix: Replace magic numbers with named constants (FR-QA-10)

`10000`, `1 << 20`, `50`, `'-j4'` used without names in manager.ts, ipc-client.ts, run-config-provider.ts.

**Affected files:** `src/emulator/manager.ts`, `src/emulator/ipc-client.ts`, `src/debug/run-config-provider.ts`

**DoD:**
- `SOCKET_TIMEOUT_MS = 10_000`, `IPC_MAX_BUFFER = 1 << 20`, `DAP_TERMINATE_DELAY_MS = 50` declared as named constants
- CMake parallel jobs use `String(os.cpus().length)` instead of `'-j4'`

---

### fix: Cancel pending setTimeout in DsIdeTerminatingAdapter.dispose() (FR-QA-11)

The 50 ms timer fires on a disposed `EventEmitter` if `dispose()` is called first.

**Affected files:** `src/debug/run-config-provider.ts`

**DoD:**
- Timer handle stored as `private _terminateTimer`; `dispose()` calls `clearTimeout` before `_emitter.dispose()`

---

### fix: Add range validation to webview message handlers (FR-QA-12)

Pot channel, pot value, output volume, and audio source enum are forwarded over IPC without range checks in `controls-view-provider.ts` and `scope-panel.ts`.

**Affected files:** `src/sidebar/controls-view-provider.ts`, `src/webview/scope-panel.ts`

**DoD:**
- Channel `0–11`, value `0–1`, volume `0–1`, and `'sine'|'live'|'wav'` enum are validated before `manager.send*` calls
- Pattern follows `wiring-view-provider.ts` (existing reference)

---

### fix: Make outputChannel required in debugDeploy (FR-QA-13)

The optional fallback `createOutputChannel` path creates an untracked, undisposed `OutputChannel`.

**Affected files:** `src/commands/debug-deploy.ts`

**DoD:**
- `outputChannel` is a required parameter; the fallback `createOutputChannel` path is removed
- All existing call sites already provide the argument

---

### fix: Remove redundant activationEvents from package.json (FR-QA-14)

Two entries are auto-inferred by VS Code ≥ 1.74; explicit declaration is a maintenance burden.

**Affected files:** `package.json`

**DoD:**
- `activationEvents` field removed (or reduced to only entries not inferable from `contributes`)
- Extension activates correctly on `onDebugResolve:ds-ide` and `onDebugAdapterProtocolTracker:ds-ide` via automatic inference

---

### fix: Generate fresh CSP nonce per ScopePanel.html() call (FR-QA-15)

The nonce is stored in the constructor; the same value is reused on every `show()`.

**Affected files:** `src/webview/scope-panel.ts`

**DoD:**
- `html()` generates `randomBytes(16).toString('base64')` on each call
- CSP header in the generated HTML always contains the freshly generated nonce

---

### fix: Target only modified line ranges in wire/unwire WorkspaceEdit (FR-QA-16)

Full-file replacement creates a coarse undo step.

**Affected files:** `src/extension.ts`

**DoD:**
- Wire/unwire handlers compute line ranges for the `ds-ide:controls:begin…end` and `init:begin…end` marker blocks and issue targeted `edit.replace` calls covering only those blocks
- Undo after a wire operation reverts only the inserted line, not the entire file

---

### fix: Info message when ds-ide operates on first folder in a multi-root workspace (FR-QA-17)

Silent first-folder assumption confuses users with multiple Daisy projects open simultaneously.

**Affected files:** `src/extension.ts`

**DoD:**
- When `workspaceFolders.length > 1`, a one-time info message states `"ds-ide: multiple workspace folders detected — operating on '${folders[0].name}'"` (suppressed after first show per session)

---

### fix: Consolidate findEffectSource to one async implementation (FR-QA-18)

`detectEffectSrc` (sync) and `findEffectSource` (async) solve the same problem with diverging scope.

**Affected files:** `src/commands/build.ts`, `src/extension.ts`

**DoD:**
- A single exported `findEffectSource(projectRoot: string): Promise<string | undefined>` in a shared module checks root, `src/`, and `source/` directories (unified scope)
- Both former call sites import and use the shared function

---

### fix: Store s_mach_ns_per_tick as a struct member before AudioOutputUnitStart (FR-QA-19)

Plain `static double` read from the RT thread without memory ordering guarantee.

**Affected files:** `emulator/runtime/core_audio_device.cpp`

**DoD:**
- Value stored in `Impl` struct, set before `AudioOutputUnitStart` (natural publication barrier)
- No plain `static` global shared between construction thread and RT thread

---

### fix: Extract webview JS to typed TypeScript entry points (FR-QA-20) ✅

`controls-view-provider.ts`, `scope-panel.ts`, and `wiring-panel.ts` embed hundreds of lines of untyped, untested JS in template strings.

**Affected files:** `src/sidebar/controls-view-provider.ts`, `src/webview/scope-panel.ts`, `src/wiring/wiring-panel.ts`, `esbuild.js`, new files under `src/webview/`

**DoD:**
- Webview JS extracted to `src/webview/controls-webview.ts`, `src/webview/scope-webview.ts`, `src/webview/wiring-webview.ts`
- esbuild compiles these as separate entry points; extension host injects URIs via `asWebviewUri`
- TypeScript compiler checks all extracted webview code; `tsc --noEmit` passes with no new errors
- All existing manual tests (controls drag, scope display, wiring pin assignment) pass
