# 03 — Requirements (v8)

> **v7 complete** — all v7 requirements implemented; ACs green.
> Archived: [`docs/v7/03_requirements.md`](v7/03_requirements.md).

*v8 requirements defined below (code-review intake 2026-06-21).*

---

## FR-ES — Extension Security (v8)

**FR-ES-1** — All webview HTML pages shall include a nonce-based Content Security Policy. A random nonce shall be generated per webview instantiation, included in a `<meta http-equiv="Content-Security-Policy">` tag, and applied as a `nonce` attribute to every inline `<script>` block. The CSP shall be `default-src 'none'; script-src 'nonce-{nonce}'; style-src 'unsafe-inline';`. `localResourceRoots: []` shall be set on all `WebviewPanel` and `WebviewView` options where no file-system resources are loaded.
- **AC-60** — Open each of the three webviews (ScopePanel, Controls Editor, Wiring Editor); in VS Code Developer Tools confirm a `<meta http-equiv="Content-Security-Policy">` tag is present and each `<script>` tag carries a matching `nonce` attribute. Confirm no CSP violation is logged. *(FR-ES-1)*

**FR-ES-2** — The extension host shall validate all fields of incoming webview messages before invoking side-effecting operations. For `wirePin` / `unwirePin`: `pinNumber` must be a finite integer 0–31; `deviceType` must be one of `'pot' | 'button' | 'led'`; `id` must match `^[a-zA-Z_][a-zA-Z0-9_]*$`. Messages failing any check shall be silently dropped. For `editorSave`: the received `cfg` object shall be re-validated by passing it through `parseControllerConfig(serializeControllerConfig(cfg))` before writing to disk. For `audioSource` messages: `sampleRate` must be in `[8000, 22050, 44100, 48000]`; `bufferSize` must be a power of two in `[64, 512]`.
- **AC-61** — Send a crafted webview message with `id: "foo.bar"` (invalid identifier); verify the host handler drops it without modifying source files. Send `pinNumber: 999`; verify it is dropped. Send a malformed `cfg` object; verify it is rejected and `controllers.yaml` is not written. *(FR-ES-2)*

---

## FR-EQ — Extension Quality (v8)

**FR-EQ-1** — `IpcClient.onData` shall enforce a maximum buffer size of 1 MB on the `partial` field. If the buffer exceeds this limit before a newline is found, the buffer shall be cleared and an `'error'` event shall be emitted.
- **AC-62** — Feed `IpcClient` a data stream with no newline characters totalling > 1 MB; verify an `'error'` event is emitted and `partial` is empty afterward. *(FR-EQ-1)*

**FR-EQ-2** — `EmulatorManager.deploy()` shall be re-entrant safe. A second concurrent call shall be serialised behind the first (or return early with a clear error). No two `effect_emu` processes shall run simultaneously from the same manager instance.
- **AC-63** — Call `deploy()` twice in rapid succession without awaiting the first; verify only one child process is spawned and no orphaned processes remain after both calls complete. *(FR-EQ-2)*

**FR-EQ-3** — `deployToEmulator` shall return `Promise<boolean>` (true = success, false = failure). On failure it shall show the error message and return false. All callers in `extension.ts` shall check the return value and skip post-deploy IPC calls when deploy failed. The status bar shall reset to "stopped" on deploy failure.
- **AC-64** — Trigger a deploy to a non-existent binary; verify the error is shown, the return value is false, the status bar shows stopped, and no IPC messages are sent afterward. *(FR-EQ-3)*

**FR-EQ-4** — Output channels (`'Daisy IDE Build'`, `'Daisy IDE Emulator'`, `'Daisy IDE Hardware Build'`) shall be created once during `activate()` and reused across invocations. Channels shall be added to `context.subscriptions`. After 5 build/deploy cycles the Output panel dropdown shall contain each channel name exactly once.
- **AC-65** — Run build + deploy 5 times; open the Output panel dropdown; verify exactly one `'Daisy IDE Build'` and one `'Daisy IDE Emulator'` entry are present. *(FR-EQ-4)*

**FR-EQ-5** — All synchronous filesystem calls in the activation path (`findEffectSource`, `loadControllerConfig`, `initViewsFromProject`) shall be replaced with async equivalents (`fs.promises.*`). `initViewsFromProject` shall be called as a fire-and-forget from `activate()` so activation returns synchronously. The `onDidSaveTextDocument` handler shall be made async, and the early-exit check (is the saved file the effect source or YAML?) shall occur before any filesystem reads.
- **AC-66** — Verify `activate()` returns synchronously (before any file reads complete) by inspecting the call order in unit tests. Verify the save handler performs zero filesystem operations when an unrelated file is saved. *(FR-EQ-5)*

**FR-EQ-6** — The disposables returned by `vscode.debug.onDidStartDebugSession` and `vscode.debug.onDidTerminateDebugSession` shall be pushed to `context.subscriptions`.
- **AC-67** — Unit test verifies that after `deactivate()` the debug session event listeners are disposed (mock call confirms `.dispose()` was called). *(FR-EQ-6)*

**FR-EQ-7** — `ScopePanel` shall remove its `manager.on('message', …)` listener when `dispose()` is called. The listener shall be stored as a named field so `manager.off(…)` can be called. After `dispose()` and re-creation of 12 new ScopePanel instances attached to the same manager, no `MaxListenersExceededWarning` shall be emitted.
- **AC-68** — Create and dispose 12 ScopePanel instances sequentially against the same manager mock; verify no `MaxListenersExceededWarning` appears in test output. *(FR-EQ-7)*

**FR-EQ-8** — `controls-writer.ts` edge-case test coverage: add parameterised tests for: (a) insert when the init block is absent but the declaration block is present; (b) remove when the init block contains lines from other controls that must be preserved; (c) `adcInitLine` regeneration when pots are partially removed; (d) duplicate ID annotation in the declaration block.
- **AC-69** — All four scenarios pass as unit tests in `controls-writer.test.ts`. *(FR-EQ-8)*

**FR-EQ-9** — Low-severity extension quality improvements (completed in M28):
- **AC-70** — `safeJson` in `controls-view-provider.ts` and `wiring-panel.ts` uses full JSON-in-HTML escaping: `<`, `>`, `&` replaced with `<`, `>`, `&` after `JSON.stringify`.
- **AC-71** — `parseBuildLine` regex handles Windows drive-letter paths (`C:\path\file.cpp:12:5:`); a Windows-path test case is added to `build-diagnostics.test.ts`.
- **AC-72** — `detectEffectSrc` falls back to `src/*.cpp` and `source/*.cpp` subdirectories when no `.cpp` is found at the project root; the error message references the `ds-ide.effectSource` setting.
- **AC-73** — Dead `WiringPanel` class (lines 80–136 of `wiring-panel.ts`) is removed; only types, `PIN_DEFS`, and `buildHtml` are exported from that file.
- **AC-74** — `deactivate()` no longer double-disposes `manager` and `scopePanel`; disposal is handled in exactly one place (either `context.subscriptions` or `deactivate()`, not both).
- **AC-75** — `package.json` adds `icon`, `repository`, `keywords`, and `homepage` fields; `categories` includes `"Debuggers"`.
- **AC-76** — `retainContextWhenHidden: true` is removed from both sidebar webview registrations; existing `_flush()` and `postWiredPins` rehydration logic correctly restores state after the view is re-shown.
- **AC-77** — `extension.ts` non-null `!` assertions are eliminated; module-level singletons are encapsulated in a single object initialized at the start of `activate()`.
- **AC-78** — `extension.test.ts` resets module-level state between tests via `vi.resetModules()` and dynamic re-import; the `toBe(21)` subscription count assertion is replaced with targeted per-registration assertions.
- **AC-79** — All `WebviewPanel` creations that load no file-system resources set `localResourceRoots: []` in their options.
- **AC-80** — Numeric values (`freq`, `amplitude`, `sampleRate`, `bufferSize`, `wavLoop`) inlined into webview HTML attributes in `scope-panel.ts` are coerced via `Number(…) || default` before interpolation.
- **AC-81** — `controls-writer.test.ts` covers the edge case where `removeInitFromSource` is called with an ID that is a prefix of another control's ID (e.g., `vol` and `volume`), confirming no accidental line deletion.
