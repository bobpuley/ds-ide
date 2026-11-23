# Review Report

> **Intake tracking:** each finding ends with an `### Intake Status` section. "Intaken" means it is planned in a milestone (see the v28 registry in `docs/05_dev-plan.md`); "Pending" means it has not been intaken yet. Update the status when a finding is intaken or released.

## [Activation] `workspaceContains:*.cpp` activates the full extension in any C++ repository

### Description
The only declared activation events are `workspaceContains:*.cpp`, `workspaceContains:src/*.cpp` and `workspaceContains:source/*.cpp`, so the extension activates in any workspace with a `.cpp` file at the root, in `src/` or in `source/`. Most such workspaces are not Daisy projects. `activate()` then does all of its setup unconditionally, before it knows whether the folder is a Daisy project (`ds-ide.isDaisyProject` is only computed later, asynchronously, in `initViewsFromProject()`):
- it loads the native `midi` addon and opens every host MIDI input port (see the separate Resource management finding);
- it creates four output channels, a diagnostic collection, a tree view, two status-bar items and three webview panel controllers;
- it starts the stale-socket sweep and a recursive file-system watcher;
- in multi-root workspaces it shows a notification ("multiple workspace folders detected — operating on …").

### Evidence
- `package.json:42-46` — the activation events.
- `src/extension.ts:1115-1259` — eager construction in `activate()`, including `hostMidiBridge.start()` at line 1259.
- `src/extension.ts:1192-1204` — the multi-root information message is shown in any multi-root workspace that contains a `.cpp`, Daisy project or not.
- `src/extension.ts:1413-1432` — `isDaisyProject` only means "an effect `.cpp` was found". That is true for almost any single-`.cpp` C++ repo, so the Daisy view, status items and keybindings turn on in non-Daisy repositories too.

### Impact
- Activation time, memory and native handles are spent in every C++ workspace the user opens, not just Daisy projects.
- Non-Daisy multi-root workspaces get an unrelated notification on every window open.
- Daisy UI (status bar, run button context, keybindings) shows up in repositories it doesn't apply to.

### Affected Files
- package.json
- src/extension.ts

### Recommended Fix
1. Keep `activate()` cheap: register commands, view providers and the debug providers, but defer everything else (the MIDI bridge, the stale-socket sweep, the multi-root notice, `initViewsFromProject()`) until a positive Daisy-project check passes.
2. Make that check stronger than "a `.cpp` exists". For example, require one of: a `controllers.yaml`, a `// ds-ide:` marker, or `#include "daisy_seed.h"` / `#include "daisy.h"` in the effect source, or a Makefile that references `LIBDAISY_DIR`.
3. Consider narrowing the activation events, e.g. adding `workspaceContains:controllers.yaml` and relying on the implicit `onView:`/`onCommand:` activation for everything else. Keep the `*.cpp` events only if auto-activation in plain C++ repos is a deliberate product decision.

### Urgency Level
MEDIUM

### Intake Status
Pending — not yet intaken.

---

## [Extension Host performance] Live IPC streams are posted to retained, hidden webviews; all five webviews keep `retainContextWhenHidden`

### Description
The emulator streams `scope`, `spectrum`, `oledFrame`, `led` and `midiRx/Tx` messages continuously while audio runs. For every message the Extension Host does a `JSON.parse`, a schema narrowing pass and an EventEmitter fan-out, then forwards the payload to every listening webview with `postMessage`. None of the forwarding paths checks whether the target is visible. All five webviews are also created with `retainContextWhenHidden: true`: the Scope, OLED and MIDI panels, and the Controls and Wiring sidebar views. A hidden panel therefore keeps its full renderer process alive and keeps receiving (and processing) the whole stream.

The two sidebar providers already cache their last state and replay it on `onDidChangeVisibility` / `webviewReady` (`_flush()`, `lastWiredPins`), so retaining their context is redundant.

### Evidence
- `src/webview/scope-panel.ts:103-113` and `269-284` — every `scope`/`spectrum`/`scope_capture` message is posted with no `panel.visible` check; `retainContextWhenHidden: true` at line 140.
- `src/webview/oled-panel.ts:56`, `src/webview/midi-panel.ts:61` — `retainContextWhenHidden: true`.
- `src/extension.ts:559-562` — every OLED frame is also posted to the Controls Editor sidebar.
- `src/extension.ts:1500-1505` — both sidebar views registered with `retainContextWhenHidden: true`.
- `src/sidebar/controls-editor-panel.ts:149-154, 221-237` and `src/sidebar/wiring-editor-panel.ts:157-162` — replay-on-visible logic that makes retention unnecessary for the sidebars.
- `src/emulator/ipc-client.ts:128-158` — parse and validate on the Extension Host for every line.

### Impact
- Steady Extension Host CPU use and IPC traffic to the renderer while audio runs, even when no scope or OLED view is on screen. This is the same thread every other extension shares.
- Up to five extra webview renderer processes held in memory for the whole session.

### Affected Files
- src/webview/scope-panel.ts
- src/webview/oled-panel.ts
- src/webview/midi-panel.ts
- src/sidebar/controls-editor-panel.ts
- src/sidebar/wiring-editor-panel.ts
- src/extension.ts
- src/emulator/ipc-client.ts

### Recommended Fix
1. Remove `retainContextWhenHidden` from the two `registerWebviewViewProvider` calls; the existing replay logic already restores state.
2. In `ScopePanel`, `OledPanel`, `MidiPanel` and `ControlsViewProvider.postOledFrame`, skip high-rate posts while `panel.visible === false` (keep only the latest frame for replay on `onDidChangeViewState`). Keep `retainContextWhenHidden` only on the Scope panel, where the trace history justifies it.
3. Optionally tell the emulator to pause scope/spectrum generation when no consumer is visible (a `scopeSubscribe` on/off IPC message), so the data is never produced.

### Urgency Level
MEDIUM

### Intake Status
Pending — not yet intaken.

---

## [Resource management] The host MIDI bridge opens every MIDI input port at activation and holds them for the whole session

### Description
`activate()` calls `hostMidiBridge.start()` unconditionally. `start()` loads the native `midi` addon and opens every enumerated host MIDI input port, then holds them until the extension is disposed. This happens before any emulator is running, whether or not the project uses MIDI, and in non-Daisy C++ workspaces (see the Activation finding). On Windows, WinMM input ports are exclusive: a port opened by the Extension Host cannot be opened by a DAW or other MIDI software while VS Code is open. The bridge also enumerates ports only once, so a controller plugged in later is never seen.

### Evidence
- `src/extension.ts:1258-1259` — `new HostMidiBridge(manager); hostMidiBridge.start();` inside `activate()`.
- `src/midi/host-bridge.ts:51-79` — opens each of `getPortCount()` ports; the comment at lines 6-8 acknowledges the WinMM single-process restriction.
- `src/extension.ts:1525` — ports are released only on extension dispose.

### Impact
- On Windows, the extension silently takes every MIDI input device away from other applications as soon as any C++ folder is opened.
- Native handles are held for the whole session at no benefit when no emulator is running or no MIDI peripheral is enabled.
- Devices hot-plugged after activation are ignored until VS Code is reloaded.

### Affected Files
- src/extension.ts
- src/midi/host-bridge.ts

### Recommended Fix
1. Start the bridge only once an emulator is deployed *and* the effect enables `midiTrs` or `midiUsb` (the same check `showMidiIfEnabled()` already does); call `stop()` on emulator exit or stop.
2. Re-enumerate ports on each start, so hot-plugged devices are picked up.
3. Optionally add a setting (`ds-ide.hostMidi.enabled`, default `true`) and/or a port allow-list, so users can keep specific devices free for other software.

### Urgency Level
MEDIUM

### Intake Status
Pending — not yet intaken.

---

## [Resource management] Shutdown cleanup is fire-and-forget; `deactivate()` does not wait for the emulator to exit or for pending state to flush

### Description
`deactivate()` is empty and relies on `context.subscriptions`. The emulator teardown it triggers (`manager.dispose()` → `killExisting()`) is asynchronous, but its promises are dropped:
- `terminateUnlessExited()` waits up to `SHUTDOWN_GRACE_MS` (2 s) before escalating;
- `escalateKill()` polls for 200 ms before sending `SIGKILL`.

When the Extension Host exits right after disposal (window close or reload), these timers never fire. A wedged `effect_emu` that ignores the IPC `shutdown` message or `SIGTERM` keeps running and keeps the CoreAudio device open. The next session only reclaims it through `emu.pid`.

Similarly, `PotStore` debounces `workspaceState.update` by 250 ms and has no dispose or flush hook, so the last pot movement before a window close is lost.

### Evidence
- `src/extension.ts:1523-1526` — `{ dispose: () => { manager?.dispose(); … } }`, synchronous.
- `src/extension.ts:1530-1532` — empty `deactivate()`.
- `src/emulator/manager.ts:706-711`, `822-850` — `void terminateUnlessExited(child, pid)` / `void escalateKill(pid, immediate)`.
- `src/emulator/manager.ts:151-159`, `28-43` — the 2 s grace period and the 200 ms polling loop.
- `src/controllers/pot-store.ts:58-62` — `scheduleFlush()` with no dispose/flush path; `PotStore` is never disposed.

### Impact
- Orphaned emulator processes that keep holding the audio device after VS Code closes; they are only cleaned up the next time the same project is deployed.
- The last control values silently revert after a reload.

### Affected Files
- src/extension.ts
- src/emulator/manager.ts
- src/controllers/pot-store.ts

### Recommended Fix
1. Give `EmulatorManager` an `async shutdown(): Promise<void>` that awaits `terminateUnlessExited` / `escalateKill`, and return it from `deactivate()`. VS Code waits for a promise returned from `deactivate()`, within its shutdown budget. Use a shorter grace period on this path (e.g. 500 ms), then `SIGKILL`.
2. Add `flush(): Thenable<void>` (or `dispose()`) to `PotStore` and call it from `deactivate()` (or push the store into `context.subscriptions`).

### Urgency Level
MEDIUM

### Intake Status
Pending — not yet intaken.

---

## [Webview security] Webview CSP allows `style-src 'unsafe-inline'`

### Description
All six webview HTML builders use `default-src 'none'; script-src 'nonce-…'; style-src 'unsafe-inline';`. Scripts are properly nonce-locked and `localResourceRoots` is limited to `dist/`, so there is no script-injection exposure. However, `'unsafe-inline'` for styles lets any markup that reaches the DOM unescaped apply arbitrary CSS, which enables UI-redressing and CSS-based data exfiltration through attribute selectors.

The `innerHTML` sinks audited are currently all escaped (`escJ`, `escapeHtml`, `escHtml`), so this is defence in depth only.

### Evidence
- `src/sidebar/controls-editor-panel.ts:267`, `src/wiring/wiring-panel.ts` (CSP meta in `buildHtml`), `src/webview/scope-panel.ts:488`, `src/webview/oled-panel.ts:131`, `src/webview/midi-panel.ts:159`.
- Inline `style="…"` attributes in the generated markup (e.g. `controls-editor-panel.ts:355,360`, `scope-panel.ts:626-640`, `oled-panel.ts:146`) are what currently need `'unsafe-inline'`.

### Impact
If a future change introduces an unescaped sink, injected markup could restyle or overlay webview UI. No exploitable path exists today.

### Affected Files
- src/sidebar/controls-editor-panel.ts
- src/wiring/wiring-panel.ts
- src/webview/scope-panel.ts
- src/webview/oled-panel.ts
- src/webview/midi-panel.ts

### Recommended Fix
Move the `<style>` blocks into a `<style nonce="${nonce}">` element and use `style-src ${webview.cspSource} 'nonce-${nonce}'`. Replace inline `style="…"` attributes with classes, or set them from the nonce'd script via `element.style`, which CSP does not restrict.

### Urgency Level
LOW

### Intake Status
Pending — not yet intaken.

---

## [Workspace safety] Wiring/peripheral edits are computed against a stale document snapshot and are not serialized, so concurrent edits can corrupt the effect source

### Description
The Wiring Editor's six message handlers (`wirePin`, `unwirePin`, `moveControl`, `setPeripheralEnabled`, plus `placeControl`, which two of them share) each:
1. read `doc.getText()` after several `await`s (`findEffectSource` → `fs.readdir`, `openTextDocument`);
2. compute line-number ranges from that snapshot in `makeBlockEdit()`;
3. possibly `await` a modal confirmation;
4. call `workspace.applyEdit()` without checking that the document is still at the version the ranges were computed from.

`WiringViewProvider`'s `onDidReceiveMessage` handler is `async` and is not queued, so two quick webview actions (two drops, a drop then an unwire, an enable then a move) run interleaved. Both read the same pre-edit text. The second `applyEdit` then uses ranges that are off by the lines the first edit inserted or removed: it replaces the wrong lines and silently drops the first edit's declaration. The same applies when the file changes underneath, which the project explicitly supports (FR-AIG-6: coding agents, git, formatters). A concurrent change is also overwritten wholesale whenever the ambiguous-marker fallback replaces the full file.

Each handler also calls `doc.save()`, which persists any unrelated unsaved edits the user had in that file.

### Evidence
- `src/sidebar/wiring-editor-panel.ts:59-155` — `async` message handler with no queue or lock; each case `await`s the host callback.
- `src/extension.ts:684-754` (`placeControl`): `oldText = doc.getText()` at 692 → `makeBlockEdit(…, oldText, newText)` at 735 → optional `await confirmAppendMarkerBlocks()` at 736 → `applyEdit` at 739 → `doc.save()` at 747.
- `src/extension.ts:759-789` (unwire), `790-850` (peripheral enable/move) — the same pattern.
- `src/extension.ts:144-198` (`makeBlockEdit`) — ranges come from `oldR.s` / `oldR.e` of the snapshot; nothing records `doc.version`.

### Impact
The user's effect source can be corrupted: duplicated or missing declarations, half-replaced marker blocks, or concurrent edits from an agent or the user overwritten. Each edit is a single undo step, but the user rarely notices immediately because the views are refreshed from the corrupted text.

### Affected Files
- src/extension.ts
- src/sidebar/wiring-editor-panel.ts

### Recommended Fix
1. Serialize all source-mutating handlers through one promise queue (e.g. `let editChain = Promise.resolve(); editChain = editChain.then(() => handler(...))`), so each handler reads the text only after the previous edit has been applied and saved.
2. Record `const version = doc.version` together with `oldText`. Immediately before `applyEdit`, re-check `doc.version === version`; if it changed, recompute from fresh text, or abort with "the file changed — try again".
3. Do the confirmation modal *before* reading `oldText` (decide "needs append" from a first read, then re-read after the prompt).
4. Save only when the document was not dirty before the edit (`const wasDirty = doc.isDirty`), or leave saving to the user and have `buildControlsConfig` read from the `TextDocument` instead of disk.

### Urgency Level
HIGH

### Intake Status
Released in 0.27.3 — M94 (FR-WE-13), finding #9 of the HIGH intake.

---

## [Workspace safety] Duplicated or malformed marker blocks trigger a silent full-file replacement

### Description
When any of the four `// ds-ide:` marker pairs is ambiguous (duplicated, or `end` before `begin`) in either the old or the new text, `makeBlockEdit()` replaces the whole document with `newText`. The only guard is the "append" path (`needsAppendConfirmation`); the full-file replace runs with no prompt or preview. `newText` is produced by regex/line-based transforms that were designed for well-formed blocks. On a malformed file their output is the least predictable, which is exactly when the whole file gets rewritten.

### Evidence
- `src/extension.ts:169-173` — `if (anyAmbiguous) { edit.replace(uri, <whole document>, newText); return { edit, needsAppendConfirmation: false }; }`.
- `src/extension.ts:736-747`, `773-783`, `836-844` — callers only prompt when `needsAppendConfirmation` is true, then save immediately.

### Impact
A hand-edited project with, for example, a copy-pasted controls block can have the entire effect source rewritten and saved by a single drag in the Wiring Editor. Undo is available, but nothing shows the user what changed.

### Affected Files
- src/extension.ts

### Recommended Fix
Refuse the edit when markers are ambiguous: show "ds-ide: the `controls` marker block is duplicated or malformed at lines X/Y — fix it before wiring", with a "Reveal" action that selects the offending lines. This is the same policy `revealDeviceInCode` already applies. If a full rewrite must stay, show a modal confirmation and, ideally, open a diff (`vscode.diff`) before applying.

### Urgency Level
MEDIUM

### Intake Status
Pending — not yet intaken.

---

## [Workspace safety] `controllers.yaml` is written directly to disk, bypassing open editors

### Description
Saving the Controls Editor layout writes `controllers.yaml` with `fs.promises.writeFile`, not through a `WorkspaceEdit`. If the user has `controllers.yaml` open with unsaved changes, VS Code's buffer and the disk diverge. The user's next save raises a "file is newer" conflict, or overwrites the layout just written. The layout auto-saves after drags (`webview/controls/auto-save.ts`), so this can happen without any explicit save action. Writes are also not serialized, so two quick auto-saves can finish out of order.

### Evidence
- `src/extension.ts:618-628` — `fs.promises.writeFile(yamlPath, serializeControllerConfig(cfg), 'utf8')`.
- `src/webview/controls/auto-save.ts:16-23` — debounced auto-save from the webview.

### Impact
Lost layout changes or lost hand edits to `controllers.yaml`, and a confusing save-conflict dialog.

### Affected Files
- src/extension.ts

### Recommended Fix
Apply the change as a `WorkspaceEdit` replacing the whole document (`openTextDocument(yamlUri)`, then `applyEdit`, then `save()` only if the document wasn't dirty beforehand). If the open document is dirty, ask before overwriting. Chain writes through a single promise so the last save always wins.

### Urgency Level
MEDIUM

### Intake Status
Pending — not yet intaken.

---

## [Workspace safety] A failed project scaffold leaves partial output behind

### Description
`createEffectProject()` creates the project directory and then writes six artefacts in sequence, including a recursive copy of `DaisySP/Source`. If any step fails (disk full, permissions, a copy error), the error is reported, but the half-created folder stays. Re-running the wizard with the same name then fails with "folder already exists".

### Evidence
- `src/commands/create-effect-project.ts:115-154` — no cleanup in the `catch`.

### Impact
Leftover partial project folders; the user has to delete them by hand before retrying.

### Affected Files
- src/commands/create-effect-project.ts

### Recommended Fix
In the `catch`, delete `projectUri` (`workspace.fs.delete(projectUri, { recursive: true, useTrash: false })`), but only because the code created it a moment earlier (the existence check at lines 95-113 guarantees that). Alternatively, scaffold into a temporary sibling and `rename` it into place at the end.

### Urgency Level
LOW

### Intake Status
Pending — not yet intaken.

---

## [Command safety] Emulator builds are not mutually exclusive

### Description
`ds-ide.build` calls `buildForEmulator()` → `EmulatorManager.build()` directly, with no lock. `deploy()` coalesces concurrent calls through `deployLock`, but `build()` has no equivalent. A build from the Command Palette or keybinding (`Cmd+Shift+Alt+B`) can therefore run concurrently with an F5/Ctrl+F5 build, a `buildAndDeploy`, or a Restart. Both runs operate on the same `<project>/.ds-ide/build` directory, and `healStaleCache()` may `rm -rf` that directory while the other build is writing to it. The Daisy view hides Run while busy, but the palette commands and keybindings are not gated on `ds-ide.transportPhase`.

### Evidence
- `src/extension.ts:927-931` — `ds-ide.build` bypasses `TransportController.trackWork` and any busy check.
- `src/emulator/manager.ts:307-332` — `build()` sets `this.buildDir`, may `rm` it (`healStaleCache`, lines 868-880), then runs two `cmake` processes; no lock.
- `package.json:207-231` — keybindings gated only on `ds-ide.isDaisyProject`.

### Impact
A corrupted CMake cache or object files, spurious build failures, or a build that deletes another's output mid-run. The user then has to delete `.ds-ide/` by hand.

### Affected Files
- src/extension.ts
- src/emulator/manager.ts
- package.json

### Recommended Fix
Add a `buildLock` to `EmulatorManager.build()`, mirroring `deployLock`: reject with "a build is already running", or coalesce onto the in-flight build. Route `ds-ide.build` through `transport.trackWork` / `isTransportBusy` like the other transport commands. Add `enablement: "ds-ide.isDaisyProject && ds-ide.transportPhase !~ /^(building|deploying)$/"` to `ds-ide.build`, `ds-ide.deploy`, `ds-ide.buildAndDeploy` and `ds-ide.debug`.

### Urgency Level
MEDIUM

### Intake Status
Pending — not yet intaken.

---

## [Command safety] Validation of webview messages is inconsistent before state is persisted or forwarded

### Description
Most webview → host messages are validated, but several numeric fields are not:
- **Controls Editor:** `button` / `toggle` / `encoder` accept any number for `gpioPin` (no integer or range check). `ButtonStore.set()` / `ToggleStore.set()` persist the value to `workspaceState` *before* `narrowControlValue` rejects it on the IPC path. One such persisted key later makes `narrowControlSnapshot()` reject the *entire* post-deploy `controlSnapshot`, which by design fails as a whole. Every subsequent deploy would then silently skip restoring all control values.
- **Scope:** `sine` forwards any `freq` / `amplitude` (including `NaN`, `Infinity` and negatives) to the emulator and persists it via `SessionState.setSine`.
- **MIDI:** `noteOn` / `noteOff` do not range-check `note` / `velocity` (0–127), unlike `programChange` / `controlChange` in the same handler.

The webview is extension-controlled and nonce-locked, so this is not an injection vector, but a webview bug can permanently poison persisted state.

### Evidence
- `src/sidebar/controls-editor-panel.ts:108-127` — `typeof msg.gpioPin === 'number'` only.
- `src/extension.ts:634-644` — the store is updated before `manager.send*`.
- `src/ipc/control-values.ts:56-64` — the whole snapshot is rejected on any invalid entry.
- `src/webview/scope-panel.ts:154-161` — `sine` has only a `typeof` check.
- `src/webview/midi-panel.ts:74-81` vs `83-97`.

### Impact
Persisted control state can be corrupted so that post-deploy replay stops working for all controls; non-finite generator parameters can reach the emulator's audio path.

### Affected Files
- src/sidebar/controls-editor-panel.ts
- src/extension.ts
- src/webview/scope-panel.ts
- src/webview/midi-panel.ts

### Recommended Fix
Validate in the providers with the same predicates used downstream: `Number.isInteger(gpioPin) && gpioPin >= 0 && gpioPin < 32`, finite and clamped `freq` (20–20000) and `amplitude` (0–1), and `isValid7Bit(note) && isValid7Bit(velocity)`. In `ButtonStore` / `ToggleStore`, only persist values that pass `isValidControlId`. On load, drop invalid entries instead of letting them poison the snapshot.

### Urgency Level
LOW

### Intake Status
Pending — not yet intaken.

---

## [Command safety] Flash picks the newest `.bin` in `build/`, not the project's target

### Description
`ds-ide.flash` flashes whichever `.bin` in `<project>/build/` has the newest mtime. It never checks that file against the Makefile's `TARGET`, and it doesn't confirm which file it is about to flash. A stale binary from a renamed target, or an unrelated `.bin` dropped into `build/`, would be flashed to the device. (Build & Flash is less exposed, because the build it just ran usually produces the newest file.)

### Evidence
- `src/commands/dfu-flash.ts:84-114` — `findHardwareBin` sorts by mtime and returns `bins[0]`.
- `src/commands/dfu-flash.ts:61-68` — the bootloader prompt doesn't name the file.

### Impact
The wrong firmware is written to the user's Daisy Seed. This is recoverable by re-flashing, but confusing.

### Affected Files
- src/commands/dfu-flash.ts

### Recommended Fix
Prefer `build/<TARGET>.bin`, where `TARGET` is parsed from the project Makefile, and fall back to newest-mtime only when parsing fails. Always name the file, with its timestamp, in the confirmation prompt. If more than one `.bin` exists and none matches `TARGET`, let the user pick from a QuickPick.

### Urgency Level
LOW

### Intake Status
Pending — not yet intaken.

---

## [Command safety] The IPC runtime directory name is predictable and its permissions are not verified

### Description
The emulator's Unix socket lives in `os.tmpdir()/ds-ide-<sha256(buildDir)[0:10]>`. The name is derived only from the project path, so it is predictable. The directory is created with `mkdir(…, { recursive: true, mode: 0o700 })`, which does **not** change the mode or ownership of a directory that already exists. On macOS `os.tmpdir()` is per-user, so there is no exposure there. On Linux it is usually the shared `/tmp`: another local user could pre-create the directory and swap the socket file. The extension would then connect to their socket and send it IPC traffic, including `recordStart` / `replayStart` file paths.

### Evidence
- `src/emulator/manager.ts:54-57` — `workspaceRuntimeDir`.
- `src/emulator/manager.ts:418-425` — `mkdir(runtimeDir, { recursive: true, mode: 0o700 })` with no ownership or mode check.

### Impact
A local-attacker scenario on shared Linux hosts only; low likelihood given the project's macOS-first audience.

### Affected Files
- src/emulator/manager.ts

### Recommended Fix
After `mkdir`, `lstat` the directory and refuse to proceed unless it is a real directory (not a symlink), owned by `process.getuid()`, with mode `0o700`. Alternatively, use `context.storageUri` / `globalStorageUri` (when the path stays under the ~103-byte socket limit), or `fs.mkdtemp` per session.

### Urgency Level
LOW

### Intake Status
Pending — not yet intaken.

---

## [Configuration] Configuration changes are never observed

### Description
Nothing in the extension subscribes to `workspace.onDidChangeConfiguration`. If the user changes `ds-ide.effectSource`, the cached `effectSourcePath`, the `ds-ide.isDaisyProject` / `ds-ide.isEffectSource` context keys, the Wiring/Controls views and the status items all keep reflecting the old file. They only update on the next save of a `.cpp` / `controllers.yaml`, a file-watcher event, or a window reload. Changes to `ds-ide.armToolchainPath` / `ds-ide.hardwareVariant` are read lazily, so those settings are fine.

### Evidence
- No occurrence of `onDidChangeConfiguration` under `src/` (outside tests).
- `src/extension.ts:1405-1449` — `effectSourcePath` and the context keys are set only in `initViewsFromProject()`.

### Impact
After pointing `ds-ide.effectSource` at a different file, the editor-title Run button, the Wiring Editor and the Controls Editor keep operating on (and editing) the previously resolved source until something else triggers a refresh. A wiring edit can land in the wrong file without the user noticing.

### Affected Files
- src/extension.ts

### Recommended Fix
Register `vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('ds-ide.effectSource')) void initViewsFromProject(); })` and push it into `context.subscriptions`.

### Urgency Level
MEDIUM

### Intake Status
Pending — not yet intaken.

---

## [Configuration] `ds-ide.effectSource` is window-scoped and read without a resource, so per-folder values are ignored

### Description
`ds-ide.effectSource` declares no `scope`, so it defaults to `window`, and it is read with `getConfiguration('ds-ide')` with no resource URI. This is a per-project setting: its value is a path relative to *the project folder*. In a multi-root workspace, a value in `<folder>/.vscode/settings.json` is ignored, and one workspace-level value is applied to whichever folder is active, which is usually wrong for every other folder. The description documents the limitation, but the setting doesn't need to work this way; `ds-ide.hardwareVariant` is already resource-scoped and read per folder.

### Evidence
- `package.json:403-407` — no `"scope"`; the description explains the workaround.
- `src/commands/find-effect-source.ts:62` — `vscode.workspace.getConfiguration('ds-ide').get<string>('effectSource')`.
- Contrast: `src/commands/hardware-build.ts:120` — `getConfiguration('ds-ide', vscode.Uri.file(projectRoot))`.

### Impact
Multi-root users cannot configure a different effect source per project; the wrong path, or a path flagged as "outside workspace", is used for other folders.

### Affected Files
- package.json
- src/commands/find-effect-source.ts

### Recommended Fix
Declare `"scope": "resource"` for `ds-ide.effectSource` and read it with `getConfiguration('ds-ide', vscode.Uri.file(folder))` inside `resolveConfiguredEffectSource(folder)`. Remove the workaround paragraph from the setting's description.

### Urgency Level
MEDIUM

### Intake Status
Pending — not yet intaken.

---

## [Configuration] Development `.vscode/tasks.json` uses the wrong problem matcher and has no watch task

### Description
The default build task runs `npm run compile` (`gen:pins` + esbuild) but attaches the `$tsc` problem matcher. esbuild's error format does not match `$tsc`, so compile errors never reach the Problems view. There is no background watch task, even though a `compile:watch` script exists, so every F5 does a full rebuild. Type errors are not surfaced either: esbuild doesn't type-check, and `typecheck` isn't wired in.

### Evidence
- `.vscode/tasks.json` — `"script": "compile", "problemMatcher": "$tsc"`.
- `package.json:472-474` — `compile:watch` and `typecheck` scripts exist but aren't used by `.vscode/`.

### Impact
Slower inner loop for contributors; build and type errors are visible only in the terminal.

### Affected Files
- .vscode/tasks.json
- .vscode/launch.json

### Recommended Fix
Add an `npm: compile:watch` background task (`isBackground: true`, with the `$esbuild-watch` matcher from the `connor4312.esbuild-problem-matchers` extension, or a custom background matcher). Add an `npm: typecheck` task with `$tsc`, and point `launch.json`'s `preLaunchTask` at the watch task.

### Urgency Level
LOW

### Intake Status
Pending — not yet intaken.

---

## [Multi-root workspace support] Workspace-folder changes are not handled

### Description
The extension never subscribes to `workspace.onDidChangeWorkspaceFolders`. `resolveActiveFolder()` falls back to `folders[0]` whenever the persisted path no longer matches. So when folders are added, removed or reordered, the active folder can silently switch to a different project, while the views, context keys, `effectSourcePath` and the file watcher's scope still show the previous one. Going from one folder to two also never shows the "multiple folders" notice or lets the user choose.

### Evidence
- No occurrence of `onDidChangeWorkspaceFolders` under `src/` (outside tests).
- `src/workspace/active-folder.ts:11-18` — silent fallback to `folders[0]`.
- `src/extension.ts:1192-1204` — the multi-root notice runs once, at activation only.

### Impact
Builds, deploys and wiring edits can target a folder other than the one the UI shows, after the user simply adds a folder to the workspace.

### Affected Files
- src/extension.ts
- src/workspace/active-folder.ts

### Recommended Fix
Subscribe to `onDidChangeWorkspaceFolders` (and push the subscription into `context.subscriptions`). When the persisted active folder was removed, or the folder count crosses 1 → 2, clear or confirm the selection and call `initViewsFromProject()`. Also stop any running emulator whose project folder was removed.

### Urgency Level
MEDIUM

### Intake Status
Pending — not yet intaken.

---

## [Multi-root workspace support] "Add AI Guide to Project" silently changes the active folder

### Description
`addAiGuideToProject()` picks its target folder with `promptSelectActiveFolder()`, which *persists* the choice as the extension-wide active folder. Choosing a folder to drop a Markdown file into therefore also re-targets every later build, deploy and wiring edit. The views are not refreshed either: unlike `ds-ide.selectActiveFolder`, this command never calls `initViewsFromProject()`.

### Evidence
- `src/commands/add-ai-guide.ts:131` — `promptSelectActiveFolder(workspaceState)`.
- `src/workspace/active-folder.ts:36` — `workspaceState.update(ACTIVE_FOLDER_KEY, …)`.
- Contrast: `src/extension.ts:1046-1049`.

### Impact
In a multi-root workspace the UI keeps showing the old project while commands act on the newly picked one.

### Affected Files
- src/commands/add-ai-guide.ts
- src/workspace/active-folder.ts

### Recommended Fix
Split folder selection into a non-persisting `pickWorkspaceFolder()` (a plain `showWorkspaceFolderPick()` is enough) for one-off commands, and keep `promptSelectActiveFolder()` only for `ds-ide.selectActiveFolder`.

### Urgency Level
LOW

### Intake Status
Pending — not yet intaken.

---

## [Error handling] Emulator events and IPC errors produce unthrottled notification floods

### Description
`wireManagerEvents()` calls `showWarningMessage` for **every** `event` message with `kind: 'nan' | 'inf'`. The emulator sends one such event per audio block whenever the output contains a NaN/Inf (`scan_output_and_notify`, "at most one IPC event per kind per call"). At 48 kHz with 256-frame blocks that is about 190 notification RPCs per second for as long as the effect misbehaves; dismissing the toast just brings it back. The same handler calls `showErrorMessage` for every IPC `error`, including repeated receive-buffer overflows and socket errors after the emulator dies, which also stack up on top of the transport's own "emulator crashed" notification.

### Evidence
- `src/extension.ts:538-546` — a warning per nan/inf event, with no de-duplication.
- `emulator/runtime/audio_engine.cpp:228-245` — one `nan` event per callback block.
- `src/extension.ts:574-577` — an error toast per `error` emission.
- `src/emulator/ipc-client.ts:72, 136` — the sources of `error` emissions.

### Impact
A notification storm that buries actionable messages and adds steady Extension Host → renderer traffic. The Scope panel's event bar already shows these events, so the toasts add nothing.

### Affected Files
- src/extension.ts
- src/emulator/ipc-client.ts

### Recommended Fix
Show the NaN/Inf toast at most once per emulator session (reset on deploy) or rate-limit it (e.g. once per 30 s), with a "Show Scope" action, and send everything else to the output channel only. For `error`, log every occurrence but show at most one toast per connection, and suppress it once the transport is in the `crashed` phase.

### Urgency Level
MEDIUM

### Intake Status
Pending — not yet intaken.

---

## [Error handling] Several failures are only reported through `console.*`

### Description
Several runtime diagnostics go to `console.warn` / `console.error`, which users only see in the Extension Host developer tools:
- the MIDI bridge being unavailable, or a port that fails to open;
- a project-watcher refresh failure;
- pot-state persistence failures;
- dropped invalid `controlValue` / `controlSnapshot` messages;
- `assertNever` hits.

The extension already has four output channels, but none of them is a `LogOutputChannel`. Users therefore have no log levels and no built-in "Set Log Level" support.

### Evidence
- `src/midi/host-bridge.ts:55, 77`
- `src/workspace/project-watcher.ts:54`
- `src/controllers/pot-store.ts:70`
- `src/emulator/manager.ts:582, 610`
- `src/webview/message-guard.ts:34`
- `src/extension.ts:1207-1210` — plain `createOutputChannel(name)`.

### Impact
Silent feature degradation (no host MIDI, editors not refreshing after external edits, a dropped control snapshot) that users cannot diagnose or report.

### Affected Files
- src/midi/host-bridge.ts
- src/workspace/project-watcher.ts
- src/controllers/pot-store.ts
- src/emulator/manager.ts
- src/webview/message-guard.ts
- src/extension.ts

### Recommended Fix
Create one `vscode.window.createOutputChannel('Daisy IDE', { log: true })` and inject a small logger into these modules in place of `console.*`, at the matching `warn` / `error` / `trace` levels. Keep the existing per-purpose channels for build and emulator output.

### Urgency Level
LOW

### Intake Status
Pending — not yet intaken.

---

## [VS Code API usage] Webview view event subscriptions are not tracked

### Description
`resolveWebviewView()` in both sidebar providers subscribes to `webviewView.onDidChangeVisibility` and `webviewView.onDidDispose` but discards the returned disposables. Only `msgDisposable` is disposed. The listeners are released when the view is torn down, but the pattern is inconsistent with the rest of the codebase's disposal discipline. If VS Code re-resolves a view, for example after the user moves it between containers, the old listeners stay registered until the old view is garbage-collected.

### Evidence
- `src/sidebar/controls-editor-panel.ts:149-159`
- `src/sidebar/wiring-editor-panel.ts:157-167`

### Impact
Minor; a potential source of duplicate replay posts if a view is re-resolved.

### Affected Files
- src/sidebar/controls-editor-panel.ts
- src/sidebar/wiring-editor-panel.ts

### Recommended Fix
Collect all three subscriptions in an array and dispose them together in the `onDidDispose` handler, or use a `vscode.Disposable.from(...)` per resolved view.

### Urgency Level
LOW

### Intake Status
Pending — not yet intaken.

---

## [VS Code API usage] The internal `daisy-debug` debugger appears in the user-facing debugger picker

### Description
`contributes.debuggers` declares `daisy-debug` with `languages: ["c","cpp"]` and the label "Daisy Debug (internal — attach-only, started by DS-IDE launch configurations)". Because it is language-bound and has no `when` / `hiddenWhen`, it is offered in "Select debugger" and the "create launch.json" flows for every C/C++ file. The public `ds-ide` debugger is likewise offered in non-Daisy C++ workspaces.

### Evidence
- `package.json:426-447` (`daisy-debug`), `448-467` (`ds-ide`).

### Impact
User confusion: an internal attach-only adapter that cannot be launched directly shows up in pickers, along with a Daisy launch type in non-Daisy repos.

### Affected Files
- package.json

### Recommended Fix
Add `"hiddenWhen": "true"` (or remove `languages`) for `daisy-debug`, and `"when": "ds-ide.isDaisyProject"` for `ds-ide`.

### Urgency Level
LOW

### Intake Status
Pending — not yet intaken.

---

## [VS Code API usage] `@types/vscode` lags far behind `engines.vscode`

### Description
`engines.vscode` is `^1.140.0`, but the devDependency is `@types/vscode ^1.85.0`. The compiler checks against an API surface roughly 55 releases older than the declared minimum. Newer APIs the extension could rely on are invisible to TypeScript, and API shapes that changed since 1.85 are not type-checked against what actually runs.

### Evidence
- `package.json:14-16` and `489`.

### Impact
Type-checking doesn't reflect the actual runtime API; newer, better-fitting APIs are missed.

### Affected Files
- package.json

### Recommended Fix
Pin `@types/vscode` to the engine minimum (`~1.140.0`). It must never exceed `engines.vscode`; `vsce` enforces that.

### Urgency Level
LOW

### Intake Status
Pending — not yet intaken.

---

## [Marketplace readiness] Discoverability metadata could be tighter

### Description
The marketplace basics are present: README with screenshots, CHANGELOG, LICENSE, icon, gallery banner, `preview: true`, repository, bugs, keywords and a walkthrough. Remaining gaps:
- `categories` uses the low-signal `"Other"`. `"Debuggers"` is right; add `"Testing"` and/or `"Programming Languages"` only if they fit, and drop `"Other"`.
- `ds-ide.hardwareVariant` has an `enum` but no `enumDescriptions`, so the Settings UI shows bare `base` / `65mb-sdram`.
- No `"order"` on settings, so their order in the Settings UI is arbitrary.
- Most commands lack an `icon` or `enablement`. In particular, `ds-ide.start`, `ds-ide.stop` and `ds-ide.deploy` appear in the Command Palette outside Daisy projects, because `commandPalette` menu `when` clauses are defined only for the Windows toolchain commands.

### Evidence
- `package.json:17-20` (categories), `414-423` (hardwareVariant), `54-206` (commands), `233-243` (commandPalette menu).

### Impact
Weaker marketplace discoverability; Command Palette clutter in non-Daisy workspaces.

### Affected Files
- package.json

### Recommended Fix
Drop `"Other"` from `categories`. Add `enumDescriptions` and `order` to the settings. Add `menus.commandPalette` entries with `"when": "ds-ide.isDaisyProject"` for all project-bound commands; leave `createNewEffectProject` unconditional.

### Urgency Level
LOW

### Intake Status
Pending — not yet intaken.

---

## Out of Scope

Actual marketplace publication, UX evaluation, visual design review, localization quality, third-party extension compatibility testing, end-user workflow validation, large-repo benchmarking.
