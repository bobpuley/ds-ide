# M55 — Extension Critical Fixes

**Version:** 0.17.3
**Status:** planned
**Source:** parallel code-review reconciliation (`docs/06_nodejs_review.md`, 2026-08-25)

## Goal

Close the six remaining HIGH-severity findings from the Node.js/TypeScript review: an uncaught-throw crash risk, an orphaned child process, an unhandled rejection, a silently-ignored user setting, unsanitized input reaching generated C++ source, and the oversized `activate()` function that made several of these gaps easy to miss in the first place. After this milestone, the Extension Host cannot be crashed or destabilized by any of these paths, and `activate()` is decomposed enough that similar cross-cutting gaps are easier to catch by inspection.

## Sprint Tasks

### [x] fix: register production error listener on EmulatorManager (FR-EXT-6)

`activate()` never registers an `'error'` listener on `EmulatorManager`. Node's `EventEmitter` throws in-process on an unhandled `'error'` emission, so any raw socket error can crash the Extension Host for the entire VS Code window.

**Affected files:** `src/extension.ts`, `src/emulator/manager.ts`, `src/emulator/ipc-client.ts`

**DoD:**
- `activate()` registers `manager.on('error', ...)` alongside the existing `message`/`disconnect` listeners
- An `'error'` emission surfaces via `showErrorMessage` + the `emulatorChannel` output channel instead of throwing
- A test constructs the same manager wiring `activate()` does and asserts an `'error'` emission does not crash the process (this also satisfies FR-EXT-39)

---

### [x] fix: kill spawned emulator child when the IPC handshake fails (FR-EXT-7)

`connectIpc()`'s rejection path only closes the socket; the already-spawned `effect_emu` child process is left running, orphaned until the next stale-PID reaper or clean `dispose()`.

**Affected files:** `src/emulator/manager.ts`

**DoD:**
- `connectIpc()`'s rejection path (connect timeout, malformed/version-mismatched handshake) explicitly calls `child.kill()` before propagating the rejection
- No orphaned `effect_emu` process remains after a failed handshake

---

### [x] fix: guard WiringViewProvider's message handler against unhandled rejection (FR-EXT-8)

The `async onDidReceiveMessage` callback awaits three file-I/O-performing handlers with no surrounding try/catch, unlike the equivalent handler in `controls-editor-panel.ts`.

**Affected files:** `src/sidebar/wiring-editor-panel.ts`

**DoD:**
- The three awaited handler calls are wrapped in try/catch
- A thrown error (e.g. a file-write permission error) surfaces via `showErrorMessage` instead of producing an unhandled promise rejection

---

### [x] refactor: decompose activate() into named factory functions (FR-EXT-9)

A single ~640-line function in `extension.ts` builds every store, panel, provider, and command registration inline via large inline closures — the same file where the `'error'`-listener gap and the `effectSource` gap both live, a direct consequence of the function's size making cross-cutting gaps easy to miss.

**Affected files:** `src/extension.ts`

**DoD:**
- View-provider construction, command registration, the save-listener logic, and status/message routing are extracted into named factory functions/modules that `activate()` merely composes
- `activate()` itself is materially shorter
- All existing tests continue to pass with no behavior change

---

### [ ] fix: honor ds-ide.effectSource in the build command (FR-EXT-10)

`build.ts` calls `findEffectSource(projectRoot)` with a single argument, so the configured-path branch is always skipped, even though the build failure message tells the user to set `ds-ide.effectSource`.

**Affected files:** `src/commands/build.ts`, `src/commands/find-effect-source.ts`, `src/extension.ts`

**DoD:**
- The build command threads the configured `ds-ide.effectSource` value into `findEffectSource`, sharing the same resolution/error-handling wrapper `extension.ts` already uses for the wiring-editor code paths
- A test with multiple/zero heuristic-matched `.cpp` files present and `effectSource` configured builds the configured file

---

### [ ] fix: reject invalid C++ identifiers in wiring id input (FR-EXT-11)

`validateId()` only checks for emptiness and duplication; the free-text `id` is interpolated unescaped into generated C++ declaration/init lines, so a value like `x; SystemInit(); //` can corrupt the generated `.cpp` file.

**Affected files:** `src/wiring/id-validation.ts`, `src/wiring/controls-writer.ts`

**DoD:**
- `validateId` rejects any value that is not a valid C++ identifier (or is a C++ reserved keyword)
- A test asserts an id like `x; SystemInit(); //` is rejected before reaching `controls-writer.ts`
- Existing valid ids continue to validate successfully
