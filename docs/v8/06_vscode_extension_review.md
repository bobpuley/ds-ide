# 06 — VS Code Extension Review (v8)

> Generated: 2026-06-21. Covers `src/`, `package.json`, and `.vscode/`.

---

## Missing Content Security Policy in all three webviews

### Description
None of the three webviews (`ScopePanel`, `ControlsViewProvider`, `WiringViewProvider`) set a `Content-Security-Policy` meta tag in their HTML, and none use a nonce on their inline `<script>` blocks. VS Code's webview security model expects extensions to restrict what the webview can load. Without a CSP, the surface open to XSS via injected content is unrestricted.

### Evidence
- `src/webview/scope-panel.ts` lines 279–704: `buildHtml()` returns a full HTML page with an inline `<script>` block and no `<meta http-equiv="Content-Security-Policy" ...>` header.
- `src/sidebar/controls-view-provider.ts` line 102: `buildHtml()` returns a full HTML page with a large inline `<script>` block, no CSP meta tag, no nonce.
- `src/wiring/wiring-panel.ts` line 144: `buildHtml()` has the same omission.
- `view.webview.options = { enableScripts: true }` is set without restricting `localResourceRoots` (controls-view-provider.ts:29, wiring-view-provider.ts:24).
- `vscode.window.createWebviewPanel(…, { enableScripts: true, retainContextWhenHidden: true })` in scope-panel.ts:101 — same gap.

### Impact
A crafted IPC message from the emulator process that reaches `manager.on('message', …)` and gets forwarded to a webview via `postMessage` could inject malicious content that executes in the webview's privileged context. VS Code's marketplace review process will flag missing CSPs. The webview can also load unrestricted remote content if the inline scripts are ever augmented.

### Affected Files
- `src/webview/scope-panel.ts`
- `src/sidebar/controls-view-provider.ts`
- `src/wiring/wiring-panel.ts`

### Recommended Fix
1. Generate a random nonce per `resolveWebviewView` / `show()` call using `crypto.randomBytes(16).toString('base64')`.
2. Add a `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-NONCE'; style-src 'unsafe-inline';">` tag to each HTML template (inline styles are used extensively; `style-src 'unsafe-inline'` is acceptable; inline scripts must use the nonce).
3. Add the nonce attribute to each `<script>` tag: `<script nonce="${nonce}">`.
4. Set `localResourceRoots: []` in webview options since no local resources are loaded.

### Urgency Level
HIGH

---

## Unvalidated incoming webview messages used as workspace-modifying operations

### Description
Messages received from the webview via `onDidReceiveMessage` are cast directly to their expected types without validating the numeric or string ranges of their fields before invoking side-effecting operations on the workspace or the emulator. In particular, the `wirePin` and `unwirePin` commands in the wiring view trigger `WorkspaceEdit` operations on user source code without checking that `pinNumber`, `deviceType`, or `id` conform to expected types/ranges.

### Evidence
`src/sidebar/wiring-view-provider.ts` lines 30–38:
```typescript
if (m['command'] === 'wirePin') {
  await this.onWirePin({
    pinNumber:  m['pinNumber']  as number,
    deviceType: m['deviceType'] as WiredPin['deviceType'],
    id:         m['id']         as string,
  });
}
```
`m['pinNumber']` and `m['id']` are cast with `as`, not validated. A crafted webview message with `id: "../../etc/passwd"` or an empty string would be forwarded into `insertIntoSource` which writes the id verbatim as a C++ identifier into the user's source file.

`src/sidebar/controls-view-provider.ts` lines 39–48: The `editorSave` handler casts `m['cfg'] as ControllerConfig` and passes it directly to `onEditorSave`, which calls `serializeControllerConfig` and writes to `controllers.yaml`. No field validation is done in the view provider.

`src/extension.ts` lines 120, 123: `insertIntoSource` and `insertInitIntoSource` receive the id directly from the webview message without a C++ identifier validity check.

### Impact
While webviews run in a restricted context and cannot contact external origins, a logic bug or future injection elsewhere could cause the extension to write malformed content or path-traversal strings into user source files. The `id` field is embedded in generated C++ source code as a variable name; an id containing characters like spaces, semicolons, or `*/` could produce broken or dangerous C++ output.

### Affected Files
- `src/sidebar/wiring-view-provider.ts`
- `src/sidebar/controls-view-provider.ts`
- `src/extension.ts`
- `src/wiring/controls-writer.ts`

### Recommended Fix
In `wiring-view-provider.ts`, validate before dispatching:
```typescript
const pinNumber = m['pinNumber'];
const deviceType = m['deviceType'];
const id = m['id'];
if (typeof pinNumber !== 'number' || !Number.isInteger(pinNumber) || pinNumber < 0 || pinNumber > 31) return;
if (deviceType !== 'pot' && deviceType !== 'button' && deviceType !== 'led') return;
if (typeof id !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(id)) return;
```
Apply the same pattern in `controls-view-provider.ts` before calling `onEditorSave`.

### Urgency Level
HIGH

---

## New output channel created on every build and deploy invocation

### Description
`buildForEmulator` creates a new `OutputChannel` named `'Daisy IDE Build'` every time it is invoked. `deployToEmulator` creates a new `OutputChannel` named `'Daisy IDE Emulator'` every time it is called, and `debugDeploy` in `debug-deploy.ts` also creates its own `'Daisy IDE Emulator'` channel independently. `buildForHardware` similarly creates `'Daisy IDE Hardware Build'` on every call. None of these channels are disposed or reused.

### Evidence
- `src/commands/build.ts` line 34: `const channel = vscode.window.createOutputChannel('Daisy IDE Build');`
- `src/commands/deploy.ts` line 5: `const channel = vscode.window.createOutputChannel('Daisy IDE Emulator');`
- `src/commands/debug-deploy.ts` line 14: `const channel = vscode.window.createOutputChannel('Daisy IDE Emulator');`
- `src/commands/hardware-build.ts` line 38: `const channel = vscode.window.createOutputChannel('Daisy IDE Hardware Build');`
- None of these channels are added to `context.subscriptions` or have `.dispose()` called.

### Impact
Each build or deploy invocation leaks an `OutputChannel` object that is never freed. In a normal development session with repeated builds, this accumulates output channel instances in the VS Code Output panel dropdown (visible as duplicate channel names). Over time this is a memory leak on the extension host process.

### Affected Files
- `src/commands/build.ts`
- `src/commands/deploy.ts`
- `src/commands/debug-deploy.ts`
- `src/commands/hardware-build.ts`

### Recommended Fix
Create channels once during `activate()` and pass them as parameters, or create-and-cache them as module-level singletons with `getOrCreate` logic. At minimum, dispose each channel when the command completes, or reuse a single channel per category (clear it at the start of each new invocation with `channel.clear()`):
```typescript
let buildChannel: vscode.OutputChannel | undefined;
function getBuildChannel(): vscode.OutputChannel {
  if (!buildChannel) buildChannel = vscode.window.createOutputChannel('Daisy IDE Build');
  return buildChannel;
}
// Push to context.subscriptions.push({ dispose: () => buildChannel?.dispose() });
```

### Urgency Level
MEDIUM

---

## Synchronous `fs` calls on the extension host during activation and command execution

### Description
The `activate()` function and several code paths called during command execution use synchronous Node.js `fs` APIs (`fs.readFileSync`, `fs.readdirSync`, `fs.existsSync`, `fs.statSync`, `fs.writeFileSync`) on the extension host thread. These block the entire VS Code extension host while the filesystem is accessed.

### Evidence
- `src/extension.ts` line 39: `for (const entry of fs.readdirSync(folder))` — called inside `findEffectSource`, which is called from `activate()` via `initViewsFromProject()` (line 319) and from `onDidSaveTextDocument`.
- `src/extension.ts` lines 54, 311, 377: `fs.readFileSync(effectPath, 'utf8')` — blocking reads of the user's source file during activation and on every save event.
- `src/extension.ts` lines 94–98: `fs.writeFileSync(yamlPath, …)` — synchronous write inside the `onEditorSave` callback (called from webview message handler).
- `src/extension.ts` lines 490–498: `loadControllerConfig()` uses `fs.readFileSync` and is called multiple times during activation.
- `src/commands/build.ts` lines 71, 96: `fs.readdirSync`, `fs.statSync` in `detectEffectSrc` and `detectDaisySP`.

### Impact
Any of these calls on a slow or network-mounted filesystem will freeze the extension host. The `activate()` path is particularly dangerous: if `findEffectSource` or `loadControllerConfig` block for several seconds, VS Code may report "Extension Host Unresponsive". This is also flagged during marketplace review.

### Affected Files
- `src/extension.ts`
- `src/commands/build.ts`
- `src/commands/dfu-flash.ts`

### Recommended Fix
Replace synchronous `fs` calls with `fs.promises` equivalents (or VS Code's `vscode.workspace.fs` for workspace files). In `activate()`, defer the `initViewsFromProject()` call asynchronously so activation itself returns synchronously:
```typescript
// In activate():
void initViewsFromProject(); // fire-and-forget; async internally
```
Replace `fs.readFileSync` / `fs.readdirSync` / `fs.writeFileSync` with their async counterparts in all hot paths. For the `onDidSaveTextDocument` handler, the callback is already called off the critical path, but the synchronous read inside it should still be made async.

### Urgency Level
MEDIUM

---

## `debug` event listeners not added to `context.subscriptions`

### Description
Two `vscode.debug.onDidStartDebugSession` and `vscode.debug.onDidTerminateDebugSession` event subscriptions are created in `activate()` but the resulting `Disposable` objects are not pushed to `context.subscriptions`. They will not be cleaned up when the extension is deactivated.

### Evidence
`src/extension.ts` lines 257–268:
```typescript
vscode.debug.onDidStartDebugSession((session) => {
  if (session.type === DAISY_DEBUG_TYPE) {
    statusBar.text = '$(bug) Daisy: debugging';
    ...
  }
});
vscode.debug.onDidTerminateDebugSession((session) => {
  ...
});
```
Neither return value is stored or pushed to `context.subscriptions`.

### Impact
These listeners leak on extension deactivation and reload. In practice VS Code disposes all listeners when the extension host is shut down, but during a manual deactivation/reactivation cycle (e.g., after a workspace folder change) the listeners accumulate.

### Affected Files
- `src/extension.ts`

### Recommended Fix
```typescript
context.subscriptions.push(
  vscode.debug.onDidStartDebugSession((session) => { … }),
  vscode.debug.onDidTerminateDebugSession((session) => { … }),
);
```

### Urgency Level
MEDIUM

---

## `ScopePanel` registers a `manager.on('message')` listener that is never removed

### Description
`ScopePanel`'s constructor (line 72 in `scope-panel.ts`) registers a listener on `manager.on('message', …)`. The `EmulatorManager` is a Node.js `EventEmitter`. This listener is never removed: `ScopePanel.dispose()` does not call `manager.off(…)` or `manager.removeAllListeners(…)`. The same pattern appears for the `ScopePanel` to receive `IpcClient` events via the manager chain.

### Evidence
`src/webview/scope-panel.ts` lines 72–81:
```typescript
manager.on('message', (msg: IpcMessage) => {
  if (msg['type'] === 'scope') this.postScope(msg);
  ...
});
```
`src/webview/scope-panel.ts` lines 162–167: `dispose()` disposes `msgDisposable` and the panel, but does not remove the listener on `manager`.

### Impact
After `ScopePanel.dispose()` is called, the anonymous arrow function still holds a reference to `this` (the disposed ScopePanel) via closure. Each re-deploy or extension reload that recreates the ScopePanel will add another listener to the manager's EventEmitter. Node.js will emit a `MaxListenersExceededWarning` after 10 listeners accumulate. The dangling references to the disposed panel also prevent garbage collection.

### Affected Files
- `src/webview/scope-panel.ts`

### Recommended Fix
Store the listener function and remove it on dispose:
```typescript
private readonly _onManagerMessage = (msg: IpcMessage) => {
  if (msg['type'] === 'scope') this.postScope(msg);
  // … rest of handler
};

constructor(…) {
  manager.on('message', this._onManagerMessage);
}

dispose(): void {
  this.manager.off('message', this._onManagerMessage);
  this.msgDisposable?.dispose();
  this.panel?.dispose();
}
```

### Urgency Level
MEDIUM

---

## `onDidSaveTextDocument` listener performs synchronous source file reads

### Description
The `onDidSaveTextDocument` listener registered in `context.subscriptions` calls `loadControllerConfig()` (which uses `fs.readFileSync`) and `findEffectSource()` (which uses `fs.readdirSync` and `fs.existsSync`), and then reads the effect source file with `fs.readFileSync`. All of these run synchronously on every save event for every document in the workspace.

### Evidence
`src/extension.ts` lines 361–383:
```typescript
vscode.workspace.onDidSaveTextDocument((doc) => {
  const folder = folders[0].uri.fsPath;
  const effectPath = findEffectSource(folder);     // calls fs.readdirSync
  const yamlPath = path.join(folder, 'controllers.yaml');
  ...
  const cfg = loadControllerConfig();              // calls fs.readFileSync
  ...
  const text = fs.readFileSync(effectPath!, 'utf8'); // synchronous
  ...
})
```
This fires for every saved document, not only for the effect source or YAML — the filtering on lines 369–370 happens after the filesystem reads in `findEffectSource()`.

### Impact
Every file save in the workspace (including unrelated files like CSS, JSON configs, etc.) triggers a synchronous directory listing and file read. On a large project this is a perceptible freeze. The correct pattern is to check whether the saved document matches the target files before doing any filesystem work.

### Affected Files
- `src/extension.ts`

### Recommended Fix
Reorder the handler to check the saved file path first, before touching the filesystem:
```typescript
vscode.workspace.onDidSaveTextDocument(async (doc) => {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.[0]) return;
  const folder = folders[0].uri.fsPath;
  const saved = doc.uri.fsPath;
  const yamlPath = path.join(folder, 'controllers.yaml');
  const isYaml = saved === yamlPath;
  // Only do the expensive work when the relevant files are saved
  const effectPath = await findEffectSourceAsync(folder);
  const isSource = !!effectPath && saved === effectPath;
  if (!isSource && !isYaml) return;
  // … async reads follow
})
```

### Urgency Level
MEDIUM

---

## `WiringPanel` class (in `wiring-panel.ts`) is orphaned — never used or disposed

### Description
`src/wiring/wiring-panel.ts` exports a `WiringPanel` class that creates a `WebviewPanel` (a separate editor tab). The extension was refactored to use `WiringViewProvider` (a sidebar WebviewView) instead, but the old `WiringPanel` class was left in the file. It is never instantiated anywhere in the codebase. Its `msgDisposable` and `panel` fields create disposables that are only cleaned up when `dispose()` is called — but no caller ever holds an instance to call dispose on.

### Evidence
`src/wiring/wiring-panel.ts` lines 80–136: Full `WiringPanel` class definition.
`src/sidebar/wiring-view-provider.ts` line 2: imports only `WiredPin`, `WirePinHandler`, `UnwirePinHandler`, `buildHtml` — not `WiringPanel`.
No `import { WiringPanel }` appears anywhere under `src/`.

### Impact
Dead code increases bundle size (though the impact is small with tree-shaking via esbuild) and creates maintenance confusion. Developers reading the file may not realize which class is actually in use.

### Affected Files
- `src/wiring/wiring-panel.ts`

### Recommended Fix
Remove the `WiringPanel` class (lines 80–136) from `wiring-panel.ts`. The file should only export the types, `PIN_DEFS`, and the `buildHtml` function that are actually used by `WiringViewProvider`.

### Urgency Level
LOW

---

## `deactivate()` disposes resources already disposed by `context.subscriptions`

### Description
The `deactivate()` function calls `manager?.dispose()` and `scopePanel?.dispose()`. However, both of these are also disposed inside the `context.subscriptions.push(…, { dispose: () => { manager?.dispose(); scopePanel?.dispose(); } })` entry at line 476. VS Code calls both the subscription disposables and `deactivate()` on shutdown, so `dispose()` is called twice on each object.

### Evidence
`src/extension.ts` line 476: `{ dispose: () => { manager?.dispose(); scopePanel?.dispose(); } }` — pushed to subscriptions.
`src/extension.ts` lines 480–483:
```typescript
export function deactivate(): void {
  manager?.dispose();
  scopePanel?.dispose();
}
```

### Impact
`EmulatorManager.dispose()` calls `this.killExisting()`, which sends `SIGKILL` to the child process and disconnects the IPC client. Calling it twice is functionally safe (the null-guards protect against it), but it creates confusion and is a maintenance hazard if dispose ever acquires non-idempotent side effects.

### Affected Files
- `src/extension.ts`

### Recommended Fix
Remove the inline `{ dispose: () => … }` from `context.subscriptions` (line 476) and rely solely on `deactivate()`, or conversely push them to subscriptions and make `deactivate()` a no-op. The subscriptions approach is preferred as it also handles extension host crashes.

### Urgency Level
LOW

---

## `package.json` lacks `icon`, `repository`, `keywords`, and `homepage` fields

### Description
The `package.json` is missing several fields required or strongly recommended for VS Code Marketplace publication.

### Evidence
`/Users/marcopugliese/workspaces/daisy/ds-ide/package.json`:
- `"icon"` field: absent. The Marketplace requires a 128×128 PNG icon.
- `"repository"` field: absent. Required for marketplace listing trust indicators.
- `"keywords"` field: absent. Affects discoverability in Marketplace search.
- `"homepage"` field: absent (optional but recommended).
- `"categories"`: only `["Other"]`, which is the least specific category. Consider `"Debuggers"` or `"Programming Languages"`.
- `"version": "0.0.1"`: appropriate for pre-release but should be bumped before publishing.
- `"publisher": "daisy-ide"`: must match a registered Marketplace publisher account before `vsce package` will succeed for publication.

### Impact
Attempting to publish to the VS Code Marketplace with the current `package.json` will fail validation (icon missing) or produce a low-quality listing (missing keywords, repository, categories). `vsce package` will succeed locally (it only warns), but marketplace submission will fail.

### Affected Files
- `package.json`

### Recommended Fix
Add the following fields:
```jsonc
"icon": "media/icon.png",         // 128×128 PNG
"repository": {
  "type": "git",
  "url": "https://github.com/<org>/ds-ide"
},
"keywords": ["daisy", "audio", "embedded", "emulator", "debugger"],
"homepage": "https://github.com/<org>/ds-ide#readme",
"categories": ["Debuggers", "Other"]
```

### Urgency Level
LOW

---

## `retainContextWhenHidden: true` on both sidebar webviews increases memory footprint

### Description
Both `ControlsViewProvider` and `WiringViewProvider` are registered with `{ webviewOptions: { retainContextWhenHidden: true } }`. This tells VS Code to keep the webview's JavaScript process alive even when the view panel is hidden, which prevents the JS state from being lost but consumes significantly more memory.

### Evidence
`src/extension.ts` lines 359–360:
```typescript
vscode.window.registerWebviewViewProvider(CONTROLS_VIEW_ID, controlsViewProvider, { webviewOptions: { retainContextWhenHidden: true } }),
vscode.window.registerWebviewViewProvider(WIRING_VIEW_ID,   wiringViewProvider,   { webviewOptions: { retainContextWhenHidden: true } }),
```

### Impact
Each retained webview holds a separate renderer process with its full JavaScript heap. For a sidebar extension that is frequently minimized, this is an avoidable persistent memory cost. The extension already implements a pending-state flush mechanism (`_flush()` in `ControlsViewProvider`) that rehydrates the view from extension-side state when it becomes visible — this makes `retainContextWhenHidden` unnecessary for the controls view. The wiring view also re-sends state via `postWiredPins` on visibility change.

### Affected Files
- `src/extension.ts`

### Recommended Fix
Remove `retainContextWhenHidden: true` from both registrations (or set it to `false`). The existing `_flush()` and `postWiredPins` rehydration logic already handles the re-show case. Test that controls and knob positions are correctly restored when the panel is re-expanded after being hidden.

### Urgency Level
LOW

---

## Language Server Review

Not applicable. The extension does not implement or depend on a Language Server Protocol client or server.

---

## Multi-Workspace Support

The extension consistently accesses only `vscode.workspace.workspaceFolders?.[0]` throughout the codebase. This is intentional for a single-project audio effect IDE, and the pattern is applied consistently (not accidentally). It is not a bug, but it should be documented in `package.json` with `"capabilities": { "untrustedWorkspaces": … }` and a note in the README that multi-root workspaces are not supported.

No multi-workspace safety issues found beyond the above documentation gap.

---

## Webview HTML injection of user-controlled values — scope-panel.ts

### Description
The `buildEmulatorBarHtml` function in `scope-panel.ts` inlines the `wavName` string directly into the HTML output using `escHtml(wavName)`. This is correctly escaped. However, the `sine.freq` and `sine.amplitude` values (numbers coming from `workspaceState`) are inlined without sanitization:

```typescript
value="${sine.freq}"
value="${sine.amplitude.toFixed(2)}"
```

Since these values are numbers from `workspaceState` (typed as `SineParams`), and the parser validates them as `number`, the risk is low in practice. However, the pattern is dangerous if types are ever weakened: a stored non-numeric value (e.g., from a manually edited workspaceState or a future refactor) could inject attribute content.

### Evidence
`src/webview/scope-panel.ts` lines 245–246:
```typescript
<input type="number" id="sine-freq" min="20" max="20000" step="1" value="${sine.freq}"/>
<input type="range" id="sine-amp" min="0" max="1" step="0.01" value="${sine.amplitude}"/>
```

### Impact
Low practical risk given TypeScript type enforcement, but represents an unsafe pattern that should be addressed when the CSP nonce is added (see finding 1).

### Affected Files
- `src/webview/scope-panel.ts`

### Recommended Fix
Coerce numeric values before interpolation:
```typescript
value="${Number(sine.freq) || SINE_DEFAULTS.freq}"
value="${Number(sine.amplitude) || SINE_DEFAULTS.amplitude}"
```
This is also a good defense for the `bufferSize`, `sampleRate`, and `wavLoop` values in the same function.

### Urgency Level
LOW
