# 01 — Input Ideas (v8)

> **v1 complete** — ds-ide 0.1.0–0.1.7 (M0–M7), all ACs green. Full v1 ideas archived in
> [`docs/v1/01_input-ideas.md`](v1/01_input-ideas.md).
>
> **v2 complete** — ds-ide 0.2.0–0.2.9 (M8–M15), all ACs green. Full v2 ideas archived in
> [`docs/v2/01_input-ideas.md`](v2/01_input-ideas.md).
>
> **v3 complete** — ds-ide 0.3.0–0.3.3 (M16–M18), all ACs green. Full v3 ideas archived in
> [`docs/v3/01_input-ideas.md`](v3/01_input-ideas.md).
>
> **v4 complete** — ds-ide 0.4.0–0.4.3 (M19–M22), all ACs green. Full v4 ideas archived in
> [`docs/v4/01_input-ideas.md`](v4/01_input-ideas.md).
>
> **v5 complete** — ds-ide 0.5.0–0.5.1 (M23–M24), all ACs green. Full v5 ideas archived in
> [`docs/v5/01_input-ideas.md`](v5/01_input-ideas.md).
>
> **v6 complete** — archived to `docs/v6/` on 2026-06-21. This file now seeds v7 planning.
>
> **v7 complete** — archived to `docs/v7/` on 2026-06-21. This file now seeds v8 planning.

## Extension Safety & Quality Hardening (2026-06-21, from `06_nodejs_review.md` + `06_vscode_extension_review.md`)

Code review of the VS Code extension layer surfaced the following bugs and quality gaps:

**Security / HIGH:**
- **Webviews missing CSP + nonce.** All three webviews (ScopePanel, ControlsViewProvider, WiringViewProvider) generate HTML with inline `<script>` blocks and no `Content-Security-Policy` meta tag or nonce. VS Code marketplace review will flag this; a compromised webview can call `acquireVsCodeApi()` and post messages to the extension host.
- **Unvalidated webview messages trigger workspace writes.** `wirePin` / `unwirePin` / `editorSave` messages cast incoming fields with `as` and act on them immediately: `id` is written verbatim as a C++ identifier into user source; a crafted `cfg` is written to `controllers.yaml` without re-validation.

**Runtime correctness / MEDIUM:**
- **IPC buffer unbounded growth.** `IpcClient.onData` appends data to `this.partial` indefinitely; a runaway emulator with no newlines leaks memory until VS Code becomes unresponsive.
- **Deploy re-entrancy race.** `EmulatorManager.deploy()` has no re-entrancy guard; two rapid calls leave orphaned `effect_emu` processes sharing the same socket path.
- **`deployToEmulator` swallows errors.** Returns `Promise<void>`; callers unconditionally send post-deploy IPC messages even after a failed deploy, leaving the status bar stuck on "deploying…".
- **OutputChannel leak per invocation.** Build, deploy, debug-deploy, and hardware-build each call `createOutputChannel(...)` with a fixed name on every invocation; the Output dropdown fills with duplicate entries over a session.
- **Sync `fs` in `activate()` and `onDidSaveTextDocument`.** `findEffectSource`, `loadControllerConfig`, and `initViewsFromProject` use blocking `fs.readFileSync` / `readdirSync` on the extension host thread; freezes VS Code on slow filesystems. `onDidSaveTextDocument` reads the filesystem before filtering to the relevant file.
- **Debug event listener disposables not tracked.** `onDidStartDebugSession` / `onDidTerminateDebugSession` return values are discarded, leaking listeners on extension reload.
- **`ScopePanel` manager listener never removed.** `manager.on('message', …)` listener is not removed in `dispose()`; accumulates across redeploys and triggers `MaxListenersExceededWarning`.
- **`controls-writer` ID validation gap.** The host side of `wirePin` does not validate `id` against a C++ identifier pattern before passing it into source-file mutation functions.

**Low-severity quality / LOW (12 items):**
- `safeJson` incomplete XSS escape (`</` only; should escape `<`, `>`, `&` as Unicode sequences).
- `parseBuildLine` regex silently drops all diagnostics on Windows drive-letter paths.
- `detectEffectSrc` misses `src/` and `source/` subdirectory layouts; error message is uninformative.
- Dead `WiringPanel` class in `wiring-panel.ts` (superseded by `WiringViewProvider`, never instantiated).
- `deactivate()` double-disposes `manager` and `scopePanel` (also in `context.subscriptions`).
- `package.json` missing `icon`, `repository`, `keywords`, `homepage`; `categories` uses only `"Other"`.
- `retainContextWhenHidden: true` on both sidebar webviews is unnecessary — rehydration logic already handles re-show.
- Module-level singletons in `extension.ts` accessed via `!` non-null assertions throughout.
- `extension.test.ts` module-level state not reset between tests; hardcoded subscription count `toBe(21)`.
- `localResourceRoots` not set to `[]` on WebviewPanels that load no file resources.
- Numeric values (`freq`, `amplitude`, etc.) inlined unsanitised into HTML attributes in `scope-panel.ts`.
- Missing `controls-writer.ts` edge-case tests: absent init block, partial removal, duplicate ID.
