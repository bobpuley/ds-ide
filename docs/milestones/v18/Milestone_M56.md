# M56 — Extension Reliability & Validation Hardening

**Version:** 0.17.4
**Status:** planned
**Source:** parallel code-review reconciliation (`docs/06_nodejs_review.md`, 2026-08-25)

## Goal

Close the 15 MEDIUM findings spanning runtime safety, async/concurrency, validation, error handling, and security-adjacent duplication that didn't rise to HIGH but each represent a real reliability or correctness gap (line-splitting bugs, missing escalation/timeouts, unguarded parsing, silent data loss, unenforced message contracts). After this milestone, none of these paths can silently corrupt data, leak resources, or fail without user-visible feedback.

## Sprint Tasks

### [x] fix: buffer partial stdout/stderr lines across chunk boundaries (FR-EXT-12)

Both `hardware-build.ts` and `dfu-flash.ts` split each raw `'data'` chunk on `'\n'` independently with no carry-over buffer, so a diagnostic or the dfu-util success string split across a chunk boundary is dropped or misreported.

**Affected files:** `src/commands/hardware-build.ts`, `src/commands/dfu-flash.ts`

**DoD:**
- Both handlers keep a trailing incomplete segment across `'data'` events and prepend it to the next chunk before splitting on `'\n'`
- A diagnostic or the dfu-util success string artificially split across two chunks is still detected correctly

---

### [x] fix: escalate killExisting() to SIGKILL like killStalePid (FR-EXT-13)

`killExisting()` sends SIGTERM only, unlike `killStalePid`'s documented SIGTERM → wait → SIGKILL escalation, so a live child that ignores/misses SIGTERM (e.g. blocked in a native audio callback) is never force-terminated.

**Affected files:** `src/emulator/manager.ts`

**DoD:**
- `killExisting()` applies the same SIGTERM → wait `KILL_ESCALATION_MS` → SIGKILL escalation as `killStalePid`
- A child process that ignores SIGTERM is still terminated within `KILL_ESCALATION_MS`

---

### [x] fix: guard each HostMidiBridge port-open call individually (FR-EXT-14)

Only the initial port-count probe is try/caught; a throw from `openPort(i)` inside the per-port loop propagates out of `start()` and, since it's called unguarded during `activate()`, out of `activate()` itself.

**Affected files:** `src/midi/host-bridge.ts`

**DoD:**
- Each `openPort`/`on` pair in the port-enumeration loop has its own try/catch
- A throw from one bad port does not prevent other ports from opening or propagate out of `start()`/`activate()`

---

### [x] fix: close HostMidiBridge's probe Input after port-count read (FR-EXT-15)

The `Input` instance created solely to call `getPortCount()` is discarded without `closePort()`, holding an underlying native handle GC won't necessarily reclaim promptly.

**Affected files:** `src/midi/host-bridge.ts`

**DoD:**
- `probe.closePort()` is called immediately after `getPortCount()` returns

---

### [x] feat: add timeout/cancellation to long-running child processes (FR-EXT-16)

None of `make`, `dfu-util`, or emulator build/deploy accept an `AbortSignal`/cancellation token, and their progress UI isn't marked cancellable, so a hung process leaves the command's promise pending forever with no way to abort short of reloading the extension host window.

**Affected files:** `src/commands/hardware-build.ts`, `src/commands/dfu-flash.ts`, `src/commands/build.ts`, `src/commands/deploy.ts`, `src/commands/debug-deploy.ts`, `src/debug/run-config-provider.ts`

**DoD:**
- These operations accept a timeout or `CancellationToken` wired to `proc.kill()`
- `withProgress` calls for these operations are marked `cancellable: true` where applicable

---

### [x] fix: guard atob()/decodeOledFrame against malformed base64 (FR-EXT-17)

`decodeOledFrame` calls `atob(base64)`, which throws on invalid input, directly inside a `'message'` event listener with no try/catch — breaking the OLED preview for the rest of the session on a corrupted IPC frame.

**Affected files:** `src/webview/oled-frame.ts`, `src/webview/oled-webview.ts`, `src/webview/controls-webview.ts`

**DoD:**
- `decodeOledFrame`/`atob` calls are wrapped in try/catch
- Malformed base64 input shows a degraded "frame decode error" state instead of throwing uncaught inside the message listener

---

### [x] fix: prevent dispose()/deploy() race from orphaning a spawned child (FR-EXT-18)

`deploy()` assigns `this.childProcess` only after `spawn()` returns; if `dispose()` runs in between, it finds `childProcess === null` and does nothing, but the deploy's `spawn()` still executes afterward with nothing left to kill it.

**Affected files:** `src/emulator/manager.ts`

**DoD:**
- Deploy-in-progress state is tracked and checked in `dispose()`
- A `dispose()` call racing an in-flight `deploy()` either awaits/cancels it or kills the resulting child, with no orphaned process left behind

---

### [x] fix: attach error handlers to fire-and-forget workspaceState.update() calls (FR-EXT-19)

Three store classes discard the promise returned by `workspaceState.update()` via bare `void`, so a rejection (storage error, disk full) becomes an unhandled promise rejection.

**Affected files:** `src/controllers/button-store.ts`, `src/controllers/toggle-store.ts`, `src/controllers/pot-store.ts`

**DoD:**
- Each `void this.workspaceState.update(...)` call attaches a `.catch(err => ...)` handler instead of discarding silently

---

### [x] fix: round-trip labels with embedded newlines in the hand-rolled YAML parser (FR-EXT-20)

`yamlQuote()` escapes `\` and `"` but not newlines, and the reader is strictly line-based, so a label containing `\n` (freely typeable in the Controls Editor) is corrupted or lost on the next read.

**Affected files:** `src/controllers/controller-config.ts`

**DoD:**
- `yamlQuote()` escapes `\n`/`\r`/control characters so multi-line labels serialize on one physical line
- A label containing an embedded newline round-trips through save/load without a parse error or data loss

---

### [ ] fix: cross-validate gpio_pin upper bound against the pin table (FR-EXT-21)

`controller-config.ts` validates `gpio_pin` against a hardcoded upper bound of 31, but the pin table's highest defined pin is 30, so a `gpio_pin: 31` entry passes validation but can never render or participate in conflict checks.

**Affected files:** `src/controllers/controller-config.ts`, `src/devices/pin-table.gen.ts`

**DoD:**
- The `gpio_pin` validation bound is derived from `PIN_DEFS` (or a single shared constant) instead of a hardcoded `31`
- A `gpio_pin` value beyond the pin table's actual maximum is rejected at validation time

---

### [ ] fix: runtime-validate postMessage payloads in *-webview.ts files (FR-EXT-22)

Every `window.addEventListener('message', ...)` handler annotates `e.data` with a declared type but never checks at runtime that it matches, so a drift between the two sides fails silently instead of surfacing an error.

**Affected files:** `src/webview/controls-webview.ts`, `src/webview/scope-webview.ts`, `src/webview/oled-webview.ts`, `src/webview/midi-webview.ts`, `src/webview/wiring-webview.ts`

**DoD:**
- Each handler runs incoming `e.data` through a runtime type guard derived from the `messages.ts` union before acting on its fields
- A malformed/unexpected message shape is rejected/ignored rather than acted on with unchecked field access

---

### [ ] fix: distinguish ENOENT from other fs.stat failures in create-effect-project.ts (FR-EXT-23)

A blanket `catch {}` around a `stat` call assumes any failure means "not found," so a permission-denied or unavailable-drive failure is treated the same and the code proceeds to create the directory regardless.

**Affected files:** `src/commands/create-effect-project.ts`

**DoD:**
- The existence check inspects the error code (`ENOENT` / the `vscode.FileSystemError` equivalent) instead of assuming non-existence on any failure
- A permission-denied or unavailable-drive stat failure surfaces a specific error message instead of proceeding

---

### [ ] fix: wrap create-effect-project.ts's final openFolder step in try/catch (FR-EXT-24)

The last statement in the function — opening the newly-created folder — sits outside both try/catch blocks in the file, unlike every other failure path in the same function.

**Affected files:** `src/commands/create-effect-project.ts`

**DoD:**
- The `vscode.openFolder` call is wrapped in try/catch consistent with the rest of the function
- A thrown error from `openFolder` surfaces via `showErrorMessage` instead of an unhandled rejection

---

### [ ] fix: surface IpcClient 'warning' events through EmulatorManager (FR-EXT-25)

`EmulatorManager.connectIpc` wires up `message`/`error`/`disconnect` listeners on `IpcClient` but never registers or re-exposes the `'warning'` event, so dropped/malformed IPC traffic is invisible outside `console.warn`.

**Affected files:** `src/emulator/ipc-client.ts`, `src/emulator/manager.ts`, `src/extension.ts`

**DoD:**
- `EmulatorManager` forwards `IpcClient`'s `'warning'` event, mirroring existing `'error'`/`'disconnect'` forwarding
- Warnings are surfaced via the existing `emulatorChannel` output channel

---

### [ ] refactor: centralize the duplicated safeJson() escaping helper (FR-EXT-26)

The `</script>`-breakout-prevention helper used when embedding config/pin-def JSON into data islands is copy-pasted identically across two panel files instead of centralized.

**Affected files:** `src/sidebar/controls-editor-panel.ts`, `src/wiring/wiring-panel.ts`

**DoD:**
- `safeJson()` is defined once in a shared module (e.g. `src/webview/html-safe.ts`) and imported by both panel files
- No behavior change; both panels still escape `</>/&` identically
