# 06 — Node.js / TypeScript Code Review (v8)

> Generated: 2026-06-21. Covers `src/` excluding tests and mocks.

---

## Unvalidated webview message payloads trigger unsafe casts

### Description
Both `ControlsViewProvider` and `WiringViewProvider` receive messages from the webview with `as` casts on the incoming fields rather than runtime validation. The same pattern appears in `ScopePanel`. Because the webview runs in an untrusted sandbox (it can be compromised or replaced by a malicious extension that injects into the same VS Code window), these casts can produce `NaN`, wrong types, or `undefined` values that propagate into IPC messages sent to the emulator process.

### Evidence
`src/sidebar/controls-view-provider.ts` line 41–48:
```ts
if (m['command'] === 'editorSave') {
  const cfg = m['cfg'] as ControllerConfig | undefined;
  if (cfg) this.onEditorSave(cfg);   // no structural validation
}
```
`src/sidebar/wiring-view-provider.ts` line 31–37:
```ts
await this.onWirePin({
  pinNumber:  m['pinNumber']  as number,   // cast, not checked
  deviceType: m['deviceType'] as WiredPin['deviceType'],
  id:         m['id']         as string,
});
```
`src/webview/scope-panel.ts` line 117–129:
```ts
const input = m['input'] as AudioInputSource;
const sampleRate = m['sampleRate'] as number;
const bufferSize = m['bufferSize'] as number;
// only a truthiness check, not a range check
if (input && sampleRate && bufferSize) { ... }
```

### Impact
A crafted or corrupted webview message can inject unexpected values into `onWirePin` (altering source files with arbitrary pin numbers and IDs) or into IPC messages sent to the native emulator process (e.g., a `NaN` `sampleRate`). The `editorSave` path accepts a whole `ControllerConfig` object from the webview and writes it to `controllers.yaml` on disk without re-validating the structure.

### Affected Files
- `src/sidebar/controls-view-provider.ts`
- `src/sidebar/wiring-view-provider.ts`
- `src/webview/scope-panel.ts`

### Recommended Fix
Add lightweight structural guards before acting on incoming webview data. For `wirePin`, check `typeof pinNumber === 'number' && Number.isFinite(pinNumber) && typeof id === 'string' && id.length > 0`. For `editorSave`, pass the received object through `parseControllerConfig(serializeControllerConfig(cfg))` so the existing validator is exercised before the write. For `audioSource`, validate that `sampleRate` and `bufferSize` are in the expected enumerated set (`[48000]` and `[64, 128, 256, 512]`).

### Urgency Level
MEDIUM

---

## IpcClient silently accumulates an unbounded `partial` buffer

### Description
`IpcClient.onData` appends every received chunk to the `partial` string and only flushes complete newline-terminated lines. If the emulator sends a runaway line (or the socket delivers corrupted data with no newlines) the buffer grows indefinitely without any size cap or timeout, leaking memory for the duration of the VS Code session.

### Evidence
`src/emulator/ipc-client.ts` lines 53–66:
```ts
private onData(data: Buffer): void {
  this.partial += data.toString('utf8');   // unbounded accumulation
  let nl: number;
  while ((nl = this.partial.indexOf('\n')) !== -1) {
    const line = this.partial.slice(0, nl).trim();
    this.partial = this.partial.slice(nl + 1);
    ...
  }
}
```
There is no maximum length check on `this.partial`.

### Impact
A misbehaving or crashed emulator that floods the socket with data and no newlines will cause the extension host process to consume memory until VS Code itself becomes unresponsive. This is particularly relevant during debugging sessions where the emulator process may become unstable.

### Affected Files
- `src/emulator/ipc-client.ts`

### Recommended Fix
Add a cap after the append: `if (this.partial.length > 1 << 20 /* 1 MB */) { this.partial = ''; this.emit('error', new Error('IPC line buffer overflow — possible runaway emulator output')); return; }`. Reset `partial` on disconnect (already done at line 29) so cleanup is correct on reconnect.

### Urgency Level
MEDIUM

---

## Non-atomic stale PID kill creates a TOCTOU window on rapid redeploy

### Description
`killStalePid` reads the PID file, sends `SIGKILL`, then deletes the file. `deploy()` calls `killStalePid` followed immediately by `killExisting()` and then spawns a new process. If two deploy calls race (e.g., user triggers build-and-deploy twice rapidly), both read the same PID file before either deletes it, and both send `SIGKILL` to the stale process — which is harmless — but both then also try to kill the new process's predecessor because `killExisting` runs while the mutex is not held.

More concretely, `deploy()` is not guarded by any mutex. Two simultaneous calls will each spawn a separate `effect_emu` process, with the second call's `DAISY_EMU_SOCKET` line overwriting `this.childProcess` reference while the first `connectIpc` is still awaiting `client.connect`.

### Evidence
`src/emulator/manager.ts` lines 80–141: the entire `deploy()` method has no re-entrancy guard. `this.childProcess`, `this.ipcClient`, and `this.buildDir` are shared mutable fields written during the async flow with no locking.

### Impact
Rapid redeploy can leave an orphaned `effect_emu` process bound to the socket (no IPC client connected to it), or two processes competing for the same Unix socket path. The user sees no audio output and must restart VS Code.

### Affected Files
- `src/emulator/manager.ts`

### Recommended Fix
Add a `private deployLock: Promise<void> | null = null` field. At the entry of `deploy()`, if `this.deployLock` is not null, await it first (or return early with an error). Set `this.deployLock` to the current promise and clear it on completion.

### Urgency Level
MEDIUM

---

## `deployToEmulator` swallows errors and returns void — callers cannot detect failure

### Description
`deployToEmulator` catches errors and shows an error message but always returns `Promise<void>`, making it impossible for callers to know that deployment failed. The `ds-ide.deploy` command calls `deployToEmulator` and then unconditionally calls `sendPotSnapshot`, `sendSine`, etc., even if the deploy threw.

### Evidence
`src/commands/deploy.ts` lines 4–15:
```ts
export async function deployToEmulator(manager: EmulatorManager): Promise<void> {
  ...
  try {
    await manager.deploy((line) => channel.appendLine(line));
    ...
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`ds-ide: deploy failed — ${msg}`);
    // no rethrow, no return value
  }
}
```
`src/extension.ts` line 398 onwards: after `await deployToEmulator(manager!)`, the code proceeds to call `sendPotSnapshot`, `sendSine`, etc. unconditionally.

### Impact
After a failed deploy, the extension sends IPC messages (`sendPotSnapshot`, `sendSine`, `sendAudioMode`) to a non-existent or crashed emulator. `IpcClient.send` silently discards these (socket is null), so the impact is cosmetic today — but the extension UI falsely shows a "deploying…" status bar message and never resets to "stopped".

### Affected Files
- `src/commands/deploy.ts`
- `src/extension.ts`

### Recommended Fix
Change `deployToEmulator` to return `Promise<boolean>` (true = success). Rethrow after the error message, or return false. Check the return value in `extension.ts` before sending the post-deploy IPC messages.

### Urgency Level
MEDIUM

---

## `createOutputChannel` called on every build/deploy — channels accumulate per operation

### Description
`buildForEmulator`, `deployToEmulator`, `buildForHardware`, and `flashToHardware` each call `vscode.window.createOutputChannel(...)` with a fixed name, creating a new channel object every time the command is invoked. VS Code creates a new channel entry in the Output panel on each call; over a long session with many build cycles, the Output dropdown fills with duplicate entries.

### Evidence
`src/commands/build.ts` line 34:
```ts
const channel = vscode.window.createOutputChannel('Daisy IDE Build');
```
`src/commands/deploy.ts` line 5:
```ts
const channel = vscode.window.createOutputChannel('Daisy IDE Emulator');
```
Same pattern in `src/commands/hardware-build.ts` line 38 and `src/commands/dfu-flash.ts` line 51. None of these channels are disposed or stored for reuse.

### Impact
Resource leak: each `OutputChannel` holds a native VS Code output handle. After 20–30 build cycles in a session, the Output panel dropdown becomes cluttered, and each unreleased handle consumes memory in the extension host.

### Affected Files
- `src/commands/build.ts`
- `src/commands/deploy.ts`
- `src/commands/hardware-build.ts`
- `src/commands/dfu-flash.ts`

### Recommended Fix
Create the channels once during `activate()` and pass them into each command function, or use a module-level singleton pattern with lazy initialization. Add the channels to `context.subscriptions` so they are disposed on deactivation.

### Urgency Level
LOW

---

## `extension.ts` uses non-null assertions (`!`) on module-level singletons throughout

### Description
`extension.ts` defines `manager`, `scopePanel`, `controlsViewProvider`, `wiringViewProvider`, `potStore`, and `buttonStore` as module-level `let` variables initialised to `undefined`. After `activate()`, all command handlers use `!` non-null assertions (`manager!`, `potStore!`, etc.) to access them. If any command fires before `activate()` completes, or if `activate()` throws partway through, these assertions will throw a runtime `TypeError`.

### Evidence
`src/extension.ts` lines 62–67 (module-level declarations):
```ts
let manager: EmulatorManager | undefined;
let scopePanel: ScopePanel | undefined;
...
```
Lines 384–385 (command handler):
```ts
vscode.commands.registerCommand('ds-ide.build', () =>
  buildForEmulator(manager!, context.extensionPath, diagnostics),
),
```
The `!` pattern is used at least 25 times throughout `extension.ts`.

### Impact
In the unlikely event that a command runs before activation is fully complete, the extension host crashes with an unhandled `TypeError`. More practically, this pattern bypasses TypeScript's strictness guarantee — the compiler believes these are always non-null because of the `!`, so future refactors lose the safety net.

### Affected Files
- `src/extension.ts`

### Recommended Fix
Encapsulate the shared state in a class (`ExtensionState`) with typed non-optional fields, instantiated once at the start of `activate()`. Pass the instance to each command registration closure. This removes all `!` assertions and makes activation failures visible at the declaration site rather than at runtime.

### Urgency Level
LOW

---

## Webview HTML contains inline JavaScript with no Content Security Policy

### Description
Both `scope-panel.ts` and `controls-view-provider.ts` generate large webview HTML pages with `<script>` blocks and no `Content-Security-Policy` (CSP) meta tag. VS Code's webview security model recommends setting `script-src 'nonce-...'` (or at minimum `script-src 'self'`) in all webviews to prevent injection of external scripts.

### Evidence
`src/webview/scope-panel.ts` line 279 — `buildHtml` returns a `<!DOCTYPE html>` page with no CSP header. `src/sidebar/controls-view-provider.ts` line 103 — `buildHtml` similarly has no CSP.

Both functions generate HTML with significant inline JavaScript (hundreds of lines) that runs inside the webview sandbox. VS Code recommends against inline `<script>` without a nonce-based CSP when `enableScripts: true`.

### Impact
Without a CSP, if an attacker finds a way to inject content into the webview (e.g., via a malicious file opened in the workspace that triggers `postMessage` injection), arbitrary scripts could run inside the webview context. The webview has access to `acquireVsCodeApi()` and can post messages to the extension host, which in turn writes to the filesystem and sends IPC commands to the emulator. The risk is low but non-zero in a developer tool context.

### Affected Files
- `src/webview/scope-panel.ts`
- `src/sidebar/controls-view-provider.ts`
- `src/wiring/wiring-panel.ts`

### Recommended Fix
Add a nonce-based CSP to each webview. Generate a random nonce per webview creation, add `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">`, and add the `nonce="${nonce}"` attribute to each `<script>` tag. See VS Code's webview guide for the canonical pattern.

### Urgency Level
LOW

---

## `hardware/toolchain.ts` uses synchronous `execSync` on extension activation path

### Description
`detectArmToolchain` and `detectDfuUtil` call `cp.execSync` (`which arm-none-eabi-gcc`) synchronously. These functions are called on the command execution path from `buildForHardware` and `flashToHardware`, which are invoked synchronously at the start of those command handlers. Because VS Code extensions run on the Node.js main thread, a synchronous `execSync` that takes >100 ms (common on macOS when `which` traverses a slow NFS PATH) will freeze the VS Code UI.

### Evidence
`src/hardware/toolchain.ts` lines 42–46:
```ts
try {
  const result = execSync(`which ${ARM_GCC_BINARY} 2>/dev/null`).toString().trim();
  if (result && existsSync(result)) return result;
} catch { /* not on PATH */ }
```
`src/debug/debug-adapter.ts` line 17:
```ts
const result = execSync('xcrun --find lldb-dap 2>/dev/null').toString().trim();
```
Both are also called on `activate()` indirectly (via `DaisyDebugAdapterFactory` construction).

### Impact
On macOS with a slow shell profile or network PATH, `which arm-none-eabi-gcc` can block for 1–3 seconds. During that time the VS Code UI is frozen. This is particularly noticeable when the extension is activated on workspace open.

### Affected Files
- `src/hardware/toolchain.ts`
- `src/debug/debug-adapter.ts`

### Recommended Fix
Replace `execSync` with `cp.execFileSync` (avoids shell overhead) or, better, use `cp.execFile` asynchronously and `await` the result. Cache the detected path in a module-level variable so subsequent invocations return immediately.

### Urgency Level
MEDIUM

---

## `safeJson` in `controls-view-provider.ts` and `wiring-panel.ts` has an incomplete XSS escape

### Description
The `safeJson` helper escapes `</` as `<\/` to prevent the `</script>` tag from terminating the inline script block. This is the correct approach, but the implementation is incomplete: the `<` character by itself (without `/`) can still form `<script` injection inside JSON strings if the serialized data contains `<script`. While unlikely in practice for the data being serialized (controller IDs and pin numbers), the pattern is fragile.

### Evidence
`src/sidebar/controls-view-provider.ts` line 98–100:
```ts
function safeJson(obj: unknown): string {
  return JSON.stringify(obj).replace(/<\//g, '<\\/');
}
```
Same function in `src/wiring/wiring-panel.ts` line 140–142. This function is used to embed user-controlled data (controller IDs, pin IDs) into the webview `<script>` as a JSON blob.

### Impact
A controller ID containing `<script>alert(1)</script>` in a `controllers.yaml` would survive the `safeJson` escape because only `</` is replaced. The attacker would need to control `controllers.yaml` content, which requires filesystem write access — so the practical risk is very low. However, the pattern should be hardened for correctness.

### Affected Files
- `src/sidebar/controls-view-provider.ts`
- `src/wiring/wiring-panel.ts`

### Recommended Fix
Use the complete JSON-in-HTML escape: replace `<`, `>`, and `&` with their Unicode escape sequences (`<`, `>`, `&`) after `JSON.stringify`. A reliable one-liner: `JSON.stringify(obj).replace(/[<>&]/g, c => ({ '<': '\\u003c', '>': '\\u003e', '&': '\\u0026' })[c] ?? c)`.

### Urgency Level
LOW

---

## `controls-writer.ts` uses ID string matching instead of structured deletion for init lines

### Description
`removeInitFromSource` identifies lines to remove from the init block by checking whether the line contains `${id}.Init` or `${id}.InitSingle`. If two control IDs share a prefix (e.g., `pot` and `pot2`), the check `l.includes('pot.Init')` will not match `pot2`, but `l.includes('pot2.InitSingle')` will never accidentally match `pot`. However, if a user names two controls `vol` and `volume`, `l.includes('vol.Init')` will match lines for both IDs — `volume.Init` contains the substring `vol.Init` is not correct, but `volume.InitSingle` contains `vol` — actually the check is `l.includes(\`${id}.Init\`)` so for `id = 'vol'` it checks `vol.Init` which would also match `volume.InitSingle(...)` because `volume.InitSingle` does not contain `vol.Init`.

Wait — the actual risk is the reverse: `id = 'vol'` matches `l.includes('vol.Init')`, and `volume.InitSingle(...)` contains `vol` but not `vol.Init`. So this particular case is safe. The real issue is that `l.includes('vol.InitSingle')` would not match for a different ID. The genuine bug is: if `id = 'p'` and another variable is named `pot`, then `l.includes('p.Init')` matches both `p.Init(...)` and any hypothetical `p.InitSingle(...)`. But `pot.Init` does NOT contain `p.Init`. The ID matching is safe only because `.` is the delimiter.

The actual fragility is that the pattern relies on user-supplied IDs being valid C++ identifiers (no special regex characters), which is validated by `validateName` in `create-effect-project.ts` but not in `wiring-view-provider.ts` `wirePin` handling (the ID comes from the webview popup, which only calls `validateId` in JS without an equivalent TypeScript re-validation on the host side).

### Evidence
`src/wiring/controls-writer.ts` lines 146–148:
```ts
if (l.startsWith(ADC_INIT_PREFIX)) continue;
if (l.includes(`${id}.Init`) || l.includes(`${id}.InitSingle`)) continue;
remaining.push(l);
```
`src/sidebar/wiring-view-provider.ts` line 31–37: the `id` field from the webview is accepted with only a type cast, no regex validation against `^[a-zA-Z_][a-zA-Z0-9_]*$`.

### Impact
An ID containing a dot (`.`) passed from a crafted webview message would produce a `l.includes('foo.bar.Init')` check that might incorrectly delete unrelated init lines, corrupting the user's source file. This is a source-code mutation operation, so the impact is HIGH for correctness even though the attacker surface is limited to the webview.

### Affected Files
- `src/wiring/controls-writer.ts`
- `src/sidebar/wiring-view-provider.ts`

### Recommended Fix
Validate the `id` field in the TypeScript host-side handler in `wiring-view-provider.ts` before calling `onWirePin`: `if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(id)) return;`. Optionally switch to a line-level regex in `removeInitFromSource` that anchors the match: `/\b${id}\.(Init|InitSingle)\b/` — though the identifier validation fix is the primary remediation.

### Urgency Level
MEDIUM

---

## `parseBuildLine` regex does not accept Windows-style paths — silent miss on non-POSIX build output

### Description
The compiler diagnostic regex in `build-diagnostics.ts` uses `(.+\.(?:cpp|c|h|hpp))` as the file path group, which will technically match Windows paths (they don't contain newlines), but the regex anchors on `:` as the file/line separator without accounting for the Windows drive letter colon (e.g., `C:\path\to\file.cpp:12:5:`). On Windows, the drive letter `C:` would be consumed by the file path group, but the second `:` following the drive letter would be the one matched as the line number separator — resulting in `C` being parsed as part of the filename and `\path\to\file.cpp` as the start of the `line` group (which fails `parseInt`), silently discarding all diagnostics.

### Evidence
`src/diagnostics/build-diagnostics.ts` lines 6–7:
```ts
const DIAG_RE = /^(.+\.(?:cpp|c|h|hpp)):(\d+):(\d+):\s+(error|warning|note):\s+(.*)$/;
```
This regex is not tested against Windows paths in the test suite (`src/test/unit/diagnostics/build-diagnostics.test.ts`).

### Impact
On Windows hosts, compiler diagnostics would not appear in the VS Code Problems panel. Build errors would be invisible to the user (they'd still appear in the Output channel, but not as navigable diagnostics). This is a correctness issue for cross-platform support.

### Affected Files
- `src/diagnostics/build-diagnostics.ts`

### Recommended Fix
Use the VS Code diagnostic parser convention: match an optional Windows drive letter at the start: `/^([A-Za-z]:)?(.+\.(?:cpp|c|h|hpp)):(\d+):(\d+):\s+(error|warning|note):\s+(.*)$/`. Adjust group indices accordingly. Add a test case with `C:\Users\user\effect.cpp:12:5: error: ...`.

### Urgency Level
LOW

---

## `extension.ts` module-level mutable state survives between test runs without reset

### Description
`extension.ts` declares module-level `let` variables (`manager`, `scopePanel`, `controlsViewProvider`, etc.) that are set in `activate()` but never cleared between test cases unless `deactivate()` also clears them (it does call `manager?.dispose()` and `scopePanel?.dispose()`, but does not null the module-level references). In the test suite, multiple calls to `activate()` in the same module scope accumulate listeners on the shared `manager` mock instance and on the VS Code API mocks, because the module is not re-imported between tests (Vitest caches modules).

### Evidence
`src/test/unit/extension.test.ts` lines 61–63:
```ts
beforeEach(() => {
  vi.clearAllMocks();
  managerInstances.length = 0;
});
```
`vi.clearAllMocks()` clears mock call counts but does not reset module-level state in `extension.ts`. If `activate` is called in multiple `it` blocks, the module-level `manager` reference is overwritten, but event listeners registered in the previous `activate` call remain attached to the old mock instance.

### Impact
Test isolation is incomplete. A test that emits events on `managerInstances[0]` may receive responses from listeners registered by a previous test's `activate` call. This can produce false positives (tests pass because a stale listener fires) or false negatives. The `it('activate pushes disposables onto context.subscriptions')` test hardcodes `21` as the expected count, which is a brittle exact-count assertion.

### Affected Files
- `src/test/unit/extension.test.ts`
- `src/extension.ts`

### Recommended Fix
In `extension.ts`, clear all module-level references at the top of `activate()` (and in `deactivate()`): `manager = undefined; scopePanel = undefined; controlsViewProvider = undefined;` etc. In the test, use `vi.resetModules()` in `beforeEach` and re-import the module dynamically (`const { activate } = await import('../../extension')`). Several tests already do this (the `extension view initialization` suite) — apply the same pattern consistently.

### Urgency Level
LOW

---

## No CSP or `localResourceRoots` restriction on webview panels

### Description
The `ScopePanel` and `WiringPanel` webview panels are created with `{ enableScripts: true, retainContextWhenHidden: true }` but without a `localResourceRoots` restriction. This means the webview can theoretically load resources from any path on the user's filesystem using `vscode-resource:` URIs, not just from the extension's own media directory.

### Evidence
`src/webview/scope-panel.ts` line 97–101:
```ts
this.panel = vscode.window.createWebviewPanel(
  PANEL_ID,
  PANEL_TITLE,
  vscode.ViewColumn.Two,
  { enableScripts: true, retainContextWhenHidden: true },
);
```
No `localResourceRoots` key is present. Same at `src/wiring/wiring-panel.ts` line 96–101.

### Impact
Since these panels generate all their HTML inline and do not load any external resources, the practical risk is low. However, VS Code security guidelines recommend always setting `localResourceRoots: []` when no file resources are needed, to prevent any accidental resource leakage.

### Affected Files
- `src/webview/scope-panel.ts`
- `src/wiring/wiring-panel.ts`

### Recommended Fix
Add `localResourceRoots: []` to the `WebviewOptions` object when no file-system resources are loaded from the webview. This explicitly locks down the resource scope to nothing.

### Urgency Level
LOW

---

## `detectEffectSrc` skips subdirectory scan — misses multi-level project layouts

### Description
`detectEffectSrc` only scans the top-level of `projectRoot` for `.cpp` files. Projects that place their effect source in a `src/` subdirectory (a common convention) will not be detected, and the user receives an error asking them to configure `ds-ide.effectSource` manually with no further guidance.

### Evidence
`src/commands/build.ts` lines 68–86: `fs.readdirSync(projectRoot)` reads one level only; no recursion or common subdirectory fallback (e.g., `src/`, `source/`, `app/`).

### Impact
A low friction issue: new users who follow a standard project layout (e.g., from Daisy example templates that put effect code in `src/`) receive a confusing error rather than auto-detection. However, this is a UX concern rather than a crash or security issue.

### Affected Files
- `src/commands/build.ts`

### Recommended Fix
After failing to find a `.cpp` at the root, probe one common subdirectory: check `src/*.cpp` and `source/*.cpp` as fallback candidates. Document the `ds-ide.effectSource` setting clearly in the error message.

### Urgency Level
LOW

---

## Testing: no test coverage for `wiring/controls-writer.ts` edge cases in conflict scenarios

### Description
`controls-writer.ts` has the highest risk of correctness bugs because it mutates user source files. While basic insert/remove functionality is covered in `src/test/unit/wiring/controls-writer.test.ts`, the following important edge cases are not tested:

1. Insert when the init block is absent but the declaration block is present.
2. Remove when the init block contains lines from other controls that must be preserved.
3. `adcInitLine` regeneration when pots are partially removed (verifying the arg count matches).
4. Behaviour when the same ID appears twice in the declaration block (duplicate annotation).

### Evidence
The test file `src/test/unit/wiring/controls-writer.test.ts` exists but cannot be verified from source file listing alone. Based on the implementation complexity of `insertInitIntoSource` and `removeInitFromSource` (handling present/absent init blocks, non-adc-line filtering, and adc.Init regeneration), and the absence of these specific scenarios in the code paths that are exercised by the existing extension tests, these cases are likely not covered.

### Impact
Untested edge cases in a source-file mutation module can result in silent corruption of user C++ code that must then be manually recovered from git. The impact is HIGH for user trust even though the probability is low.

### Affected Files
- `src/wiring/controls-writer.ts`
- `src/test/unit/wiring/controls-writer.test.ts`

### Recommended Fix
Add parameterised tests for the four scenarios above. Snapshot testing (comparing the full output string) is appropriate here since the function is pure. Use `vitest`'s `test.each` to cover the matrix of `(block present/absent) × (init block present/absent) × (pots count 0/1/N)`.

### Urgency Level
MEDIUM

---

## Testing: `extension.test.ts` hardcodes a brittle subscription count

### Description
The test `'activate pushes disposables onto context.subscriptions'` asserts exactly 21 entries. This breaks whenever any new subscription, command, or debug registration is added to `activate()`, producing a test failure that reveals nothing about what is actually wrong.

### Evidence
`src/test/unit/extension.test.ts` line 93:
```ts
expect((ctx.subscriptions as unknown[]).length).toBe(21);
```

### Impact
Low: the assertion is a false safety net. When it breaks during future development, the developer will update the magic number without investigating what changed. It provides no protection against accidentally missing a subscription registration.

### Affected Files
- `src/test/unit/extension.test.ts`

### Recommended Fix
Replace the exact count with targeted assertions: check that the subscriptions array contains disposables for each known registration (debug factories, view providers, workspace watcher, manager/scope disposal). Alternatively, assert `subscriptions.length >= MINIMUM_EXPECTED` and add separate tests for each specific registration.

### Urgency Level
LOW

---

## Summary

| # | Finding | Category | Urgency |
|---|---------|----------|---------|
| 1 | Unvalidated webview message payloads trigger unsafe casts | Validation / Security | MEDIUM |
| 2 | IpcClient silently accumulates an unbounded `partial` buffer | Runtime Safety | MEDIUM |
| 3 | Non-atomic stale PID kill creates a race window on rapid redeploy | Async / Concurrency | MEDIUM |
| 4 | `deployToEmulator` swallows errors — callers cannot detect failure | Error Handling / API Design | MEDIUM |
| 5 | `createOutputChannel` called on every invocation — channels accumulate | Performance / Resource Leak | LOW |
| 6 | Module-level singletons accessed via `!` throughout `extension.ts` | Type Safety / Maintainability | LOW |
| 7 | Webview HTML has no Content Security Policy | Security | LOW |
| 8 | `safeJson` XSS escape is incomplete | Security | LOW |
| 9 | ID string matching in `controls-writer.ts` relies on host-side re-validation of webview input | Validation / Correctness | MEDIUM |
| 10 | `parseBuildLine` regex silently drops all diagnostics on Windows paths | Validation | LOW |
| 11 | Module-level state in `extension.ts` degrades test isolation | Testing | LOW |
| 12 | No `localResourceRoots` restriction on webview panels | Security | LOW |
| 13 | `detectEffectSrc` misses subdirectory project layouts | Maintainability / UX | LOW |
| 14 | Missing `controls-writer.ts` edge-case tests for source mutation | Testing | MEDIUM |
| 15 | Brittle exact-count assertion in `extension.test.ts` | Testing | LOW |
