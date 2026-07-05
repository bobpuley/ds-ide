# 04 — Architecture (v12)

> **v11 complete** — full v11 architecture in
> [`docs/v11/04_architecture.md`](v11/04_architecture.md).

## v12–v13 Architecture Notes

### Overall system design — unchanged

The two-process architecture (VS Code extension ↔ native emulator process over a UNIX domain socket) is unchanged across v11–v13. No new processes and no IPC transport changes are required; several fixes change *what* is sent over existing channels or *where in the codebase* work happens, not the transport itself.

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

The remaining v12–v13 fixes are localized to their implementation files and require no architectural decisions:

- CoreAudio error checking, `System::Delay` drift, pot clamping, `PrintLine` fidelity, build flags: localized to `emulator/runtime/core_audio_device.cpp`, `emulator/shim/src/*`, `emulator/CMakeLists.txt`.
- `json_get` escape handling and substring-key matching: localized to `emulator/runtime/ipc_server.cpp` (a real JSON tokenizer would be an architecture change; the minimum fix applied here is not).
- WAV validation ordering, recorder write-error reporting, recorder shutdown/destructor: localized to `wav_reader.cpp`, `session_recorder.cpp`, `main.cpp`.
- `editorSave` payload validation, config-read error handling, wiring `applyEdit` result checks, multi-root workspace resolution, notification aggregation, output-channel lifecycle, workspace-state debouncing: all API-substitution or validation-addition fixes within `extension.ts` and the command/sidebar modules — no new modules or data flows.
- Marketplace metadata, configuration `scope` declarations, debug contribution snippets/progress UI: `package.json`-only or single-file changes.
