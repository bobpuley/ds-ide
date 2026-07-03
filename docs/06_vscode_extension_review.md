# Review Report

VS Code extension review of `src/` and `.vscode/` (ds-ide v11 baseline, reviewed 2026-07-02).
Scope: extension architecture, Extension Host performance, commands, webviews, debug adapters, workspace safety, configuration, and marketplace readiness.

> **v10 review archived** — [`docs/v10/06_vscode_extension_review.md`](v10/06_vscode_extension_review.md).

---

## Packaged .vsix cannot build for the emulator — `emulator/**` is excluded from the package

### Description
`buildForEmulator` resolves the emulator CMake project from the installed extension's own directory (`path.join(extensionPath, 'emulator')`) and passes it to `cmake -S`. However, `.vscodeignore` explicitly excludes `emulator/**` from the package, and the esbuild pipeline only emits JS bundles into `dist/`. Nothing copies the emulator sources into the packaged artifact. The extension works only in the extension-development-host (where `extensionPath` is the repo checkout) and will fail its core command the moment it is installed from a `.vsix`.

### Evidence
- `src/commands/build.ts:32` — `const emulatorSrc = path.join(extensionPath, 'emulator');`
- `src/emulator/manager.ts:78-88` — `cmake -S <emulatorSrc> -B <buildDir> -DEFFECT_SRC=...`
- `.vscodeignore` — contains the line `emulator/**` (and `!dist/**` is the only un-ignore); `esbuild.js` has no copy step for `emulator/`.
- Additionally `package.json:15` declares `"icon": "images/icon.png"` but no `images/` directory exists in the repo, so `vsce package` (the `package` npm script) fails before even producing the broken package.

### Impact
Every user installing the published/packaged extension gets an unusable product: "Build for Emulator", "Build & Deploy", and F5 debugging all fail with a CMake "source directory does not exist" error. This is a total failure of the core workflow that no unit test catches (tests run against the repo layout).

### Affected Files
- .vscodeignore
- src/commands/build.ts
- esbuild.js
- package.json

### Recommended Fix
1. Remove `emulator/**` from `.vscodeignore` (or add `!emulator/**` after broader ignores), keeping only build outputs (`emulator/**/build/**`) excluded.
2. Add a packaging smoke test: run `vsce ls` (or unzip the produced `.vsix`) in CI and assert `emulator/CMakeLists.txt` and `dist/extension.js` are present.
3. Either add `images/icon.png` or remove/repoint the `icon` field so `vsce package` succeeds.

### Urgency Level
HIGH

---

## Wiring Editor generates ADC init code that only compiles against the emulator shim, not real libDaisy

### Description
The Wiring Editor writes an init block into the user's `.cpp` containing `hardware.adc.Init(pot1, pot2, ..., N);` — passing each `AdcChannelConfig` **by value as separate variadic arguments**. Real libDaisy's `AdcHandle::Init` signature is `Init(AdcChannelConfig* cfg, size_t num_channels, ...)` (pointer to an array), as confirmed by the official docs corpus (`hw.adc.Init(&adc_config, 1)` / `hw.adc.Init(my_adc_config, NUM_ADC_CHANNELS)`). The emulator shim papers over this with a catch-all `template<typename... Args> void Init(Args...)` overload added specifically for the generated code (comment "used by generated init blocks (D23)"). The result: source that builds and runs in the emulator fails to compile in "Build for Hardware".

### Evidence
- `src/wiring/controls-writer.ts:69-72`:
  ```ts
  function adcInitLine(pots: Array<{ id: string }>): string {
    const args = pots.map(p => p.id).join(', ');
    return `  hardware.adc.Init(${args}, ${pots.length});`;
  }
  ```
- `emulator/shim/include/daisy/adc_handle.h:26-27` — variadic `Init(Args...)` that "ignores all parameters", i.e. shim-only API surface.
- `daisy-seed-knowledge/doc/md/_a4_Getting-Started-ADCs.md:87,186` — official pattern is `hw.adc.Init(&adc_config, 1)` / array form; no variadic overload exists in libDaisy.

### Impact
The extension silently writes non-portable code into the user's source file, breaking the product's core promise (emulator ↔ hardware parity). Any project with at least one wired pot fails `ds-ide.buildHardware` with confusing template/overload errors in libDaisy headers, and the user must hand-edit generated blocks that the tool then rewrites on the next wiring change.

### Affected Files
- src/wiring/controls-writer.ts
- emulator/shim/include/daisy/adc_handle.h

### Recommended Fix
Generate the canonical libDaisy pattern instead: declare `AdcChannelConfig ds_ide_adc_cfg[N];`, emit `ds_ide_adc_cfg[i].InitSingle(daisy::seed::Ax);` per pot, and `hardware.adc.Init(ds_ide_adc_cfg, N);`. Remove the variadic shim overload so emulator and hardware compile the same code path (drift like this is exactly what the shim should not hide).

### Urgency Level
HIGH

---

## Stale-process cleanup can SIGKILL an unrelated process (PID-reuse) and deletes other windows' live IPC sockets

### Description
Two destructive cleanup mechanisms operate on ambient system state without ownership checks:
1. `killStalePid` reads `.ds-ide/build/emu.pid` and sends `SIGKILL` to that PID. The pid file survives reboots and crashes; after PID reuse the extension kills whatever process currently holds that number — with SIGKILL, no confirmation, no name check.
2. On activation, the extension deletes **every** `/tmp/daisy_emu_*.sock` file. Socket names are per-process (`daisy_emu_${Date.now()}.sock`), so a second VS Code window activating the extension unlinks the socket of an emulator that another window is actively using (and of any other user session on the machine).

### Evidence
- `src/emulator/manager.ts:14-29` — `process.kill(pid, 'SIGKILL')` on a PID parsed from a file, with no verification that the process is an `effect_emu` instance (e.g. via a `ps` command-name check or process start-time comparison).
- `src/extension.ts:110-116` — unconditional sweep: `fs.promises.readdir('/tmp')` → unlink all `daisy_emu_*.sock` on every activation.
- `/tmp` is also hardcoded (here and in `manager.ts:99`), not `os.tmpdir()` — broken on Windows and non-standard tmp setups, contradicting the project's "cross-platform where practical" stance.

### Impact
Worst case the extension force-kills an arbitrary user process (a build, a database, another IDE) after a reboot. The socket sweep reliably breaks the emulator connection in concurrent multi-window use — the second window's activation severs or orphans the first window's session. Both failures look like random emulator crashes to the user.

### Affected Files
- src/emulator/manager.ts
- src/extension.ts

### Recommended Fix
1. Before SIGKILL, verify process identity: read the process name/command line for the PID (e.g. `ps -p <pid> -o comm=`) and only kill if it matches `effect_emu`; prefer SIGTERM with a SIGKILL fallback.
2. Scope socket cleanup to sockets this workspace owns: store the socket path in `.ds-ide/build/` next to `emu.pid` and delete only that file; never sweep the shared temp directory.
3. Use `os.tmpdir()` instead of hardcoded `/tmp`, or better, place sockets under the workspace `.ds-ide/` or `context.storageUri`.

### Urgency Level
HIGH

---

## Unvalidated emulator IPC data is forwarded wholesale to webviews and reaches an `innerHTML` sink

### Description
Messages from the emulator socket are parsed with `JSON.parse` and forwarded to webviews largely unvalidated. `ScopePanel.postStatus` and `ControlsViewProvider.postStatus/_flush` spread the entire untrusted message (`{ command: 'status', ...msg }`) into `postMessage`. In the scope webview, `msg.sampleRate` and `msg.blockSize` are interpolated into `statusEl.innerHTML` without type-checking or escaping — a string value injects markup into the panel. Separately, `scope-webview.ts` calls `msg.kind.toUpperCase()` on an unvalidated field (crashes the webview script on a malformed event), and `msg.gpioPin` is interpolated into a `querySelectorAll` selector.

### Evidence
- `src/webview/scope-panel.ts:194-196` — `postMessage({ command: 'status', ...msg })` (untrusted spread).
- `src/sidebar/controls-editor-panel.ts:80-82,85-88` — same pattern.
- `src/webview/scope-webview.ts:38-40` — `statusEl.innerHTML = '<span ...>' + ... + lastStatusSampleRate + ...` where `lastStatusSampleRate = msg.sampleRate || ...` (line 217) is never checked to be a number.
- `src/webview/scope-webview.ts:241` — `activeEvents.add(msg.kind.toUpperCase())` with no `typeof` guard.
- Mitigations already present: strict CSP with nonce (`default-src 'none'; script-src 'nonce-…'`), `localResourceRoots` limited to `dist/`, and good inbound (webview→extension) validation. The gap is the extension→webview direction fed by the external emulator process.

### Impact
The IPC endpoint is a same-user Unix socket to a separately spawned native process; if that process is compromised, buggy, or impersonated, it can inject arbitrary HTML into the scope panel (script execution is blocked by CSP, but markup/CSS injection and UI spoofing are not) or crash the webview scripts. Defense-in-depth for webviews requires treating IPC data as untrusted.

### Affected Files
- src/webview/scope-panel.ts
- src/sidebar/controls-editor-panel.ts
- src/webview/scope-webview.ts
- src/emulator/ipc-client.ts

### Recommended Fix
1. Narrow every IPC field at the extension boundary (the `src/ipc/narrow.ts` helpers exist — use them for `sampleRate`, `blockSize`, `kind`, `gpioPin`, `count`, `measuredMs`, arrays) and forward only whitelisted, typed fields instead of `...msg`.
2. In webviews, never build `innerHTML` from message data — set `textContent` on pre-built elements (the status line needs no HTML).
3. Guard `msg.kind` with `typeof msg.kind === 'string'` before `.toUpperCase()`.

### Urgency Level
MEDIUM

---

## Unhandled promise rejection on every failed deploy

### Description
`EmulatorManager.deploy` clears its coalescing lock with `deployPromise.finally(() => { this.deployLock = null; })`. `.finally()` returns a **new** promise that rejects whenever `deployPromise` rejects, and that derived promise is never awaited or caught. The caller handles the original `deployPromise`, but the derived one triggers an `unhandledRejection` in the Extension Host on every deploy failure (emulator missing, socket timeout, spawn error).

### Evidence
- `src/emulator/manager.ts:162-164`:
  ```ts
  this.deployLock = deployPromise;
  deployPromise.finally(() => { this.deployLock = null; });
  return deployPromise;
  ```

### Impact
Unhandled rejections are logged as errors in the Extension Host, can surface "extension caused an error" reports, and in stricter Node configurations can terminate the host process. Deploy failures are an expected, common path (first run without build, emulator crash), so this fires regularly.

### Affected Files
- src/emulator/manager.ts

### Recommended Fix
Attach a no-op catch to the derived promise: `deployPromise.finally(() => { this.deployLock = null; }).catch(() => {});` — or clear the lock inside the existing `.then`/`.catch` chain before returning.

### Urgency Level
MEDIUM

---

## OutputChannel leak: a new "Daisy IDE Flash" channel is created on every flash command

### Description
`flashToHardware` calls `vscode.window.createOutputChannel('Daisy IDE Flash')` on each invocation and never disposes it. VS Code does not deduplicate channels by name — each call adds another entry to the Output panel dropdown for the lifetime of the window. `buildForHardware` has the same latent issue in its fallback branch (`outputChannel ?? createOutputChannel(...)`), though the extension currently always passes a channel.

### Evidence
- `src/commands/dfu-flash.ts:47` — `const channel = vscode.window.createOutputChannel('Daisy IDE Flash');` inside the command handler; no `dispose()`, not added to `context.subscriptions`.
- `src/commands/hardware-build.ts:31` — fallback `createOutputChannel` per call.
- Contrast: `src/extension.ts:127-129` correctly creates the build/emulator/hardware channels once and registers them in `context.subscriptions`.

### Impact
Repeated flashing accumulates orphan channels (memory plus UI clutter in the Output panel), a slow leak affecting long-lived windows.

### Affected Files
- src/commands/dfu-flash.ts
- src/commands/hardware-build.ts
- src/extension.ts

### Recommended Fix
Create a single "Daisy IDE Flash" channel in `activate()`, register it in `context.subscriptions`, and pass it into `flashToHardware` the same way `hardwareChannel` is passed to `buildForHardware`. Remove the per-call fallback in `buildForHardware` (make the channel parameter required).

### Urgency Level
MEDIUM

---

## Notification spam: per-error YAML warning popups on every save, plus unconditional info toasts

### Description
`loadControllerConfig` shows one `showWarningMessage` **per validation error** and is invoked from at least six code paths, including the `onDidSaveTextDocument` listener that fires on every `.cpp`/`controllers.yaml` save. A YAML file with 5 errors produces 5 toasts on every save of any relevant file. Additionally, several commands show unconditional information toasts that state things that did not necessarily happen: `startAudio`/`stopAudio` report "audio started/stopped" even when no emulator is connected (`ipcClient?.send` silently no-ops), and every successful build/deploy adds "build succeeded" / "emulator running" toasts on top of the status bar and output channel that already convey this.

### Evidence
- `src/extension.ts:500-514` — `for (const e of cfg.errors) { void vscode.window.showWarningMessage(...) }`.
- `src/extension.ts:391-419` — save listener calls `loadControllerConfig()` on each relevant save.
- `src/commands/transport.ts:4-12` — unconditional "audio started/stopped" toasts; `EmulatorManager.sendTransport` (manager.ts:167-172) does nothing when `ipcClient` is null, so the toast can be false.
- `src/commands/build.ts:53`, `src/commands/deploy.ts:12` — success toasts duplicating status-bar/output-channel feedback.

### Impact
Notification fatigue: users learn to dismiss ds-ide toasts unread, so the genuinely important ones (NaN/Inf audio warnings, crash notices — extension.ts:273-296) lose signal. False "audio started" feedback actively misleads when the emulator is not running.

### Affected Files
- src/extension.ts
- src/commands/transport.ts
- src/commands/build.ts
- src/commands/deploy.ts

### Recommended Fix
1. Aggregate YAML errors into a single warning (`controllers.yaml: 5 problems — first: …`) or, better, publish them to the existing `DiagnosticCollection` against `controllers.yaml` and show no toast; deduplicate so unchanged errors don't re-notify on every save.
2. Make transport commands report emulator state honestly: expose connection state on `EmulatorManager` (e.g. `get isConnected()`) and show a warning ("no emulator running — deploy first") instead of a success toast when disconnected; drop routine success toasts in favor of the status bar.

### Urgency Level
MEDIUM

---

## Workspace safety: `effectSource` may point anywhere on disk, and the marker-block editor falls back to whole-file replacement

### Description
The Wiring Editor mutates the user's effect source via `WorkspaceEdit`. Two safety gaps:
1. `ds-ide.effectSource` accepts an absolute path with no containment check, and workspace settings (`.vscode/settings.json` committed in a repo) can set it. Opening a crafted project and clicking a pin in the Wiring Editor then silently applies edits (declaration/init blocks appended if markers are absent) to an arbitrary file outside the workspace.
2. `makeBlockEdit` falls back to replacing the **entire document** (`Range(0,0 … end)`) with programmatically regenerated text whenever either marker pair is missing — e.g. a user who deleted only the init markers gets their whole file rewritten from the string-transformed copy.

### Evidence
- `src/commands/find-effect-source.ts:23-26` — `path.isAbsolute(configured) ? configured : path.join(projectRoot, configured)`; only existence is checked.
- `src/extension.ts:73-76` — fallback: `edit.replace(uri, new vscode.Range(new vscode.Position(0, 0), doc.lineAt(doc.lineCount - 1).range.end), newText);`
- `src/wiring/controls-writer.ts:27-31` — when markers are absent, blocks are appended to the end of the file (past `main()`), i.e. edits are made even to files never prepared for ds-ide.
- No preview/confirmation step; `applyEdit` is immediate (extension.ts:172,193). Positive: edits go through the undoable `WorkspaceEdit` API rather than direct `fs.writeFile`, and inputs arriving from the webview are strictly validated (wiring-editor-panel.ts:32-56 checks pin range and C-identifier ids).

### Impact
A malicious or misconfigured workspace can direct code injection into writable `.cpp` files outside the project. The full-file fallback can mangle a legitimately customized source file in one click; recovery relies on the user knowing to press undo in an editor they may not have focused.

### Affected Files
- src/commands/find-effect-source.ts
- src/extension.ts
- src/wiring/controls-writer.ts

### Recommended Fix
1. In `findEffectSource`, resolve the configured path and reject it (with an actionable error) unless it is inside a workspace folder (`vscode.workspace.getWorkspaceFolder(Uri.file(p))`).
2. Replace the full-file fallback with targeted behavior: if markers are missing, ask once (modal confirmation "Add ds-ide blocks to <file>?") before appending; never rewrite lines outside the marker ranges.

### Urgency Level
MEDIUM

---

## Multi-root workspaces: only `workspaceFolders[0]` is used, and the save-listener path check is prefix-unsafe

### Description
Every workspace-dependent operation (build, deploy, wiring, YAML load/save, save-listener) hardcodes `workspaceFolders[0]`. A one-time info toast discloses this, which is a reasonable v1 posture, but the mechanics have defects: the `onDidSaveTextDocument` listener decides "in workspace" via `saved.startsWith(folder)`, which false-positives sibling directories (`/Users/x/proj` matches `/Users/x/proj-old/a.cpp` when folder is `/Users/x/proj`... more precisely any path sharing the prefix without a separator boundary), and documents saved in *other* roots of a multi-root workspace are silently ignored with no way to select which folder ds-ide operates on.

### Evidence
- `src/extension.ts:119-124` — one-time multi-folder info message (good).
- `src/extension.ts:400` — `const mightBeSource = saved.endsWith('.cpp') && saved.startsWith(folder);`
- `folders[0]` hardcoded at extension.ts:139-141, 159, 180, 332, 355-357, 394, 428, 450-455, 457-463; `src/commands/build.ts:20`.

### Impact
In multi-root setups the extension can react to saves from an unrelated sibling directory, and users cannot use ds-ide on any project other than whichever folder happens to be first. Confusing, hard-to-diagnose behavior rather than data loss.

### Affected Files
- src/extension.ts
- src/commands/build.ts

### Recommended Fix
1. Use `vscode.workspace.getWorkspaceFolder(doc.uri)` in the save listener and compare against the active project folder (proper URI semantics fix the prefix bug; otherwise ensure the prefix comparison ends with `path.sep`).
2. Centralize project-root resolution in one helper; when multiple folders exist, let the user pick (quick-pick, persisted in `workspaceState`) instead of always folder 0.

### Urgency Level
MEDIUM

---

## Pot-knob drags flood workspaceState and IPC with per-mousemove writes

### Description
Dragging a knob in the Controls webview posts a `pot` message on **every mousemove**. Each message triggers `PotStore.set`, which reads the whole record from `workspaceState` and issues `workspaceState.update` (an async persisted write), plus an IPC `send`. There is no throttling or coalescing anywhere in the chain. The same applies to the sine-amplitude slider and the output-volume slider (`input` events).

### Evidence
- `src/webview/controls-webview.ts:184-190` — `onKnobMove` posts `{ command: 'pot', … }` per mousemove (~60–120 Hz).
- `src/extension.ts:146-149` — handler does `potStore.set(...)` + `manager.sendPot(...)` per message.
- `src/controllers/pot-store.ts:17-21` — `getAll()` + `update()` (full-record persisted write) on every call.
- `src/webview/scope-webview.ts:190-193, 198-202` — `input` events send per-tick messages.

### Impact
Sustained knob drags generate hundreds of storage writes per second on the Extension Host, contending with the latency-sensitive IPC path and other extensions. Not a freeze, but measurable churn on exactly the interaction that should feel real-time.

### Affected Files
- src/webview/controls-webview.ts
- src/webview/scope-webview.ts
- src/controllers/pot-store.ts
- src/extension.ts

### Recommended Fix
Keep sending pot IPC messages at input rate (they are the point of the feature) but debounce persistence: buffer the latest value per channel and flush to `workspaceState` on `mouseup` or after ~250 ms idle. In the webview, coalesce mousemove updates with `requestAnimationFrame`.

### Urgency Level
MEDIUM

---

## Marketplace metadata inconsistencies (version, icon, keybinding hygiene)

### Description
Several `package.json` / packaging-metadata issues beyond the HIGH packaging finding:
- `"version": "0.0.1"` while `CHANGELOG.md` documents releases through `0.11.0` — the published version would match neither the changelog nor git tags.
- `"icon": "images/icon.png"` points to a non-existent directory (also breaks `vsce package`; see HIGH finding).
- Activity-bar contributions reference only the dark icon variants (`media/controls-editor-icon-dark.svg`) although light variants exist in `media/` — either dead assets or a missed theme-aware contribution.
- Keybindings (`cmd+shift+alt+b/d/r/s`) have no `when` clauses and commands have no `enablement`, so four prime shortcuts are live in every workspace, including non-Daisy projects.
- `"lint": "tsc --noEmit"` duplicates `typecheck` and provides no actual linting (no eslint config), weakening the quality gate the script name implies.
- Positive: LICENSE, README with screenshots/requirements/install steps, CHANGELOG, `repository`, `categories` (`Other`, `Debuggers`), and `keywords` are all present.

### Evidence
- `package.json:5` vs `CHANGELOG.md` header `## 0.11.0 — 2026-06-30`.
- `package.json:15` — `images/icon.png`; `images/` does not exist.
- `package.json:77-98` — keybindings without `when`; `contributes.commands` without `enablement`.

### Impact
Wrong version semantics at publish time, failed packaging, and global keyboard shortcuts that surprise users in unrelated projects. Discoverability/trust issues rather than runtime failures.

### Affected Files
- package.json
- CHANGELOG.md
- media/

### Recommended Fix
Sync `version` with the latest changelog tag (0.11.0); add the icon asset; add `enablement`/`when` gates (e.g. a `ds-ide.isDaisyProject` context key set on activation, or `workspaceContains`-driven behavior); use or delete the light icon variants; wire up a real linter or rename the script.

### Urgency Level
LOW

---

## Minor Extension Host hygiene: sync fs calls in command paths, per-reveal webview HTML reset

### Description
Small performance/correctness nits:
1. Sync filesystem APIs run on the Extension Host during commands: `mkdirSync` in `EmulatorManager.build`, `readdirSync`/`statSync` in `findHardwareBin`. Directories are small, but these block the host thread and async equivalents are already used elsewhere in the codebase.
2. `ScopePanel.show()` reassigns `panel.webview.html` on every reveal (every deploy), fully reloading the webview and discarding scope/spectrum history — despite `retainContextWhenHidden: true`, which then pays its memory cost without delivering persistence across deploys. State restoration relies on regenerating the emulator-bar HTML with current values plus the `webviewReady` → replay-last-status handshake, a fragile pattern.
3. All three webviews use `retainContextWhenHidden: true`; for the two sidebar views this is a deliberate, documented choice (CHANGELOG M35), but the scope panel could use `getState`/`setState` serialization instead of keeping a hidden iframe alive.
4. Positive: activation is contributes-driven (no `activationEvents` wildcard; auto-generated from commands/views/debuggers on engine ^1.85), `activate()` defers all I/O to promises, and all long-lived disposables are tracked in `context.subscriptions` with a correct composite disposable for `manager`/`scopePanel`.

### Evidence
- `src/emulator/manager.ts:76` — `this.mkdirSync(this.buildDir, { recursive: true })`.
- `src/commands/dfu-flash.ts:63-88` — `readdirSync`/`statSync`.
- `src/webview/scope-panel.ts:96-99` — `if (this.panel) { this.panel.reveal(...); this.panel.webview.html = this.html(); return; }`.

### Impact
Marginal Extension Host stalls on slow filesystems; scope panel state (waveform history, recording UI) resets on every redeploy; extra memory held by hidden webviews.

### Affected Files
- src/emulator/manager.ts
- src/commands/dfu-flash.ts
- src/webview/scope-panel.ts

### Recommended Fix
Swap sync fs calls for `fs.promises` equivalents; on reveal, `postMessage` the current sine/audio-source state instead of regenerating HTML; consider `getState()/setState()` in the scope webview and dropping `retainContextWhenHidden` for the panel.

### Urgency Level
LOW

---

## Configuration contributions lack scope and format constraints

### Description
The two settings (`ds-ide.effectSource`, `ds-ide.armToolchainPath`) are declared as bare strings with empty defaults. Neither declares a `scope` although both are inherently per-workspace / machine-specific paths, so they default to `window` scope and sync across machines via Settings Sync — a toolchain path from a desktop will silently apply on a laptop. There is no `markdownDescription`, no `pattern`, and `effectSource`'s resolution rules (absolute paths honored, relative resolved against the first workspace folder) and security implication (see workspace-safety finding) are undocumented in the Settings UI.

### Evidence
- `package.json:129-143` — `contributes.configuration` block: `type: string`, `default: ""`, plain `description` only.

### Impact
Wrong-machine toolchain paths after settings sync produce confusing "not found" errors; users cannot tell from the Settings UI how `effectSource` resolves.

### Affected Files
- package.json

### Recommended Fix
Add `"scope": "machine-overridable"` for `armToolchainPath` and `"scope": "resource"` (or `window` with explicit docs) for `effectSource`; document resolution order and auto-detection behavior in `markdownDescription`.

### Urgency Level
LOW

---

## Debug contribution polish: no configuration snippets, no progress UI during resolve, macOS-only lldb-dap discovery

### Description
The debugger integration is architecturally sound: a `ds-ide` wrapper type whose `resolveDebugConfiguration` performs build+deploy, then starts the real `daisy-debug`/lldb-dap attach session and aborts the wrapper by returning `undefined`, with an inline always-terminating adapter as a safety net; a DAP tracker mutes audio on breakpoints (`stopped` → simulated clock). Remaining gaps: the `daisy-debug` type contributes no `initialConfigurations`/`configurationSnippets`, so a user picking "Daisy Debug" manually gets an empty config and a "pid required" failure; the potentially minute-long CMake build runs inside `resolveDebugConfiguration` with no `withProgress` UI, so F5 appears hung on a cold configure; and lldb-dap discovery covers only macOS paths plus `xcrun` (consistent with the macOS-first stance, but versioned Linux binary names like `lldb-dap-18` are missed with no tailored message).

### Evidence
- `package.json:144-160` — `daisy-debug` contribution: `configurationAttributes.attach.required: ["pid"]`, no snippets.
- `src/debug/run-config-provider.ts:24-50` — build+deploy inside resolve; no progress reporting.
- `src/debug/debug-adapter.ts:5-9,23-37` — candidate list and `xcrun` probing only.

### Impact
Manual selection of "Daisy Debug" from the debugger picker dead-ends; F5 feels unresponsive on first run; Linux users get a misleading "install Xcode Command Line Tools" error.

### Affected Files
- package.json
- src/debug/run-config-provider.ts
- src/debug/debug-adapter.ts

### Recommended Fix
Mark `daisy-debug` as internal (or add a snippet documenting it); wrap build/deploy in `vscode.window.withProgress` with cancellation; extend lldb-dap discovery with PATH probing for `lldb-dap`/`lldb-dap-*` and platform-appropriate install hints.

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

*Note: no language server is present in this extension; the Language Server review category is N/A.*
