# 04 — Architecture (v8)

> **v7 complete** — full v7 architecture in
> [`docs/v7/04_architecture.md`](v7/04_architecture.md).

## M28 — Extension Safety & Quality Hardening

All M28 changes are confined to existing modules. No new components, no new IPC message types, no data model changes. The notable internal API changes are:

### Webview CSP nonce (FR-ES-1)

`buildHtml()` functions in `scope-panel.ts`, `controls-view-provider.ts`, and `wiring-panel.ts` gain a `nonce: string` parameter. The nonce is generated at instantiation time (`crypto.randomBytes(16).toString('base64')`) and threaded into the HTML template. No structural change to the webview provider or panel classes beyond the function signature.

### Webview message validation (FR-ES-2)

Validation guards are added inline in `wiring-view-provider.ts` and `controls-view-provider.ts` `onDidReceiveMessage` handlers. No new helper module is introduced — the existing `parseControllerConfig` / `serializeControllerConfig` round-trip serves as the `editorSave` validator.

### `deployToEmulator` return type (FR-EQ-3)

`deployToEmulator` changes from `Promise<void>` to `Promise<boolean>`. All call sites in `extension.ts` (`ds-ide.deploy` command, `performBuildAndDeploy`) are updated to branch on the return value.

### OutputChannel ownership (FR-EQ-4)

Channels are created in `activate()` and passed as parameters to `buildForEmulator`, `deployToEmulator`, `debugDeploy`, and `buildForHardware`. Function signatures gain an `outputChannel: vscode.OutputChannel` parameter. Channels are added to `context.subscriptions`.

### Async activation path (FR-EQ-5)

`initViewsFromProject()` becomes an `async` function called as `void initViewsFromProject()` from `activate()`. File reads use `fs.promises.*`. The `onDidSaveTextDocument` handler becomes async; the early-exit path-check is moved before any I/O. `activate()` itself remains synchronous at the top level (returns `void`, not `Promise<void>`).

### ScopePanel listener lifecycle (FR-EQ-7)

`ScopePanel` stores the manager message handler as a named private method and calls `manager.off('message', this._onManagerMessage)` in `dispose()`.
