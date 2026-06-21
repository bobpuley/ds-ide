# M29 — Extension Runtime Reliability

**Semver:** 0.8.3  
**Status:** released  
**Source:** `docs/06_nodejs_review.md` + `docs/06_vscode_extension_review.md` (2026-06-21)

Covers the eight MEDIUM-urgency runtime correctness findings: IPC safety, deploy race, error propagation, output channel leak, sync I/O in activation, listener disposal gaps, and controls-writer test coverage.

---

## Sprint Tasks

- [x] **FR-EQ-1 · AC-62** — Cap `IpcClient.partial` at 1 MB. After the append in `onData`, check `this.partial.length > 1 << 20`; if so, clear the buffer and emit an `'error'` event. *DoD: unit test feeds 1 MB+ of no-newline data and asserts the 'error' event fires and `partial` is empty afterward.*

- [x] **FR-EQ-2 · AC-63** — Guard `EmulatorManager.deploy()` against concurrent calls using a `deployLock: Promise<void> | null` field; a second call awaits the lock (or returns early) before proceeding. *DoD: two concurrent `deploy()` calls result in at most one spawned `effect_emu` process and no orphaned processes after both settle.*

- [x] **FR-EQ-3 · AC-64** — Change `deployToEmulator` to return `Promise<boolean>` (true = success). On failure, show the error message and return false. Update all call sites in `extension.ts` to skip post-deploy IPC calls (`sendPotSnapshot`, `sendSine`, `sendAudioMode`, etc.) when the return is false. Reset the status bar to "stopped" on failure. *DoD: failed deploy (missing binary) shows error, returns false, status bar resets, no IPC messages are sent afterward.*

- [x] **FR-EQ-4 · AC-65** — Create output channels (`'Daisy IDE Build'`, `'Daisy IDE Emulator'`, `'Daisy IDE Hardware Build'`) once during `activate()` and pass them as parameters to `buildForEmulator`, `deployToEmulator`, `debugDeploy`, and `buildForHardware`. Add channels to `context.subscriptions`. *DoD: 5 consecutive build + deploy cycles → exactly one channel entry per name in the Output panel dropdown.*

- [x] **FR-EQ-5 · AC-66** — Replace sync `fs.*` calls with `fs.promises.*` in `findEffectSource`, `loadControllerConfig`, and `initViewsFromProject`. Call `initViewsFromProject` as `void initViewsFromProject()` fire-and-forget from `activate()` so activation returns synchronously. Reorder `onDidSaveTextDocument` to check the saved file path before any I/O. *DoD: unit test confirms `activate()` returns before file reads complete; save handler performs zero filesystem reads when an unrelated file is saved.*

- [x] **FR-EQ-6 · AC-67** — Push the disposables returned by `vscode.debug.onDidStartDebugSession` and `vscode.debug.onDidTerminateDebugSession` to `context.subscriptions`. *DoD: unit test confirms both disposables are present in subscriptions after `activate()`.*

- [x] **FR-EQ-7 · AC-68** — Store the `ScopePanel` manager message handler as a named private field (`_onManagerMessage`); call `manager.off('message', this._onManagerMessage)` in `dispose()`. *DoD: 12 sequential create + dispose cycles on the same manager mock emit no `MaxListenersExceededWarning`.*

- [x] **FR-EQ-8 · AC-69** — Add parameterised edge-case tests to `controls-writer.test.ts`: (a) insert when init block is absent but declaration block is present; (b) remove when init block contains lines from other controls that must be preserved; (c) `adcInitLine` regeneration when pots are partially removed; (d) duplicate ID annotation in the declaration block. *DoD: all four test cases green.*
