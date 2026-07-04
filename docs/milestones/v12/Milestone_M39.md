# M39 — IPC & Data Validation Hardening

**Version:** 0.13.1
**Status:** in progress
**Source:** 2026-07-02 Node.js/TypeScript + VS Code extension code reviews — MEDIUM findings (deduplicated where both reviews independently flagged the same bug)

## Goal

Treat the IPC boundary and webview boundary as untrusted in both directions, close the deploy-hang risk, and give the highest-churn UI code (webview scripts) a static safety net. After M39, malformed or unexpected messages from the emulator or a webview degrade gracefully instead of throwing, corrupting state, or silently misleading the user, and a wedged emulator process cannot brick the deploy pipeline for the rest of the session.

## Sprint Tasks

### [x] fix: Bound the IPC connect phase with a timeout (FR-IPC-1)

`deploy()`'s 10s timeout only guards the socket-announcement phase; `resolved = true` is set before `connectIpc()` completes, and `IpcClient.connect()` has no timeout of its own — a wedged emulator that announces its socket but never accepts the connection leaves the coalesced deploy promise (and every subsequent deploy call, since they coalesce on it) pending forever.

**Affected files:** `src/emulator/manager.ts`, `src/emulator/ipc-client.ts`

**DoD:**
- The deploy timeout remains active through `connectIpc()` completion (`resolved` is not set until connect settles), or `IpcClient.connect()` carries its own timeout via `Promise.race`
- Simulating an emulator that announces its socket but never accepts a connection causes `deploy()` to reject within a bounded time (e.g. 5s)
- A subsequent deploy attempt after the rejection succeeds normally (the lock clears)

---

### [x] fix: Validate IPC messages at the socket boundary; stop spreading raw messages into webviews (FR-IPC-2)

IPC messages are parsed with bare `JSON.parse` into an untyped record and mostly forwarded unchecked; `postStatus` spreads the entire untrusted message into webview `postMessage` calls, reaching an `innerHTML` sink in the scope webview and an unguarded `.toUpperCase()` call.

**Affected files:** `src/emulator/ipc-client.ts`, `src/webview/scope-panel.ts`, `src/sidebar/controls-editor-panel.ts`, `src/webview/scope-webview.ts`, `src/ipc/narrow.ts`

**DoD:**
- A discriminated-union schema for the IPC protocol is validated in `narrow.ts` (or equivalent) at the point messages are parsed; malformed messages are logged and dropped
- Only explicitly whitelisted, typed fields are forwarded to webviews — `grep -rn '\.\.\.msg' src/webview src/sidebar` returns no matches in message-forwarding code
- Webviews render status text via `textContent`, never `innerHTML`, from message-derived values
- `msg.kind.toUpperCase()` (and similar) is guarded with a `typeof` check first

---

### [ ] fix: Validate `editorSave` webview payload shape; quote serialized ids (FR-IPC-3)

The `editorSave` handler casts the webview payload directly to `ControllerConfig` and feeds it to `serializeControllerConfig`, which dereferences array fields without a shape check. Serialized `id` values are unquoted, so an id containing `:`/`#` silently round-trips to a different id.

**Affected files:** `src/sidebar/controls-editor-panel.ts`, `src/controllers/controller-config.ts`, `src/webview/controls-webview.ts`

**DoD:**
- `m['cfg']` is structurally validated (arrays present, items well-formed) before being passed to `serializeControllerConfig`, or the round trip is wrapped in try/catch with a user-visible warning
- Serialized `id` fields pass through `yamlQuote` (or a `/^[A-Za-z_]\w*$/` allowlist) on both serialization and editor input
- Posting `{ cfg: { pots: [{}] } }` does not throw inside the extension host message handler
- An id containing `:` or `#` is rejected or safely escaped, never silently altered on round-trip

---

### [ ] fix: Distinguish absent config from unreadable config (FR-IPC-4)

`loadControllerConfig()` treats any read failure — including transient `EACCES`/`EMFILE`/encoding errors — as "no config," returning an empty config that a subsequent save can write back over the user's real file.

**Affected files:** `src/extension.ts`

**DoD:**
- `ENOENT` is treated as "legitimately empty"; any other error surfaces a warning and marks the returned config `unreadable: true`
- Save paths refuse to write while `unreadable: true`
- A simulated transient read error followed by a save action does not overwrite `controllers.yaml`

---

### [ ] fix: Check `applyEdit` results; keep Wiring and Controls views consistent (FR-IPC-5)

Wire/unwire handlers ignore the boolean result of `applyEdit` and rebuild Controls Editor state by re-reading the source **from disk**, so the two views disagree until a manual save (or claim success when the edit actually failed). `makeBlockEdit`'s marker search also mis-pairs ranges when a marker line is duplicated.

**Affected files:** `src/extension.ts`

**DoD:**
- The `applyEdit` boolean result is checked; `false` surfaces a visible error and does not update either view
- After a successful edit, either the document is saved or `buildControlsConfig` consumes the already-known in-memory text instead of re-reading disk
- A duplicated marker line is rejected or handled via a safe full-file fallback (not a silent wrong-range edit)
- Both views reflect the same state after a wiring operation, without requiring a manual save

---

### [ ] fix: Type-check and unit-test the webview scripts (FR-IPC-6)

All three webview scripts (`controls-webview.ts`, `scope-webview.ts`, `wiring-webview.ts`, ~1,000 lines) opt out of TypeScript with `@ts-nocheck`; `tsconfig.json` also excludes `src/test`, so test-file type errors go unnoticed too.

**Affected files:** `src/webview/controls-webview.ts`, `src/webview/scope-webview.ts`, `src/webview/wiring-webview.ts`, `tsconfig.json`

**DoD:**
- `@ts-nocheck` is removed from all three webview scripts
- Webviews use their own `tsconfig.webview.json` (`lib: ["ES2022", "DOM"]`) — depends on the esbuild platform split landing first (see FR-QA-EXT-1, M42; land together if scheduling allows)
- The host↔webview message protocol is a shared discriminated union imported by both sides
- `tsc --noEmit` covers `src/test`
- Knob-math, id-validation, and wired-pin state-transition logic are extracted into non-DOM modules with unit test coverage

---

### [ ] fix: Extract deploy sequencing into a single coordinator (FR-IPC-7)

`activate()` is a 396-line function; the post-deploy state replay sequence (`sendPotSnapshot`, `sendButtonSnapshot`, `sendSine`, `sendAudioMode`, `sendAudioDevice`, WAV state) exists three times with slight variations, and divergence has already occurred between them.

**Affected files:** `src/extension.ts`

**DoD:**
- A `DeployCoordinator` owns `performDeploy`, `sendPostDeployState`, and status-bar transitions
- A `SessionState` object owns `sineState`/`audioSourceState`/`activeRecordPath` persistence
- `ds-ide.deploy` and `ds-ide.debug` call the same coordinator method with flags instead of re-implementing the sequence
- `grep -n sendPotSnapshot src/extension.ts` (or its extracted successor) shows a single call site
