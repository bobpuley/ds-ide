# Review Report

# 06 — Node.js / TypeScript Code Review (v11)

> **v10 review archived** — [`docs/v10/06_nodejs_review.md`](v10/06_nodejs_review.md).

Scope: all TypeScript under `./src` (extension host code, webview scripts, unit tests) plus `package.json`, `tsconfig.json`, and `esbuild.js`.

Overall assessment: the codebase is small (~5k lines of non-test source), has `strict` + `noUncheckedIndexedAccess` enabled, zero runtime dependencies, dependency-injected process/fs seams, and unit tests for nearly every extension-host module. The findings below are the exceptions to that generally solid baseline.

---

## Unhandled promise rejection from the deploy-lock `.finally()` chain

### Description
`EmulatorManager.deploy()` stores the in-flight deploy promise as a coalescing lock, then clears the lock with `.finally()`. The promise returned by `.finally()` is a *new* promise whose rejection is never handled. When a deploy fails (emulator exits early, socket timeout, spawn error), the original `deployPromise` rejection is caught by the caller (`deployToEmulator` wraps it in try/catch), but the derived `deployPromise.finally(...)` promise also rejects — and nothing observes it.

### Evidence
`src/emulator/manager.ts:162-164`:

```ts
this.deployLock = deployPromise;
deployPromise.finally(() => { this.deployLock = null; });
return deployPromise;
```

Every rejected deploy produces one unhandled rejection from the discarded `.finally()` chain. In the VS Code extension host this surfaces as an `UnhandledPromiseRejection` log entry today and is process-fatal under Node's default `--unhandled-rejections=throw` semantics in plain Node contexts (tests, future CLI reuse).

### Impact
Deploy failures — a common, expected path (build not run, emulator crash on startup, 10 s socket timeout) — generate unhandled promise rejections in the extension host. Depending on host policy this means noisy error telemetry at best and an extension-host error dialog or process termination at worst.

### Affected Files
- src/emulator/manager.ts

### Recommended Fix
Attach the cleanup without creating an observable rejected promise:

```ts
this.deployLock = deployPromise;
deployPromise.catch(() => { /* observed by caller */ }).finally(() => { this.deployLock = null; });
```

or equivalently `void deployPromise.then(clear, clear);`.

### Urgency Level
HIGH

---

## Stale-PID kill can SIGKILL an unrelated process (PID reuse)

### Description
Before each deploy, `killStalePid()` reads `<buildDir>/emu.pid` and sends `SIGKILL` to whatever PID it contains, with no verification that the PID still belongs to an `effect_emu` process. The pid file persists across reboots and crashed sessions. After a reboot (or ordinary PID recycling on a long-lived system), that PID can belong to any process owned by the user — a browser, another IDE, a build job — and it gets killed without warning, with `SIGKILL` (no chance to save state).

### Evidence
`src/emulator/manager.ts:14-29`:

```ts
const text = await fs.promises.readFile(pidFile, 'utf8');
const pid = parseInt(text.trim(), 10);
if (pid > 0) {
  process.kill(pid, 'SIGKILL');
  ...
}
```

There is no check of the process name/command line, no process start-time comparison, and the file is not invalidated at reboot. `clearPid()` is called on clean paths, but a crashed extension host or power loss leaves the file behind — exactly the scenario this code targets.

### Impact
Deploying after a reboot or a crashed session can kill an arbitrary user process, causing data loss in unrelated applications. Low probability per occurrence, but the trigger (`Deploy to Emulator`) is a core, frequent user action.

### Affected Files
- src/emulator/manager.ts

### Recommended Fix
Verify identity before killing. On macOS/Linux: read `ps -p <pid> -o comm=` (or `/proc/<pid>/comm` where available) and only kill when the command matches `effect_emu`. Prefer `SIGTERM` with a short escalation to `SIGKILL`. Additionally, store the process start timestamp alongside the PID and compare.

### Urgency Level
HIGH

---

## IPC connect after socket announcement has no timeout — deploy can hang forever

### Description
`deploy()` guards the "emulator announces its socket path" phase with a 10 s timeout, but marks `resolved = true` *before* `connectIpc()` completes. `IpcClient.connect()` itself has no timeout: if the emulator prints `DAISY_EMU_SOCKET:` but never accepts the connection (wedged process, socket path race), the promise returned by `deploy()` never settles. Because the deploy lock coalesces on this promise, all subsequent deploys return the same forever-pending promise — the feature is dead until VS Code restarts.

### Evidence
`src/emulator/manager.ts:126-133`:

```ts
if (match && !resolved) {
  resolved = true;
  clearTimeout(timeout);
  ...
  void this.connectIpc(match[1]!).then(resolve).catch(reject);
}
```

`src/emulator/ipc-client.ts:21-40` — `connect()` resolves on `'connect'`, rejects on `'error'`, and has no time bound. A UNIX socket connect that neither succeeds nor errors (backlog exhaustion, path replaced by a plain file with no listener in some conditions) leaves it pending.

### Impact
A single misbehaving emulator start silently bricks build/deploy/debug for the rest of the session, with no error message (the status bar stays on "deploying…").

### Affected Files
- src/emulator/manager.ts
- src/emulator/ipc-client.ts

### Recommended Fix
Keep the deadline alive through the connect phase: don't set `resolved` until `connectIpc` settles, or give `IpcClient.connect()` its own timeout (e.g., 5 s) via `socket.setTimeout` / a `Promise.race`. Also consider clearing `deployLock` on rejection *before* coalesced callers re-enter (the `.finally()` fix above covers this once the promise actually settles).

### Urgency Level
MEDIUM

---

## Unvalidated IPC JSON is trusted and spread into webview messages

### Description
Messages from the emulator socket are parsed with bare `JSON.parse` into `IpcMessage = Record<string, unknown>` and then forwarded with almost no shape validation. `src/ipc/narrow.ts` provides typed accessors, but they are used in only two places (`extension.ts` event/status handling); everywhere else fields are passed through unchecked, and `postStatus` object-spreads the entire untrusted message into the webview payload.

### Evidence
- `src/emulator/ipc-client.ts:68` — `const msg = JSON.parse(line) as IpcMessage;` (assertion, no validation; malformed lines are silently dropped with no log).
- `src/webview/scope-panel.ts:194-196` — `postMessage({ command: 'status', ...msg })` forwards every key of the raw IPC object.
- `src/webview/scope-panel.ts:190-221` — `msg['in']`, `msg['out']`, `msg['in_fft']`, `msg['binHz']`, etc. forwarded untyped; the webview then indexes them as arrays (`pts[i]`, `fft[i]`) with no runtime check.
- `src/emulator/manager.ts:255` — `!!msg['running']` (OK) vs. `scope-webview.ts` trusting `msg.sampleRate || …`.

### Impact
A buggy or version-skewed emulator build (the most likely "attacker" here is your own C++ process mid-refactor) produces `NaN` waveforms, wrong status text, or webview exceptions instead of a clear protocol error. The single-`type`-key spread also means an emulator field can silently shadow the `command` field contract of webview messages.

### Affected Files
- src/emulator/ipc-client.ts
- src/webview/scope-panel.ts
- src/sidebar/controls-editor-panel.ts
- src/ipc/narrow.ts

### Recommended Fix
Define one discriminated-union schema for the IPC protocol and validate at the socket boundary (zod or valibot would be appropriate; if the zero-dependency policy is firm, extend `narrow.ts` with per-message-type narrowing functions and a `parseIpcMessage(line): IpcMessage | undefined` that logs rejects). Forward only the validated, explicitly-listed fields to webviews — never `...msg`.

### Urgency Level
MEDIUM

---

## Unsafe cast of webview-supplied `cfg` in `editorSave` handler

### Description
The Controls Editor message handler casts the webview payload directly to `ControllerConfig` and immediately feeds it to `serializeControllerConfig`, which dereferences `cfg.pots`, `p.range[0]`, etc. A malformed message (webview bug, message replay, compromised webview) throws inside the `onDidReceiveMessage` handler. The subsequent round-trip re-parse is good defense-in-depth for *values*, but the *shape* is never checked before first use.

### Evidence
`src/sidebar/controls-editor-panel.ts:41-47`:

```ts
if (m['command'] === 'editorSave') {
  const cfg = m['cfg'] as ControllerConfig | undefined;
  if (cfg) {
    const validated = parseControllerConfig(serializeControllerConfig(cfg));
    if (validated.errors.length === 0) this.onEditorSave(validated);
  }
}
```

`serializeControllerConfig` (`src/controllers/controller-config.ts:349-388`) assumes `cfg.pots`/`buttons`/`leds` are arrays of well-formed objects (`p.range[0]`, `p.pos[0]`). `{ cfg: { pots: [{}] } }` throws `TypeError: Cannot read properties of undefined`.

A related gap: `id` values are serialized unquoted (`- id: ${p.id}` — only `label` goes through `yamlQuote`). An id containing `:` or `#` (typeable in the card's ID input, `controls-webview.ts:317`) round-trips to a *different* id without any error, silently mutating the saved config.

### Impact
Exception in the extension host message handler (logged, view stops responding to that message); silent id mutation corrupts `controllers.yaml` mappings.

### Affected Files
- src/sidebar/controls-editor-panel.ts
- src/controllers/controller-config.ts
- src/webview/controls-webview.ts

### Recommended Fix
Structurally validate `m['cfg']` (arrays present, items objects) before serializing — or wrap the serialize/parse round trip in try/catch and show a warning. Apply `yamlQuote` (or an identifier allowlist `/^[A-Za-z_]\w*$/`, matching the Wiring Editor's rule) to `id` fields during both serialization and editor input.

### Urgency Level
MEDIUM

---

## Swallowed config-read errors can lead to silent `controllers.yaml` overwrite

### Description
`loadControllerConfig()` treats *any* failure to read `controllers.yaml` — including transient `EACCES`/`EMFILE`/encoding errors — as "no config", returning an empty `ControllerConfig`. That empty config is then pushed into the Controls Editor via `loadEditor(cfg)`. If the user presses the editor's save button while this state is loaded, the empty config is serialized and written back, replacing their real `controllers.yaml`.

### Evidence
`src/extension.ts:500-514`:

```ts
try {
  const text = await fs.promises.readFile(yamlPath, 'utf8');
  ...
} catch {
  return { pots: [], buttons: [], leds: [], errors: [] };
}
```

The same "error ⇒ empty" collapse appears in `buildControlsConfig` (`extension.ts:89-95`). There are 21 bare `catch { }` blocks in non-test source; most are justified (`unlink` cleanup), but the config-read ones destroy the distinction between *absent* and *unreadable*.

### Impact
Low-frequency but destructive: a transient read failure plus one click on "save layout" wipes the user's controller definitions with no warning.

### Affected Files
- src/extension.ts

### Recommended Fix
Distinguish `ENOENT` (legitimately empty config) from other errors. On unexpected errors, surface a warning and mark the returned config as read-degraded (e.g., an `unreadable: true` flag) so save paths refuse to write until a clean load succeeds.

### Urgency Level
MEDIUM

---

## Wiring edits: `applyEdit` result ignored and disk/document divergence

### Description
The wire/unwire handlers apply a `WorkspaceEdit` to the (possibly dirty, unsaved) document, ignore the boolean success result, and then rebuild the Controls Editor state by re-reading the effect source **from disk**. Two problems: (1) if `applyEdit` fails (document changed concurrently, edit rejected), the UI is updated as if it succeeded; (2) even on success the document is modified in memory but not saved, so `buildControlsConfig` → `fs.promises.readFile(effectPath)` parses the *old* on-disk text — the Wiring view (fed from in-memory `newText`) and the Controls view (fed from disk) disagree until the user manually saves.

### Evidence
`src/extension.ts:171-177` (same pattern at 192-198):

```ts
const edit = makeBlockEdit(doc, vscode.Uri.file(effectPath), oldText, newText);
await vscode.workspace.applyEdit(edit);            // result ignored
const { controls } = parseControlsConvention(newText);
wiringProvider?.postWiredPins(pins);
const cfg = await loadControllerConfig();
controlsProvider?.postControlsConfig(await buildControlsConfig(folder, cfg)); // reads from DISK
```

`buildControlsConfig` at `extension.ts:81-96` reads `effectPath` via `fs.promises.readFile`, not `doc.getText()`.

Additionally, `makeBlockEdit`'s `findRange` (`extension.ts:52-56`) uses `findIndex`, so a duplicated marker line anywhere in the file silently pairs the wrong begin/end and the edit lands on the wrong range.

### Impact
Inconsistent sidebar state after every wiring operation until a manual save; on `applyEdit` failure, the views claim a control exists that was never written. Duplicate markers (easy to create by copy-pasting a template block) cause edits at wrong locations in user source code.

### Affected Files
- src/extension.ts

### Recommended Fix
Check the `applyEdit` return value and show an error on `false`. After a successful edit, either `await doc.save()` or make `buildControlsConfig` accept the already-known in-memory text instead of re-reading disk. In `makeBlockEdit`, reject or fall back to full-file replacement when a marker appears more than once.

### Urgency Level
MEDIUM

---

## `/tmp` socket lifecycle: predictable names, cross-session deletion

### Description
Two related issues. (a) On activation, the extension deletes *every* `/tmp/daisy_emu_*.sock` it can find — including sockets belonging to emulators of other concurrently running VS Code windows, preventing any future reconnect to them. (b) Socket paths are `daisy_emu_${Date.now()}.sock` in world-writable `/tmp`: predictable, race-able names. On a multi-user machine another local user can pre-create the path (denial of service) since there is no per-user directory or random component.

### Evidence
- `src/extension.ts:110-116` — indiscriminate `readdir('/tmp')` + `unlink` of all matching sockets at every activation.
- `src/emulator/manager.ts:99` — `this.socketPath = `/tmp/daisy_emu_${Date.now()}.sock`;`

### Impact
Running two ds-ide workspaces concurrently is undermined by mutual socket cleanup; local DoS/squatting is possible on shared machines. Severity is bounded because macOS single-user development is the stated primary environment.

### Affected Files
- src/extension.ts
- src/emulator/manager.ts

### Recommended Fix
Create sockets under a per-user, per-workspace directory (`path.join(os.tmpdir(), 'ds-ide-' + uid)` with `0700`, or better: inside `<projectRoot>/.ds-ide/`), name them with `randomBytes(6).toString('hex')`, and scope startup cleanup to that directory only — ideally only removing sockets whose owning PID (from the adjacent pid file) is dead.

### Urgency Level
MEDIUM

---

## Webview scripts are `@ts-nocheck` and untested (~1,000 lines)

### Description
All three webview scripts opt out of TypeScript entirely with `// @ts-nocheck`, and `tsconfig.json` additionally excludes `src/test` from type checking, so `npm run lint`/`typecheck` never sees the test suite either. The webview scripts contain the drag-drop editor, knob math, SVG pinout logic, and all webview-side message handling — none of it type-checked, none of it unit-tested (tests cover the extension-host side only).

### Evidence
- `src/webview/controls-webview.ts:1`, `src/webview/scope-webview.ts:1`, `src/webview/wiring-webview.ts:1` — `// @ts-nocheck`.
- `tsconfig.json` — `"exclude": ["node_modules", "dist", "src/test"]` while `"scripts.lint": "tsc --noEmit"`; vitest transpiles tests without type checking, so type errors in tests go unnoticed.
- Untyped access patterns the checker would catch: `controls-webview.ts:197` `(_yamlCfg.buttons.find(...) || {}).mode` — depends on `_yamlCfg` shape posted from the host; `scope-webview.ts:248` `ms.toFixed(1)` on an unchecked field.

### Impact
The highest-churn UI code has no static safety net; regressions in message contracts between host and webview (already typed only by convention) surface as blank panels at runtime. Test-file type rot accumulates invisibly.

### Affected Files
- src/webview/controls-webview.ts
- src/webview/scope-webview.ts
- src/webview/wiring-webview.ts
- tsconfig.json

### Recommended Fix
Remove `@ts-nocheck` and give webviews their own `tsconfig.webview.json` with `"lib": ["ES2022", "DOM"]` (the `webview-api.d.ts` shim already exists). Type the host↔webview message protocol as a shared discriminated union imported by both sides. Add a `tsconfig.test.json` (or drop the exclude) so `tsc --noEmit` covers tests. Extract pure webview logic (knob math, `defaultId`, `validateId`, `applyWiredPins` state transitions) into checked, testable modules.

### Urgency Level
MEDIUM

---

## `activate()` is a 400-line god function with duplicated deploy sequences

### Description
`extension.ts` wires every subsystem inside one 396-line `activate()` using nested closures over shared mutable state (`sineState`, `audioSourceState`, `activeRecordPath`). The post-deploy state replay sequence exists three times with slight variations: `sendPostDeployState()` (extension.ts:314-324), the `ds-ide.deploy` command body (extension.ts:424-442, which duplicates `performBuildAndDeploy` minus the build), and the `ds-ide.debug` callback (extension.ts:476-485, which re-implements the same sends inline). Divergence has already happened: the debug path omits `sendPotSnapshot` replay ordering used elsewhere and the deploy command duplicates the panel/editor setup block verbatim.

### Evidence
- `src/extension.ts:98-494` — single function; command registrations, IPC event routing, view providers, and state persistence all inline.
- Duplicated blocks at extension.ts:326-347 vs 424-442; extension.ts:314-324 vs 476-485.

### Impact
Every new milestone feature grows this file; the triplicated deploy sequence is a proven drift risk (a new post-deploy message must be added in three places). Testability suffers — `extension.test.ts` must mock the world to reach any branch.

### Affected Files
- src/extension.ts

### Recommended Fix
Extract a `DeployCoordinator` (owns `performDeploy`, `sendPostDeployState`, status-bar transitions) and a small `SessionState` object for `sineState`/`audioSourceState`/`activeRecordPath` persistence. Make `ds-ide.deploy` and `ds-ide.debug` call the same coordinator method with flags rather than re-implementing the sequence.

### Urgency Level
MEDIUM

---

## Webview bundles built with `platform: 'node'`

### Description
`esbuild.js` uses a single build configuration for both the extension host (correctly `platform: 'node'`, `format: 'cjs'`) and the three webview scripts, which execute in a browser (webview) context. With `platform: 'node'`, esbuild resolves `browser`-vs-`main` package fields wrong, assumes Node globals exist, and emits CJS wrappers that only work in the webview because the scripts currently have zero imports. The first `import` added to a webview script (e.g., sharing the message-protocol types module at runtime) will produce a bundle that breaks or silently pulls Node-flavored code.

### Evidence
`esbuild.js:9-24` — one `buildOptions` with `entryPoints` mixing `extension` and `webview/*`, `platform: 'node'`, `format: 'cjs'`, `target: 'node18'`.

### Impact
Latent build misconfiguration; currently harmless, becomes a confusing runtime failure the moment webview code gains dependencies.

### Affected Files
- esbuild.js

### Recommended Fix
Split into two esbuild configs: extension (`platform: 'node'`, `external: ['vscode']`) and webviews (`platform: 'browser'`, `format: 'iife'`, `target: 'chrome114'` or similar).

### Urgency Level
LOW

---

## IPC client: silent message drop and no send-side buffering

### Description
`IpcClient.send()` silently returns when the socket is absent or destroyed, and `onData` silently discards malformed JSON lines. Pot/button changes made between deploys vanish without a trace (mitigated by the snapshot replay after deploy, but mid-session disconnects lose messages invisibly). The 1 MB receive-buffer overflow also wipes the partial buffer and keeps the connection — the next line fragment parses as garbage and is silently dropped too.

### Evidence
- `src/emulator/ipc-client.ts:42-45` — `if (!this.socket || this.socket.destroyed) return;`
- `src/emulator/ipc-client.ts:70-72` — `catch { /* ignore malformed lines */ }` with no logging or counter.
- `src/emulator/ipc-client.ts:56-61` — buffer reset without resynchronization to the next newline.

### Impact
Diagnosing protocol bugs between extension and emulator requires guesswork; user input can be dropped with no feedback.

### Affected Files
- src/emulator/ipc-client.ts

### Recommended Fix
Emit a counted `warn`-level event (or write to the emulator output channel) on dropped sends and malformed lines; after buffer overflow, skip to the next `\n` before resuming parsing.

### Urgency Level
LOW

---

## dfu-util success detected by output-string sniffing

### Description
`runDfuUtil` treats the flash as successful when stdout contains `File downloaded successfully`, even on a non-zero exit code. This works around dfu-util's known quirk of exiting 74 after a successful `:leave`, but string matching is locale/version-fragile — dfu-util output phrasing has changed between releases.

### Evidence
`src/commands/dfu-flash.ts:100-118`:

```ts
if (line.includes('File downloaded successfully')) downloadSucceeded = true;
...
if (code === 0 || downloadSucceeded) resolve();
```

### Impact
A dfu-util version with different success phrasing makes every successful flash report failure (annoyance); conversely the string could in principle appear in an error context and mask a real failure.

### Affected Files
- src/commands/dfu-flash.ts

### Recommended Fix
Constrain the workaround: accept a non-zero exit only when it is the specific known code(s) for "download OK, device left DFU mode" (74), keep the string check as a secondary signal, and add a comment pinning the dfu-util versions this was verified against.

### Urgency Level
LOW

---

## Hand-rolled YAML parser: acceptable trade-off, with sharp edges

### Description
`controller-config.ts` implements a purpose-built YAML subset parser rather than depending on `yaml`/`js-yaml`. Given the project's zero-runtime-dependency stance and the well-tested round-trip, this is a defensible choice. Remaining sharp edges: tabs as indentation are not recognized (lines silently skipped), a top-level `controllers: []` inline empty list is ignored rather than parsed (the scaffolded `controllers.yaml` from `create-effect-project.ts` contains `controls: []`, a section name the parser never reads — harmless but confusing), and unquoted serialized `id`s can change meaning on re-parse (covered in the editorSave finding).

### Evidence
- `src/controllers/controller-config.ts:77-134` — section/list parsing (space-only indentation regexes `^(\s{2,})-` where `\s` also matches tabs but mixed tab widths break the 4-space kv rule).
- `src/commands/create-effect-project.ts:49` — `const controllersYaml = 'controls: []\n';` — key `controls` vs parser sections `controllers`/`buttons`/`leds`.

### Impact
Users hand-editing `controllers.yaml` with tabs or flow syntax get silent partial parses (entries vanish with no error). The template mismatch means new projects start with a YAML key nothing reads.

### Affected Files
- src/controllers/controller-config.ts
- src/commands/create-effect-project.ts

### Recommended Fix
Emit a parse error when a non-blank, non-comment line matches no rule (instead of silently skipping). Fix the scaffold to write an empty file or `controllers: ` header. Document the supported YAML subset at the top of `controller-config.ts`.

### Urgency Level
LOW

---

## Minor hygiene: types/target mismatch, magic values, `which`/`exec` shell use

### Description
Grab-bag of low-priority items:
1. `@types/node ^20` while esbuild targets `node18` — APIs typed as available may not exist in the actual VS Code runtime for `engines.vscode ^1.85` (Node 18).
2. Toolchain detection shells out to `which` via `cp.exec` with fixed strings (`toolchain.ts:34-37`, `debug-adapter.ts:18-21`) — no injection risk today because inputs are constants, but the pattern invites future misuse; `cp.execFile('/usr/bin/which', [bin])` is safer and shell-free.
3. Magic numbers scattered: 200 ms stale-kill wait (`manager.ts:21`), 50 ms DAP terminate delay (named, good), knob geometry constants duplicated between `buildKnobSvg` and `updateKnobPaths` (`controls-webview.ts:82-137`).
4. `hardware-build.ts:31` creates a fresh output channel when none is passed (a leak if ever exercised repeatedly — the extension always passes one today).
5. `webview/scope-panel.ts` `show()` rebuilds `panel.webview.html` on every reveal, discarding scope history on redeploy — if intentional, worth a comment.

### Evidence
See inline references above.

### Impact
Small maintenance friction; no user-visible defects today.

### Affected Files
- package.json
- src/hardware/toolchain.ts
- src/debug/debug-adapter.ts
- src/emulator/manager.ts
- src/webview/controls-webview.ts
- src/commands/hardware-build.ts
- src/webview/scope-panel.ts

### Recommended Fix
Pin `@types/node` to `^18`; switch `which` calls to `execFile`; hoist knob geometry into shared constants; make the channel parameter in `buildForHardware` required.

### Urgency Level
LOW

---

## Testing coverage assessment

### Description
Not a defect — a status note per the review categories. Unit tests exist for all extension-host modules (26 test files, ~4.7k lines; commands, stores, parsers, manager, IPC client, panels, providers) with a solid `__mocks__/vscode.ts`. Gaps: (1) the three webview scripts have zero tests (see the `@ts-nocheck` finding); (2) `extension.ts` `activate()` branches (multi-root warning, `/tmp` cleanup, save-listener routing) are only partially covered; (3) no integration test exercises a real socket round-trip between `IpcClient` and a stub server (the client is tested against an in-memory socket mock only); (4) failure-path coverage for `deploy()` timeout/hang scenarios is thin — the unhandled-rejection and hang findings above would both have been caught by a "deploy fails" assertion on `process.on('unhandledRejection')`.

### Evidence
`src/test/unit/**` — file-per-module layout; no `src/test` coverage of `src/webview/*-webview.ts`.

### Impact
The riskiest untested surface (webview UI logic and deploy failure paths) is where the HIGH findings live.

### Affected Files
- src/test/unit/ (structure)

### Recommended Fix
Add an unhandled-rejection guard to the vitest setup (`process.on('unhandledRejection', fail)`), a net.Server-based IPC round-trip test, and extract-and-test the pure webview logic.

### Urgency Level
LOW

---

## Out of Scope

This review does NOT include:

* Production infrastructure
* Cloud configuration
* Database tuning
* Third-party package source-code auditing
* Performance benchmarking
* Frontend UI correctness
* Formal security penetration testing
