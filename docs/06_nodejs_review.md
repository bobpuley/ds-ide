# Review Report

> **Intake tracking:** each finding ends with an `### Intake Status` section. "Intaken" means it is planned in a milestone (see the v28 registry in `docs/05_dev-plan.md`); "Pending" means it has not been intaken yet. Update the status when a finding is intaken or released.

Scope: every non-test TypeScript module under `./src` (about 14k lines; the extension host, the IPC client, the emulator manager, the toolchain installer, debug adapters, webview hosts and webview scripts). Tests under `src/test/` were read only to judge coverage.

Baseline: `tsconfig.json` has `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride` and `noPropertyAccessFromIndexSignature`. Non-test code has no `any`. No call uses `shell: true` or `exec(string)`; every child process goes through `spawn`/`execFile` with argv arrays. No synchronous filesystem calls were found in extension-host code. The Windows toolchain installer pins SHA-256 per archive, follows HTTPS-only redirects, stages under `.tmp-*`, and renames into place atomically. The findings below are what remains.

---

# Security

## IPC message whitelist can be bypassed or crashed through `Object.prototype` keys

### Description
`parseIpcMessage` (the FR-IPC-2 trust boundary between the emulator process and the extension host/webviews) dispatches on the untrusted `type` field by indexing a plain object literal: `NARROWERS[type]?.(obj)`. Because `NARROWERS` inherits from `Object.prototype`, a `type` that names an inherited member resolves to that member instead of `undefined`:

- `"constructor"` resolves to the global `Object` function. `Object(obj)` returns `obj` itself, so the **raw, un-narrowed message is returned as valid** and emitted downstream with every field it carried.
- `"__proto__"` resolves to `Object.prototype`, which is not callable. Optional-call `?.()` only guards `null`/`undefined`, so this **throws `TypeError` synchronously inside the socket `'data'` handler**.
- `"toString"` / `"valueOf"` / `"hasOwnProperty"` return a string, `{}` or `false`. Each is either emitted as a "message" or silently dropped without the malformed-line warning.

### Evidence
`src/ipc/narrow.ts:52` and `src/ipc/narrow.ts:179-185`:
```ts
const NARROWERS: Record<string, Narrower> = { status: ..., scope: ..., ... };
...
  const type = obj['type'];
  if (typeof type !== 'string') return undefined;
  return NARROWERS[type]?.(obj);
```
Reproduced with Node against an equivalent table:
```
constructor -> {"type":"constructor","evil":"<script>"}
__proto__ THROWS N[t] is not a function
hasOwnProperty -> false
toString -> "[object Object]"
valueOf -> {}
```
`src/emulator/ipc-client.ts:151-157` calls `parseIpcMessage` inside `onData`, with no `try/catch` around it. `onData` is the `sock.on('data')` listener (`ipc-client.ts:71`).

### Impact
- The FR-IPC-2 guarantee ("nothing beyond the whitelisted shape can reach a downstream webview") does not hold. Any line `{"type":"constructor", ...}` reaches every `manager.on('message')` subscriber with arbitrary fields. Current consumers switch on `msg.type` and ignore unknown types, so no exploit exists today. Any future consumer that forwards generically, or a refactor to a `switch` with a fallthrough, would turn this into an injection path into webviews.
- `{"type":"__proto__"}` from the emulator raises an uncaught exception in the Extension Host's socket callback. The emulator runs arbitrary user effect code, and the IPC server is in the same process. All later lines in the same chunk are lost, and the exception surfaces through the host's global handler.

### Affected Files
- src/ipc/narrow.ts
- src/emulator/ipc-client.ts

### Recommended Fix
1. Look up own properties only: `const narrow = Object.hasOwn(NARROWERS, type) ? NARROWERS[type] : undefined;`. Better, build the table as `new Map<string, Narrower>([...])` or `Object.freeze(Object.assign(Object.create(null), {...}))`.
2. Wrap the per-line body of `IpcClient.onData` (parse + narrow + emit) in `try/catch` that counts the line as malformed. A defect in one narrower then cannot abort the read loop.
3. Add unit tests in `src/test/unit/ipc/narrow.test.ts` for `constructor`, `__proto__`, `toString`, `hasOwnProperty` and `valueOf`, all expected to return `undefined`.

### Urgency Level
HIGH

### Intake Status
Released in 0.27.2 — M93 (FR-IPC-8), finding #6 of the HIGH intake.

---

## Unix-socket runtime directory in a shared temp dir is not ownership-checked, and the Unix transport is unauthenticated

### Description
On macOS/Linux the emulator's IPC socket lives in `os.tmpdir()/ds-ide-<sha256(buildDir)[0:10]>`. The name is derived from the project path, so it is predictable. The directory is created with `mkdir(..., { recursive: true, mode: 0o700 })`. A recursive `mkdir` succeeds silently when the directory already exists and **does not apply `mode` or check owner** in that case. Unlike TCP (FR-WIN-IPC-2 session token), the Unix transport carries no authentication. Its only protection is that directory's permissions.

### Evidence
- `src/emulator/manager.ts:54-57`: `workspaceRuntimeDir()` derives the name from `buildDir`.
- `src/emulator/manager.ts:423-425`: `this.mkdir(runtimeDir, { recursive: true, mode: 0o700 })`. No `lstat`/owner/mode verification follows.
- `src/emulator/ipc-client.ts:51-53`: the session token is enforced only for `kind === 'tcp'`.

### Impact
On Linux `os.tmpdir()` is usually the world-writable `/tmp`. Another local user can create `/tmp/ds-ide-<hash>` (or a symlink there) before the developer's first deploy. The emulator then binds its socket inside an attacker-owned directory. The attacker can read scope/MIDI traffic or connect and drive the emulator (transport, WAV/record paths, which the emulator opens for read/write). macOS uses a per-user `$TMPDIR`, so the primary platform is largely mitigated. The project's stated aim is cross-platform-where-practical.

### Affected Files
- src/emulator/manager.ts
- src/emulator/ipc-client.ts

### Recommended Fix
After `mkdir`, `lstat` the directory. Refuse to deploy (or pick a fresh `fs.mkdtemp` directory) unless it is a real directory, not a symlink, owned by `process.getuid()`, with mode `0o700`. Simpler: create a fresh directory with `fs.promises.mkdtemp(path.join(os.tmpdir(), 'ds-ide-'))` per deploy and record it for the stale-socket sweep. Optionally prefer `$XDG_RUNTIME_DIR` on Linux.

### Urgency Level
MEDIUM

### Intake Status
Pending — not yet intaken.

---

# Runtime safety

## lldb-dap proxy has no `stdin` error handler and ignores child exit

### Description
`FilteringLldbDapAdapter` spawns `lldb-dap` and writes every DAP request to `child.stdin`, but it never attaches an `'error'` listener to `stdin` or `stdout`. It also never reacts to the child's `'exit'`. In Node, an `'error'` event on a stream with no listener is thrown. If lldb-dap crashes or exits, the next `handleMessage` write produces `EPIPE`, which is thrown as an uncaught exception in the Extension Host. Because exit is ignored, VS Code is never told the adapter is gone: no `terminated`/`exited` event is synthesized and the debug session stays "running" with a dead backend. `child.on('error')` only shows a toast.

### Evidence
`src/debug/debug-adapter.ts:92-102`:
```ts
this._child = spawn(lldbDapPath);
this._child.stdout.on('data', (chunk: Buffer) => this._onData(chunk));
this._child.on('error', (err) => { void vscode.window.showErrorMessage(...); });
...
handleMessage(message) { this._child.stdin.write(encodeDapMessage(message)); }
```
The `DapChildProcess` interface (lines 70-76) even declares `on('exit', ...)`, but nothing subscribes to it. Compare `src/emulator/manager.ts:453`, where the same EPIPE hazard was explicitly handled for the emulator's stdin.

### Impact
Uncaught exceptions in the Extension Host on a common failure (lldb-dap crash, attach to a PID that just died, user killing lldb-dap). The debug toolbar hangs until the user force-stops. With `lifecycleManagedByParent`, the parent ds-ide run session can also be left in an inconsistent state.

### Affected Files
- src/debug/debug-adapter.ts

### Recommended Fix
- Add `this._child.stdin.on('error', ...)` and `this._child.stdout.on('error', ...)` that log to the emulator/debug output channel.
- Subscribe to `'exit'`. Fire a DAP `{ type: 'event', event: 'terminated', seq, body: {} }` through `_emitter` (once), and make `handleMessage` a no-op after exit.
- Guard `handleMessage` with `if (this._child.stdin.writable)`.
- Add unit tests in `src/test/unit/debug/debug-adapter.test.ts` that emit `error` on the fake stdin and `exit` on the fake child.

### Urgency Level
HIGH

### Intake Status
Released in 0.27.2 — M93 (FR-DBG-1), finding #7 of the HIGH intake.

---

## Emulator deploy timeout does not settle the attempt; a late announce connects after failure was reported

### Description
In `EmulatorManager.deploy()`, the 10 s socket-announce timeout calls `reject(...)` but does **not** set `resolved = true`, kill the child, or dispose the cancellation subscription. The other three settle paths (`onStdout` match, `onError`, `close`) all do. Afterwards:
- the spawned `effect_emu` keeps running, still referenced by `this.childProcess`;
- `deployLock` is released by the `.finally`, so a new deploy can start;
- if the slow emulator then prints `DAISY_EMU_SOCKET:`, the `!resolved` guard passes. `writePid` runs and `connectIpc` is called. `connectIpc` overwrites `this.ipcClient` and wires message handlers, so the manager becomes connected after the user was told the deploy failed. If a second deploy is in flight at the same moment, two `connectIpc` calls race for `this.ipcClient`.

### Evidence
`src/emulator/manager.ts:461-465`:
```ts
const timeout = setTimeout(() => {
  if (!resolved) {
    reject(new Error(`Emulator did not announce socket path within ${SOCKET_TIMEOUT_MS / 1000}s`));
  }
}, SOCKET_TIMEOUT_MS);
```
compared with `manager.ts:470-476` (cancel path: sets `resolved`, kills the child) and `manager.ts:486-493` (late announce still accepted while `resolved === false`).

### Impact
Inconsistent state: the transport shows "deploy failed" while the emulator is live and streaming. An orphan emulator (holding the audio device) survives until the next deploy's `killExisting()`. A concurrent redeploy can end up with two emulators and one `ipcClient` attached to the wrong one.

### Affected Files
- src/emulator/manager.ts

### Recommended Fix
In the timeout callback, mirror the cancel path: `resolved = true; cancelSub?.dispose(); this.stoppedChildren.add(child); child.kill();` (or `escalateKill`) before `reject`. Consider extracting one `settle(err?)` helper used by all four paths so they cannot drift again. Add a unit test that fires the timeout and then emits a late announce line, asserting no `connectIpc`.

### Urgency Level
MEDIUM

### Intake Status
Pending — not yet intaken.

---

## Emulator and CMake output is split per chunk, so lines spanning chunk boundaries are lost or mangled

### Description
`EmulatorManager` turns child-process output into lines by calling `data.toString('utf8').split('\n')` on each `'data'` chunk independently. A line split across two chunks becomes two partial lines. The project already has `createLineSplitter` in `src/hardware/line-buffer.ts` for exactly this problem ("which drops/misreports text split across a chunk boundary"). `hardware-build.ts` and `dfu-flash.ts` use it; the emulator build and deploy paths do not.

### Evidence
- `src/emulator/manager.ts:479-485` (deploy stdout): the `DAISY_EMU_SOCKET:` regex runs on each per-chunk fragment.
- `src/emulator/manager.ts:508` (deploy stderr): `onOutput(data.toString('utf8').trim())`, one "line" per chunk.
- `src/emulator/manager.ts:892-896` (`runProcess`, used for CMake configure and build): the same per-chunk split.
- `src/commands/dfu-flash.ts:140-148` and `src/commands/hardware-build.ts:219-220` use `createLineSplitter`.

### Impact
- If the announce line is split (pipe buffering, a long socket path, heavy stdout from the effect before the announce), it is never matched. Deploy then fails with a spurious "did not announce socket path within 10s".
- Compiler diagnostics split across chunks are not parsed into the Problems panel, so a failed build can report "0 problems".

### Affected Files
- src/emulator/manager.ts
- src/hardware/line-buffer.ts (existing helper to reuse)

### Recommended Fix
Use `createLineSplitter` (one per stream) in `deploy()` for stdout and stderr, and in `runProcess()`. Call `flush()` on `'close'`. Add unit tests that deliver `DAISY_EMU_SOCKET:/tmp/x.sock\n` and a clang diagnostic in two chunks.

### Urgency Level
MEDIUM

### Intake Status
Pending — not yet intaken.

---

## Toolchain HTTPS download has no connect or idle timeout

### Description
`httpsDownload` issues `https.get` with no `timeout` option and no idle timer on the response stream. A server that accepts the TCP connection but stalls (captive portal, half-open connection, throttled CDN) leaves the promise pending until the user presses Cancel. The mirror fallback in `managed-toolchain.ts` is never reached because the primary attempt never fails.

### Evidence
`src/toolchain/download.ts:42-51`:
```ts
const req = get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => { ... });
req.on('error', ...);
```
`pipeToFile` (`download.ts:53-82`) has no inactivity check. `ETIMEDOUT` is listed as a network code in `src/toolchain/managed-toolchain.ts:94`, but this code path never produces it.

### Impact
On Windows first-run setup, the build and debugger flows that call `toolchain.offer()` can hang indefinitely behind a progress notification. The automatic mirror fallback is defeated, and the open socket and partial file stay allocated.

### Affected Files
- src/toolchain/download.ts

### Recommended Fix
Pass `timeout` to `get(...)` and on `req.on('timeout')` call `req.destroy(Object.assign(new Error('connect timeout'), { code: 'ETIMEDOUT' }))`. Add an idle timer in `pipeToFile`, reset on each `'data'` event, that destroys the request with `ETIMEDOUT` after N seconds without bytes. Add tests with a fake `get` that never responds.

### Urgency Level
MEDIUM

### Intake Status
Pending — not yet intaken.

---

# Async / concurrency

## `RunSessionAdapter.launch()` is a floating promise; a deploy error leaves the DAP launch unanswered

### Description
`handleMessage` fires `void this.launch(req)`. `launch` awaits `host.rebuildAndDeploy(...)` and `host.attachDebugger(...)` with no `try/catch`. `rebuildAndDeploy` goes through `DeployCoordinator.performDeploy`, which deliberately **re-throws** after dispatching `deployAborted` (`extension.ts:437-440`). `attachDebugger` awaits `vscode.debug.startDebugging`, which can reject. Any rejection:
- becomes an unhandled promise rejection in the Extension Host;
- skips `this.respond(req, {})` and `sendTerminated()`, so VS Code never gets a `launch` response and the run session sits in "launching" indefinitely.

### Evidence
- `src/debug/run-session-adapter.ts:94-96`: `case 'launch': void this.launch(req); return;`
- `src/debug/run-session-adapter.ts:113-139`: no `try/catch` around `rebuildAndDeploy` or `attachDebugger`.
- `src/extension.ts:432-441`: `performDeploy` re-throws (`catch (err) { this.transport.dispatch({ type: 'deployAborted' }); throw err; }`).

### Impact
On Restart (the path that calls `rebuildAndDeploy`) or F5 attach, any unexpected error (filesystem error in `loadControllerConfig`/`openTextDocument`, `startDebugging` rejection) produces an unhandled rejection and a hung debug session that must be force-stopped.

### Affected Files
- src/debug/run-session-adapter.ts
- src/extension.ts

### Recommended Fix
Wrap the body of `launch` in `try { ... } catch (err) { this.respondError(req, err); this.stopOwnEmulator(); this.sendTerminated(); }`. Add a `respondError` that sends `success: false, message`. Alternatively, keep `void this.launch(req).catch(...)` with the same handling. Add a unit test where `rebuildAndDeploy` rejects and assert that a response and a `terminated` event are emitted.

### Urgency Level
HIGH

### Intake Status
Released in 0.27.2 — M93 (FR-DBG-2), finding #8 of the HIGH intake.

---

## Fire-and-forget promises that can reject, with no lint rule guarding them

### Description
The code base marks intentionally-unawaited promises with `void`. That is a good convention, but several voided calls can reject and have no `.catch`, so they become unhandled rejections:
- `showOledIfEnabled()` / `showMidiIfEnabled()` / `showOledPanel()` call `vscode.workspace.openTextDocument(...)` on a path found a moment earlier. It rejects if the file was deleted or renamed in between, or is not decodable.
- `initViewsFromProject()` (voided at activation and on folder change and file-watch refresh) awaits `findEffectSource` and `refreshControlsView` without a guard.
- The `onDidSaveTextDocument` handler in `createSaveListener` is an `async` callback whose rejections VS Code does not observe.

There is no ESLint configuration, so `@typescript-eslint/no-floating-promises` / `no-misused-promises` are not enforced. The `eslint-disable-next-line` comment in `src/midi/host-bridge.ts:30` refers to a linter that does not run.

### Evidence
- `src/extension.ts:396-406` (`showMidiIfEnabled`: `openTextDocument` with no try), called as `void this.showMidiIfEnabled()` at `extension.ts:497, 521`.
- `src/extension.ts:1248-1255` (`showOledPanel`), voided at `extension.ts:658, 853`.
- `src/extension.ts:1413-1451` (`initViewsFromProject`, `void`ed at 1202, 1451 and from the watcher), with I/O outside the inner try.
- `src/extension.ts:1067-1112` (async save listener).
- `package.json` `lint` script: `tsc --noEmit` plus shell checks only; no `.eslintrc*` / `eslint.config.*` in the repo.

### Impact
Unhandled rejections in the Extension Host (logged as errors, and a recurring source of hard-to-attribute "extension host crash" reports, see the project's open crash-triage memory note). The user also gets no feedback when the panel or view silently fails to refresh.

### Affected Files
- src/extension.ts
- src/midi/host-bridge.ts
- package.json

### Recommended Fix
- Add `.catch(err => emulatorChannel.appendLine(...))` (or a small `fireAndLog(promise, channel)` helper) at each `void` site that can reject, or `try/catch` inside the async functions themselves.
- Add a minimal `eslint.config.mjs` with `typescript-eslint` and enable `no-floating-promises` and `no-misused-promises` (with type info) in the `lint` script. Then remove or keep the `eslint-disable` comment accordingly.

### Urgency Level
MEDIUM

### Intake Status
Pending — not yet intaken.

---

# Validation

## Webview message payload validation is ad hoc, incomplete, and its type guard overstates what it checks

### Description
`hasKnownCommand<T>()` checks only that `data.command` is in an allow-list, yet it is declared as a type predicate `data is T`. Every payload field is then typed as if validated (`msg.freq: number`, `msg.cfg: ControllerConfig`, …) when none of it has been checked. Each handler re-validates by hand, and coverage is uneven:
- Scope `sine`: `freq` / `amplitude` checked only with `typeof === 'number'`. `NaN`, `Infinity` and negative values (webview `postMessage` is structured-clone and preserves them) are sent to the emulator, persisted to `workspaceState`, and replayed after every redeploy. `JSON.stringify` turns `NaN`/`Infinity` into `null` on the wire.
- Controls `button`: `gpioPin` only `typeof === 'number'`, with no integer or range check (compare `pot`, which checks integer 0–11, and the wiring handlers, which check 0–31).
- Controls `editorSave`: the untrusted `cfg` is "validated" by `parseControllerConfig(serializeControllerConfig(cfg))`. The serializer string-interpolates unvalidated fields (`taper`, `mode`, `default`, …) unquoted into YAML, and depends on throwing for missing fields. A string containing a newline in `taper` injects arbitrary YAML lines, which the parser then validates as if the user had written them.

### Evidence
- `src/webview/message-guard.ts:13-24`: the predicate checks `command` only.
- `src/webview/scope-panel.ts:154-161`: `if (typeof freq === 'number' && typeof amplitude === 'number')`.
- `src/sidebar/controls-editor-panel.ts:108-112` (`button`) compared with `:99-106` (`pot`).
- `src/sidebar/controls-editor-panel.ts:82-96` and `src/controllers/controller-config.ts:424-449` (`taper: ${p.taper}`, `mode: ${b.mode}` unquoted).

### Impact
Malformed or out-of-range values reach the emulator's hand-rolled JSON parser and the persisted session state. A webview bug or regression is not caught at the boundary. The type system reports these fields as safe, so future handlers will likely skip checks entirely.

### Affected Files
- src/webview/message-guard.ts
- src/webview/scope-panel.ts
- src/sidebar/controls-editor-panel.ts
- src/controllers/controller-config.ts
- src/webview/messages.ts

### Recommended Fix
- Change `hasKnownCommand` to narrow only to `{ command: K }` (not the full `T`), or replace it with one per-command narrower table (the same pattern as `src/ipc/narrow.ts`, built with `Object.create(null)`). Each narrower returns a fully validated message or `undefined`.
- Validate `sine` as finite and in range (reuse the generator `clampParams` limits), and `button.gpioPin` as an integer 0–31.
- Validate `editorSave.cfg` structurally (arrays of objects with typed fields and enum membership) before serialization. Make `serializeControllerConfig` quote or escape every string-typed field, not just `id` and `label`.

### Urgency Level
MEDIUM

### Intake Status
Pending — not yet intaken.

---

## Persisted `workspaceState` is read back through unchecked generic casts

### Description
Session and control state is persisted to `vscode.Memento` and read back with `workspaceState.get<T>()`. That is an unchecked cast. Nothing validates shape, numeric finiteness, or schema version, so state written by an older extension version (or corrupted by the `NaN` path above) flows straight into the emulator on every post-deploy replay.

### Evidence
- `src/extension.ts:280-285`: `get<SineParams>('ds-ide.sine')`, `get<Partial<AudioSource>>('ds-ide.audioSource')` (spread over defaults, so any extra/mistyped key wins), `get<GeneratorParamsMap>('ds-ide.generators')`.
- `src/controllers/pot-store.ts:26`, `src/controllers/button-store.ts:16`, `src/controllers/toggle-store.ts:19`: `get<Record<number, …>>(STATE_KEY, {})`.
- Replayed by `DeployCoordinator.sendPostDeployState` (`extension.ts:408-422`). `narrowControlSnapshot` guards the control values, but sine, audioSource and WAV path are not guarded.

### Impact
After an upgrade that changes a field's meaning or type, users carry broken settings forward (for example a stale `sampleRate`/`bufferSize` not in the allowed list, or a `wavPath` to a file that no longer exists). These reach the emulator with no error surfaced.

### Affected Files
- src/extension.ts
- src/controllers/pot-store.ts
- src/controllers/button-store.ts
- src/controllers/toggle-store.ts

### Recommended Fix
Pass each `get()` result through a narrowing function that falls back to defaults per field (finite-number checks, allowed `sampleRate`/`bufferSize` lists, `input` enum). Reuse the validation from the scope panel's `audioSource` handler so the webview boundary and the restore path share one source of truth.

### Urgency Level
LOW

### Intake Status
Pending — not yet intaken.

---

# Type safety

## `IpcMessage` is an untyped bag, so the narrowers' precise shapes are erased

### Description
Each narrower in `src/ipc/narrow.ts` produces a precisely-shaped object, but the public type is `export type IpcMessage = Record<string, unknown>`. Every consumer therefore re-discriminates with string indexing (`msg['type'] === 'status'`) and either re-narrows (`getString(msg, 'kind')`) or forwards `unknown` values (`msg['count']`, `msg['gpioPin']`) into `postMessage`. The compiler cannot check that a consumer handles a field that actually exists, or that a renamed field is updated everywhere. The same type is also used for **outbound** messages (`IpcClient.send(msg: IpcMessage)`), so a typo in an outbound field name compiles.

### Evidence
- `src/ipc/narrow.ts:21`: `export type IpcMessage = Record<string, unknown>;`
- `src/emulator/manager.ts:724-735`: `msg['type']`, `!!msg['running']`.
- `src/webview/scope-panel.ts:311-319`: `{ command: 'xrun', count: msg['count'] }`, `{ ..., gpioPin: msg['gpioPin'], lit: msg['lit'] }`.
- `src/extension.ts:538-562`: repeated `msg['type'] === ...` chains plus `getString` re-narrowing.
- `src/emulator/manager.ts:547-683`: outbound `send({ type: ..., ... })` literals, none typed.

### Impact
Protocol drift between the C++ emulator and the extension is caught only at runtime or in e2e tests. Defensive re-narrowing is duplicated across consumers, and the FR-IPC-2 whitelist's guarantees are not visible to the type checker.

### Affected Files
- src/ipc/narrow.ts
- src/emulator/ipc-client.ts
- src/emulator/manager.ts
- src/webview/scope-panel.ts
- src/extension.ts

### Recommended Fix
Declare a discriminated union `InboundIpcMessage = StatusMsg | ScopeMsg | ...` matching each narrower's return type. Type `NARROWERS` as `{ [K in InboundIpcMessage['type']]: (o) => Extract<InboundIpcMessage, { type: K }> | undefined }`, and emit `InboundIpcMessage` from `IpcClient`. Declare a separate `OutboundIpcMessage` union for `send()`. Consumers then `switch (msg.type)` with full narrowing and `assertNever`.

### Urgency Level
MEDIUM

### Intake Status
Pending — not yet intaken.

---

# API design / Maintainability

## `extension.ts` is a 1532-line composition root with long positional-callback constructors

### Description
`src/extension.ts` exceeds the 1000-line threshold. It contains `activate()` (~410 lines, `extension.ts:1115-1528`), the `DeployCoordinator` and `SessionState` classes, the SD-card file readers, view-provider factories with all their message-handler logic, command registration, and the save listener. FR-EXT-30 already fixed this for `DeployCoordinator` by grouping its options. Other constructors still take long runs of positional callbacks of identical signature, where a transposition type-checks silently:
- `ScopePanel` is constructed with 12 positional arguments, mostly `() => void` / `async () => void` lambdas, including a bare `undefined` placeholder in position 10.
- `ControlsViewProvider` is constructed with 9 positional callbacks, three of which share the `(gpioPin: number, x: number) => void` shape (toggle, encoder, and with a boolean, button).

### Evidence
- `wc -l src/extension.ts` reports 1532.
- `src/extension.ts:1277-1346`: `new ScopePanel(context.extensionUri, manager, (freq, amplitude) => ..., (source) => ..., async () => ..., async () => ..., () => ..., async () => ..., undefined, () => ..., (kind, params) => ...)`.
- `src/extension.ts:607-659`: `new ControlsViewProvider(context.extensionUri, (cfg) => ..., (channel, value) => ..., (gpioPin, pressed) => ..., (gpioPin, position) => ..., (gpioPin, position) => ..., ...)`.

### Impact
Swapping two same-shaped callbacks (for example toggle and encoder, or record-stop and replay-start) compiles and silently misroutes user actions. The file is the hardest in the repo to review or change safely, and its test (`src/test/unit/extension.test.ts`, 2646 lines) is correspondingly heavy.

### Affected Files
- src/extension.ts
- src/webview/scope-panel.ts
- src/sidebar/controls-editor-panel.ts

### Recommended Fix
- Give `ScopePanel` and `ControlsViewProvider` a single named-options object (`{ onSineChange, onAudioSourceChange, onPickWav, onRecordStart, ... }`), as done for `DeployCoordinator`.
- Move `DeployCoordinator` + `SessionState` to `src/deploy/`, `readSdCardEntries`/`readSdCardPreview` to `src/sdcard/`, and the view-provider factories to `src/sidebar/`. That leaves `extension.ts` as wiring only (target under 500 lines).

### Urgency Level
MEDIUM

### Intake Status
Pending — not yet intaken.

---

## `EmulatorManager.deploy()` is a ~140-line, five-level nested promise chain

### Description
`deploy()` (`manager.ts:405-545`) mixes `.then` chains, an inner `async` arrow, a `new Promise` executor with four independent settle paths, stdout parsing, PID persistence, cancellation and dispose races. The timeout settle-path bug above is a direct consequence: one of the four hand-written settle blocks drifted from the others. The rest of `manager.ts` (916 lines) is well commented, but this function exceeds the 100-line guideline and is nested about five levels deep.

### Evidence
`src/emulator/manager.ts:405-545`: `prepared.then(() => { ... return killStalePid(...).catch(...).then(async () => ...).then(({exePath, env}) => { ... return new Promise<void>((resolve, reject) => { ... }) }) })`.

### Impact
High change risk in the single most critical runtime path (every Run / Debug / Restart). Race fixes such as FR-EXT-18 and FR-EXT-7 have had to be threaded through by hand.

### Affected Files
- src/emulator/manager.ts

### Recommended Fix
Rewrite as a linear `async` function: `await prepare()`, `await killStalePid()`, `const { exePath, env } = await ...`, `const child = this.spawnEmulator(...)`, `const announced = await this.waitForAnnounce(child, token)`. Here `waitForAnnounce` is a small helper with one `settle()` function and a line splitter. Keep the synchronous `deployLock` assignment by wrapping the async body in an IIFE.

### Urgency Level
MEDIUM

### Intake Status
Pending — not yet intaken.

---

# Error handling

## Swallowed errors that hide real failures or misreport their cause

### Description
Most empty `catch {}` blocks in the code base are justified and commented (best-effort kills, stale-file cleanup). A few, however, turn a real I/O failure into a misleading state with no log line:
- `buildControlsConfig` returns `{ controls: [], missingBlock: true }` when reading the effect source **fails**. The Controls Editor then tells the user the marker block is missing, when the real cause is EACCES, EMFILE or an encoding error.
- `readSdCardEntries` returns `[]` for any `readdir` error, not just `ENOENT`, so a permissions problem shows an empty SD card.
- `writePid` swallows failure silently. Without the PID file, the FR-EXT-2 stale-process reaper cannot work, and nothing records why.
- `initViewsFromProject` and the save listener (`catch { /* unreadable */ }`) silently show an unwired board.

### Evidence
- `src/extension.ts:261-267` (`buildControlsConfig`).
- `src/extension.ts:216-232` (`readSdCardEntries`).
- `src/emulator/manager.ts:130-132` (`writePid`).
- `src/extension.ts:1104`, `src/extension.ts:1442`.

### Impact
The user sees wrong UI ("no marker block", empty SD card, nothing wired) with no hint at the real cause. Support and debugging time goes up, and the user may "fix" a non-problem, for example by appending marker blocks.

### Affected Files
- src/extension.ts
- src/emulator/manager.ts

### Recommended Fix
Treat `ENOENT` as the expected empty case and log everything else to the relevant output channel (`emulatorChannel.appendLine(...)`), following `loadControllerConfig`'s existing ENOENT-vs-other split (`extension.ts:1154-1167`). In `buildControlsConfig`, return a distinct `unreadable` flag instead of `missingBlock: true`.

### Urgency Level
LOW

### Intake Status
Pending — not yet intaken.

---

# Performance

## IPC receive path does quadratic string slicing and decodes UTF-8 per chunk

### Description
`IpcClient.onData` appends each chunk to a string, then for every complete line does `this.partial = this.partial.slice(nl + 1)`. That copies the remaining buffer once per line, which is O(lines × buffer) per chunk. Scope and spectrum messages are large numeric arrays arriving continuously, and each one is then checked element by element (`every(x => typeof x === 'number')`) and re-serialized to the webview. Separately, `data.toString('utf8')` per chunk (here, in `line-buffer.ts`, and in `manager.ts` output handling) corrupts any multibyte UTF-8 character split across chunk boundaries. That is harmless for today's ASCII protocol, but not for effect `printf` output or file paths containing non-ASCII characters.

### Evidence
- `src/emulator/ipc-client.ts:128-158`.
- `src/ipc/narrow.ts:16-19`.
- `src/hardware/line-buffer.ts:15`.
- `src/emulator/manager.ts:480, 508, 893`.

### Impact
Extra Extension Host CPU while audio runs, which competes with the editor. Garbled non-ASCII text in output channels and diagnostics.

### Affected Files
- src/emulator/ipc-client.ts
- src/hardware/line-buffer.ts
- src/emulator/manager.ts

### Recommended Fix
Scan with a moving start index and slice once per chunk: `let start = 0; while ((nl = buf.indexOf('\n', start)) !== -1) { ...; start = nl + 1; } this.partial = buf.slice(start);`. Decode with `string_decoder.StringDecoder` (or `socket.setEncoding('utf8')` / `stream.setEncoding('utf8')`), which carries partial multibyte sequences across chunks.

### Urgency Level
LOW

### Intake Status
Pending — not yet intaken.

---

# Dependency hygiene

## `@types/vscode` range lags the declared `engines.vscode`, and import style is mixed

### Description
`package.json` declares `"engines": { "vscode": "^1.140.0" }` but `"@types/vscode": "^1.85.0"`. The types can resolve far older than the minimum runtime, so APIs available on 1.140 may be untyped (and `vsce` only checks that types are not newer than the engine). Node built-ins are also imported in two styles (`'fs'` ×32 and `'node:fs'` ×3, `'crypto'` ×5 and `'node:crypto'` ×7, …).

### Evidence
- `package.json`: `engines.vscode` and `devDependencies["@types/vscode"]`.
- `grep "from '"` across `src/` shows both `fs`/`node:fs`, `crypto`/`node:crypto`, `os`/`node:os` and `child_process`/`node:child_process`.

### Impact
Type checking does not reflect the real API surface (missed newer APIs, or accidental use of removed ones). The mixed import style is minor inconsistency noise.

### Affected Files
- package.json
- src/** (import statements)

### Recommended Fix
Pin `@types/vscode` to `~1.140.0` to match `engines`. Standardize on `node:`-prefixed built-in imports, enforceable with the ESLint `unicorn/prefer-node-protocol` rule once ESLint is added (see the floating-promises finding).

### Urgency Level
LOW

### Intake Status
Pending — not yet intaken.

---

# Testing

## No tests cover the failure paths behind this report's HIGH and MEDIUM runtime findings

### Description
Unit coverage is broad: nearly every non-webview module has a dedicated test file, and `manager.test.ts` alone is 2102 lines. However, the specific failure paths behind the findings above have no tests, which is why they survived:
- `parseIpcMessage` with inherited-property `type` values (`constructor`, `__proto__`);
- the deploy socket-announce **timeout** followed by a late announce;
- an announce line or a compiler diagnostic split across two stdout chunks;
- lldb-dap `stdin` `error` / child `exit` in `FilteringLldbDapAdapter`;
- `RunSessionAdapter.launch` when `rebuildAndDeploy` or `attachDebugger` rejects;
- `httpsDownload` against a server that never responds.

The only source modules with no direct unit test are the DOM-bound webview helpers under `src/webview/controls/` (`convention-canvas.ts`, `yaml-editor-canvas.ts`, `sd-card-panel.ts`, `oled-strip.ts`, `layout-actions.ts`, `drag.ts`, `doc-listeners.ts`). Those are frontend UI and outside this review's scope.

### Evidence
- `src/test/unit/ipc/narrow.test.ts`, `src/test/unit/emulator/manager.test.ts`, `src/test/unit/debug/debug-adapter.test.ts`, `src/test/unit/debug/run-session-adapter.test.ts`, `src/test/unit/toolchain/download.test.ts`: none of the scenarios listed above appears.

### Impact
Regressions in the crash and hang paths of the most critical flows (deploy, debug, first-run toolchain) are caught only by manual testing.

### Affected Files
- src/test/unit/ipc/narrow.test.ts
- src/test/unit/emulator/manager.test.ts
- src/test/unit/debug/debug-adapter.test.ts
- src/test/unit/debug/run-session-adapter.test.ts
- src/test/unit/toolchain/download.test.ts

### Recommended Fix
Add one regression test per scenario above, alongside each fix. All of them can use the existing injected fakes (`spawn`, `ipcClientFactory`, `SpawnDapChild`, `RunSessionHost`, `HttpGet`) and fake timers.

### Urgency Level
LOW

### Intake Status
Pending — not yet intaken.

---

## Out of Scope

Production infrastructure, cloud configuration, database tuning, third-party package source auditing, performance benchmarking, frontend UI correctness, formal penetration testing.
