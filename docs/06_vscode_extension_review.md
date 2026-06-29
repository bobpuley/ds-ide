# VS Code Extension Code Review

**Date:** 2026-06-28
**Scope:** ./src/, ./.vscode/
**Reviewer:** Automated static review

## Summary

**0 HIGH · 7 MEDIUM · 8 LOW**

The extension is architecturally sound: CSP nonces are present on all three webviews, messages are validated before acting on them, the main VS Code disposables are pushed into `context.subscriptions`, and the IPC client handles buffer overflow and graceful disconnect correctly. The primary concerns are synchronous blocking calls scattered through the Extension Host path, a silent false-success return from `deploy()` when a concurrent deploy is in progress, and a progressive event-listener accumulation leak inside the controls webview. The missing `contributes.configuration` section is the most visible gap for marketplace readiness.

---

## MEDIUM

---

## Synchronous Filesystem and Process Calls Block the Extension Host

### Description
Several functions called in the critical path (build, deploy, debug start) use Node.js synchronous APIs that block the Extension Host's single-threaded event loop. While each individual call is short, the aggregate delay is visible to users and violates VS Code extension guidelines.

### Evidence

`src/commands/build.ts` — `detectEffectSrc()` and `detectDaisySP()` use `fs.readdirSync` and `fs.statSync`:
```typescript
const entries = fs.readdirSync(dir);          // line 76
return fs.statSync(p).isDirectory();          // line 105
```

`src/emulator/manager.ts` — `killStalePid`, `writePid`, and `clearPid` use `fs.readFileSync`, `fs.writeFileSync`, `fs.unlinkSync`, called during `build()` and `deploy()`:
```typescript
const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);  // line 15
fs.writeFileSync(pidFilePath(buildDir), String(pid));                // line 22
fs.unlinkSync(pidFilePath(buildDir));                                // line 27
```

`src/debug/debug-adapter.ts` — `findLldbDap()` calls `cp.execSync` inside `createDebugAdapterDescriptor`, invoked synchronously by VS Code during debug session start:
```typescript
const result = execSync('xcrun --find lldb-dap 2>/dev/null').toString().trim();  // line 17
```

`src/hardware/toolchain.ts` — `detectArmToolchain()` and `detectDfuUtil()` call `cp.execSync('which ...')` during hardware build and flash commands:
```typescript
const result = execSync(`which ${ARM_GCC_BINARY} 2>/dev/null`).toString().trim();  // line 43
```

### Impact
Extension Host freezes briefly during build, deploy, and debug-session init. VS Code may display the "extension host is busy" spinner. On slow NFS or VPN mounts the blocking reads can take hundreds of milliseconds.

### Affected Files
- `src/commands/build.ts`
- `src/emulator/manager.ts`
- `src/debug/debug-adapter.ts`
- `src/hardware/toolchain.ts`
- `src/commands/dfu-flash.ts`

### Recommended Fix
Replace `fs.readFileSync/writeFileSync/unlinkSync/readdirSync/statSync` with their `fs.promises.*` equivalents and make callers `async`. Replace `cp.execSync('which ...')` with a promise-wrapped `cp.execFile` call. `findLldbDap` in `debug-adapter.ts` can be made async and awaited inside `createDebugAdapterDescriptor` (which supports returning a `Thenable`).

### Urgency Level
MEDIUM

---

## `deploy()` Returns `undefined` on Concurrent Call — Caller Misinterprets as Success

### Description
`EmulatorManager.deploy()` returns `undefined` (not a promise) when a deploy is already in progress. The caller `deployToEmulator()` awaits the result and then unconditionally shows "emulator running" and returns `true`, even though the emulator was not actually started by this call.

### Evidence

`src/emulator/manager.ts`, lines 86–87:
```typescript
if (this.deployLock) return;
```
This bare `return` makes the async function return `Promise<undefined>`.

`src/commands/deploy.ts`, lines 10–13:
```typescript
await manager.deploy((line) => outputChannel.appendLine(line));
void vscode.window.showInformationMessage('ds-ide: emulator running');
return true;
```
When `deploy()` returns early, `await` resolves immediately, the success message is shown, and `true` is returned — even though the first deploy may still be in flight or may already have failed.

The same false-success pattern affects `performBuildAndDeploy()` in `extension.ts` (line 277) and `debugDeploy()` in `src/commands/debug-deploy.ts` (line 21).

### Impact
Rapid double-deploy (e.g., the user hits a keybinding twice) results in the status bar and scope panel showing a running state, pot/button/sine state being pushed, and "emulator running" being displayed — all while the first deploy is still in flight. If the first deploy ultimately fails, the UI is in an inconsistent state.

### Affected Files
- `src/emulator/manager.ts`
- `src/commands/deploy.ts`
- `src/commands/debug-deploy.ts`
- `src/extension.ts`

### Recommended Fix
Return the existing lock promise so callers wait for the already-in-flight deploy:
```typescript
if (this.deployLock) return this.deployLock;
```
This makes duplicate calls coalesce on the same outcome without spawning a second process.

### Urgency Level
MEDIUM

---

## `controllers.yaml` Written with `fs.writeFileSync` in Extension Host Message Handler

### Description
The `onEditorSave` callback registered in `activate()` uses `fs.writeFileSync` to persist the controller layout. This synchronous write runs on the Extension Host thread, inside a webview message handler callback.

### Evidence

`src/extension.ts`, lines 89–93:
```typescript
(cfg) => {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.[0]) return;
  const yamlPath = path.join(folders[0].uri.fsPath, 'controllers.yaml');
  try {
    fs.writeFileSync(yamlPath, serializeControllerConfig(cfg), 'utf8');
  } catch (err) {
    void vscode.window.showErrorMessage(`ds-ide: could not write controllers.yaml: ${String(err)}`);
  }
},
```

### Impact
Blocks the Extension Host for the duration of the disk write. On slow storage or a large layout file this causes a visible freeze. The VS Code filesystem API provides an async alternative.

### Affected Files
- `src/extension.ts`

### Recommended Fix
Replace with the async VS Code filesystem API:
```typescript
async (cfg) => {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.[0]) return;
  const yamlUri = vscode.Uri.file(path.join(folders[0].uri.fsPath, 'controllers.yaml'));
  try {
    await vscode.workspace.fs.writeFile(yamlUri, Buffer.from(serializeControllerConfig(cfg), 'utf8'));
  } catch (err) {
    void vscode.window.showErrorMessage(`ds-ide: could not write controllers.yaml: ${String(err)}`);
  }
}
```

### Urgency Level
MEDIUM

---

## Missing `contributes.configuration` for Extension Settings

### Description
The extension reads two configuration keys — `ds-ide.effectSource` and `ds-ide.armToolchainPath` — from `vscode.workspace.getConfiguration('ds-ide')`, but neither is declared in `contributes.configuration` in `package.json`. Without this declaration the settings are invisible in the VS Code Settings UI and have no documented type, default value, or description.

### Evidence

`src/extension.ts`, line 32:
```typescript
const configured = vscode.workspace.getConfiguration('ds-ide').get<string>('effectSource');
```

`src/commands/hardware-build.ts`, line 25:
```typescript
const configuredPath = vscode.workspace.getConfiguration('ds-ide').get<string>('armToolchainPath');
```

`package.json` `contributes` section: no `configuration` key is present.

### Impact
Users who need to override the effect source path or specify the ARM toolchain path have no discoverable way to do so. On the marketplace this leads to support requests and confusion.

### Affected Files
- `package.json`

### Recommended Fix
Add a `contributes.configuration` block to `package.json`:
```json
"contributes": {
  "configuration": {
    "title": "Daisy IDE",
    "properties": {
      "ds-ide.effectSource": {
        "type": "string",
        "default": "",
        "description": "Path to the effect .cpp file (relative to workspace root, or absolute). Leave empty for auto-detection."
      },
      "ds-ide.armToolchainPath": {
        "type": "string",
        "default": "",
        "description": "Path to arm-none-eabi-gcc binary or its containing bin/ directory. Leave empty for auto-detection."
      }
    }
  }
}
```

### Urgency Level
MEDIUM

---

## `@vscode/vsce` Missing from `devDependencies` — Packaging Fails Without Global Install

### Description
The `package` npm script invokes `vsce package`, but `@vscode/vsce` is not listed in `devDependencies`. Running `npm run package` on a clean machine or CI agent without a globally installed `vsce` fails with "command not found".

### Evidence

`package.json`, line 179:
```json
"package": "node esbuild.js --production && vsce package --no-dependencies"
```

`package.json` `devDependencies`: no `@vscode/vsce` or `vsce` entry.

### Impact
The packaging step is not self-contained. CI builds fail; contributors must know to install `vsce` globally as a prerequisite not captured in `package.json`.

### Affected Files
- `package.json`

### Recommended Fix
Add `@vscode/vsce` to `devDependencies`:
```json
"@vscode/vsce": "^2.24.0"
```
Update the script to use the local binary:
```json
"package": "node esbuild.js --production && npx vsce package --no-dependencies"
```

### Urgency Level
MEDIUM

---

## Accumulated Global Event Listeners in Controls Webview — Memory/Performance Leak Per Render Cycle

### Description
The controls webview registers `document.addEventListener('mousemove', ...)` and `document.addEventListener('mouseup', ...)` inside `buildConventionCard()` and `makeDraggable()` for every control card that is created. These listeners are never removed. Every call to `renderConventionCanvas()` or `renderCanvas()` (triggered on file save, visibility change, config load, or deploy) removes the old card DOM nodes but leaves the corresponding `document` listeners alive. Listeners accumulate at a rate of (cards × render cycles).

### Evidence

In the embedded webview script in `src/controllers/controls-view-provider.ts`, `buildConventionCard()` for pots:
```javascript
const onKnobMove = e => { if (!kDrag) return; ... };
const onKnobUp   = () => { kDrag = false; };
document.addEventListener('mousemove', onKnobMove);  // never removed
document.addEventListener('mouseup',   onKnobUp);    // never removed
```

`makeDraggable()` (called for every card, regardless of kind):
```javascript
document.addEventListener('mousemove', e => { if (!drag) return; ... });  // never removed
document.addEventListener('mouseup',   () => { drag = false; });           // never removed
```

`renderConventionCanvas()` clears existing cards:
```javascript
area.querySelectorAll('.ctrl-card').forEach(c => c.remove());
```
…but the `document`-level listeners from removed cards remain alive, each holding a closure over the card's state.

### Impact
With 4 pots and 10 render cycles (triggered by saves, deploys, etc.), there are 80+ lingering `mousemove`/`mouseup` handlers on `document`. The handlers short-circuit when `!kDrag`/`!drag`, but they still execute on every mouse event in the webview, degrading responsiveness over a work session.

### Affected Files
- `src/controllers/controls-view-provider.ts` (embedded webview script)

### Recommended Fix
Either:
1. Use event delegation on `#canvas-area` for `mousemove`/`mouseup` instead of per-card `document` listeners — a single pair of handlers that dispatch to the currently dragging card.
2. Track all `document`-level listener references and remove them before clearing the canvas in each `render*` function:
   ```javascript
   const docListeners = [];
   function addDocListener(type, fn) {
     document.addEventListener(type, fn);
     docListeners.push([type, fn]);
   }
   function clearDocListeners() {
     docListeners.forEach(([t, f]) => document.removeEventListener(t, f));
     docListeners.length = 0;
   }
   // Call clearDocListeners() at the top of renderConventionCanvas() and renderCanvas()
   ```

### Urgency Level
MEDIUM

---

## `onDidReceiveMessage` and `onDidChangeVisibility` Disposables Discarded in View Providers

### Description
In both `ControlsViewProvider.resolveWebviewView()` and `WiringViewProvider.resolveWebviewView()`, the `Disposable` objects returned by `view.webview.onDidReceiveMessage(...)` and `view.onDidChangeVisibility(...)` are silently discarded. If a view is resolved more than once, stale listeners from the prior resolution can remain alive alongside new ones.

### Evidence

`src/sidebar/controls-view-provider.ts`, lines 34 and 56:
```typescript
view.webview.onDidReceiveMessage((msg: unknown) => { ... });  // return value discarded
view.onDidChangeVisibility(() => { ... });                    // return value discarded
```

`src/sidebar/wiring-view-provider.ts`, lines 29 and 59:
```typescript
view.webview.onDidReceiveMessage(async (msg: unknown) => { ... });  // return value discarded
view.onDidChangeVisibility(() => { ... });                          // return value discarded
```

By contrast, `ScopePanel.show()` in `src/webview/scope-panel.ts` correctly tracks `msgDisposable` and disposes it in the `onDidDispose` handler (lines 159–164).

### Impact
VS Code may re-resolve a `WebviewView` after an extension restart or certain panel operations. When this occurs, duplicate callbacks fire for the same incoming message, potentially causing double-execution of state mutations (duplicate pot sends, duplicate `loadEditor` calls, etc.).

### Affected Files
- `src/sidebar/controls-view-provider.ts`
- `src/sidebar/wiring-view-provider.ts`

### Recommended Fix
Track the returned disposables and dispose them when the view is disposed or re-resolved:
```typescript
resolveWebviewView(view: vscode.WebviewView): void {
  this.view = view;
  const d1 = view.webview.onDidReceiveMessage(...);
  const d2 = view.onDidChangeVisibility(...);
  view.onDidDispose(() => { d1.dispose(); d2.dispose(); this.view = undefined; });
  ...
}
```

### Urgency Level
MEDIUM

---

## LOW

---

## Stale Unix Socket Files Accumulate in `/tmp` on Emulator Crash

### Description
Each `deploy()` call creates a unique Unix domain socket at `/tmp/daisy_emu_${Date.now()}.sock`. If the emulator crashes before unlinking the socket file, or if the extension process is killed abruptly, the file remains in `/tmp`. There is no sweep on activation.

### Evidence

`src/emulator/manager.ts`, line 89:
```typescript
const socketPath = `/tmp/daisy_emu_${Date.now()}.sock`;
```

The socket is cleaned up only by the emulator process itself on graceful exit. The PID-file mechanism cleans up the PID, but there is no parallel mechanism for the socket path.

### Affected Files
- `src/emulator/manager.ts`

### Recommended Fix
On `activate()`, scan `/tmp/daisy_emu_*.sock` with a glob and unlink stale entries. Alternatively, use a deterministic socket path derived from a hash of the workspace folder and always unlink it in `killExisting()` before spawning a new process.

### Urgency Level
LOW

---

## `DsIdeTerminatingAdapter.dispose()` Does Not Cancel Pending `setTimeout`

### Description
`DsIdeTerminatingAdapter.handleMessage()` schedules a 50 ms `setTimeout` to fire a `terminated` DAP event. If the adapter is disposed before the timeout fires, the callback still runs and calls `this._emitter.fire(...)` on a disposed `EventEmitter`.

### Evidence

`src/debug/run-config-provider.ts`, lines 83–91:
```typescript
} else if (req.command === 'launch' || req.command === 'attach') {
  setTimeout(() => {
    this._emitter.fire({ type: 'event', event: 'terminated', seq: ++this._seq, body: {} }
      as unknown as vscode.DebugProtocolMessage);
  }, 50);
}
```

`dispose()` (lines 95–97) does not cancel the timer:
```typescript
dispose(): void {
  this._emitter.dispose();
}
```

### Impact
Calling `fire()` on a disposed VS Code `EventEmitter` is currently a no-op, so there is no crash. However, it is incorrect by design and could trigger unexpected behavior in future VS Code versions.

### Affected Files
- `src/debug/run-config-provider.ts`

### Recommended Fix
Store the timer handle and clear it in `dispose()`:
```typescript
private _terminateTimer: ReturnType<typeof setTimeout> | null = null;

// In handleMessage:
this._terminateTimer = setTimeout(() => { ... }, 50);

// In dispose():
dispose(): void {
  if (this._terminateTimer !== null) {
    clearTimeout(this._terminateTimer);
    this._terminateTimer = null;
  }
  this._emitter.dispose();
}
```

### Urgency Level
LOW

---

## Missing Input Range Validation for Several Webview Message Fields

### Description
Several webview message handlers check the type of incoming values but do not validate their ranges. The controls webview is sandboxed, but defense-in-depth validation is still best practice before forwarding values over IPC.

### Evidence

`src/sidebar/controls-view-provider.ts` — `pot` handler (line 48):
```typescript
if (m['command'] === 'pot' && typeof m['channel'] === 'number' && typeof m['value'] === 'number') {
  this.onPotChange(m['channel'], m['value']);
}
```
`channel` is not range-checked (valid: 0–11); `value` is not range-checked (valid: 0–1).

`src/webview/scope-panel.ts` — `sine` handler (line 116):
```typescript
if (m['command'] === 'sine' && typeof m['freq'] === 'number' && typeof m['amplitude'] === 'number') {
  this.manager.sendSine(m['freq'], m['amplitude']);
}
```
No bounds validation before IPC forwarding.

`src/webview/scope-panel.ts` — `audioSource` handler (line 121): `input` is not validated against the `'sine' | 'live' | 'wav'` enum before being stored in `this.audioSource`.

`src/webview/scope-panel.ts` — `outputVolume` handler (line 154):
```typescript
if (m['command'] === 'outputVolume' && typeof m['volume'] === 'number') {
  this.manager.sendOutputVolume(m['volume']);
}
```
`volume` has no 0–1 clamp.

Note: `src/sidebar/wiring-view-provider.ts` already does this correctly with full range and regex validation and serves as the reference pattern.

### Affected Files
- `src/sidebar/controls-view-provider.ts`
- `src/webview/scope-panel.ts`

### Recommended Fix
Add range guards before forwarding to the manager, following the pattern in `wiring-view-provider.ts`:
```typescript
// pot channel + value:
if (Number.isInteger(m['channel']) && m['channel'] >= 0 && m['channel'] <= 11 &&
    typeof m['value'] === 'number'  && m['value']   >= 0 && m['value']   <= 1) { ... }

// outputVolume:
if (typeof m['volume'] === 'number' && m['volume'] >= 0 && m['volume'] <= 1) { ... }

// audioSource input:
if (['sine', 'live', 'wav'].includes(input as string)) { ... }
```

### Urgency Level
LOW

---

## Full-File `WorkspaceEdit.replace` on Wire/Unwire Produces Coarse Undo Granularity

### Description
The wire-pin and unwire-pin handlers in `extension.ts` replace the entire content of the effect `.cpp` file with a single `WorkspaceEdit`:

```typescript
const end = doc.lineAt(doc.lineCount - 1).range.end;
edit.replace(vscode.Uri.file(effectPath), new vscode.Range(new vscode.Position(0, 0), end), newText);
await vscode.workspace.applyEdit(edit);
```

This creates a single undo step that replaces the entire file, making undo/redo less granular than expected.

### Affected Files
- `src/extension.ts`

### Recommended Fix
Since the modified regions are bounded by known marker comments (`ds-ide:controls:begin…end` and `init:begin…end`), compute the line ranges for just those blocks and apply two targeted `edit.replace` calls covering only those regions. This gives users fine-grained undo that reverts only the inserted/removed declaration or init line.

### Urgency Level
LOW

---

## Multi-Workspace: Extension Always Uses First Folder with No User Feedback

### Description
Every code path that requires a workspace folder silently takes `workspaceFolders[0]`. In a multi-root workspace containing multiple Daisy effect projects, all commands operate on the first folder regardless of which project is active.

### Evidence

Representative instances:
- `src/extension.ts`, lines 87, 107, 272, 301, 401, 430, 455, 479 — all use `?.[0]`
- `src/commands/build.ts`, line 19: `folders[0]!.uri.fsPath`
- `src/commands/debug-deploy.ts`, line 37: `workspaceFolders?.[0]`

### Affected Files
- `src/extension.ts`
- `src/commands/build.ts`
- `src/commands/debug-deploy.ts`

### Recommended Fix
For v1 it is acceptable to use the first folder, but add a one-time info message when multiple workspace folders are detected: `"ds-ide: multiple workspace folders detected — operating on '${folders[0].name}'"`. For a future release, show a folder-picker quick-pick when multiple Daisy projects are present.

### Urgency Level
LOW

---

## `debugDeploy` Creates an Untracked `OutputChannel` When Called Without One

### Description
`debugDeploy()` creates a new `OutputChannel` if no `outputChannel` argument is provided, but the created channel is local to the function and never disposed.

### Evidence

`src/commands/debug-deploy.ts`, line 15:
```typescript
const channel = outputChannel ?? vscode.window.createOutputChannel('Daisy IDE Emulator');
```

If `outputChannel` is `undefined`, a fresh channel is created and its `Disposable` is never returned, registered with `context.subscriptions`, or cleaned up.

### Impact
In practice, `extension.ts` always passes `emulatorChannel`, so this path is never taken at runtime. However, if a future caller omits the argument (e.g., a test or a new command), output channels accumulate in the Output panel and are never closed.

### Affected Files
- `src/commands/debug-deploy.ts`

### Recommended Fix
Make `outputChannel` a required parameter since all current call sites already provide it:
```typescript
export async function debugDeploy(
  manager: EmulatorManager,
  loadDefs: () => ControllerDef[],
  showPanel: (...) => void,
  getPotSnapshot: () => Record<number, number>,
  sendSine?: () => void,
  outputChannel: vscode.OutputChannel,  // required
): Promise<void> {
```

### Urgency Level
LOW

---

## `activationEvents` Declaration Redundant with VS Code 1.74+ Automatic Inference

### Description
`package.json` declares two explicit activation events. Since VS Code 1.74.0, activation events for contributed commands, views, and debuggers are inferred automatically from the `contributes` section. With `"engines": { "vscode": "^1.85.0" }`, all 11 contributed commands, both webview views, and both debug types already generate implicit activation events. The explicit entries are therefore redundant and create a maintenance burden.

### Evidence

`package.json`, lines 28–31:
```json
"activationEvents": [
  "onDebugResolve:ds-ide",
  "onDebugAdapterProtocolTracker:ds-ide"
]
```

These are inferred from `contributes.debuggers` entries with types `ds-ide` and `daisy-debug` respectively.

### Affected Files
- `package.json`

### Recommended Fix
Remove the `activationEvents` field entirely and rely on VS Code 1.74+ automatic inference. If any activation event cannot be inferred (e.g., `onStartupFinished`), add only that specific entry back.

### Urgency Level
LOW

---

## `ScopePanel` Nonce Reused Across `webview.html` Rebuilds

### Description
`ScopePanel` generates its CSP nonce once in the constructor and stores it as a `readonly` field. When `show()` is called on an existing panel, `this.panel.webview.html = this.html()` replaces the page content using the same nonce. Per the CSP specification, nonces should be unique per page load.

### Evidence

`src/webview/scope-panel.ts`, line 61:
```typescript
private readonly nonce: string = randomBytes(16).toString('base64');
```

`show()`, line 97:
```typescript
this.panel.webview.html = this.html();
```

### Impact
Low practical risk in the VS Code webview sandbox, which is not accessible from external origins. However, a fixed nonce is weaker than a per-load nonce and departs from the security intent of CSP nonces. The controls webview (`controls-view-provider.ts`) and wiring webview (`wiring-view-provider.ts`) have the same pattern; in their case the HTML is only built once (`resolveWebviewView`), so the risk is lower.

### Affected Files
- `src/webview/scope-panel.ts`

### Recommended Fix
Generate a fresh nonce inside `html()` rather than in the constructor:
```typescript
private html(): string {
  const nonce = randomBytes(16).toString('base64');
  return buildHtml(nonce, this.sineParams, this.audioSource);
}
```

### Urgency Level
LOW

---

## Out of Scope

This review does NOT include:

* Actual marketplace publication
* User experience evaluation
* Visual design review
* Localization quality
* Third-party extension compatibility testing
* End-user workflow validation
* Benchmarking on large repositories
