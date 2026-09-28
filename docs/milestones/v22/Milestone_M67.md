# M67 — Stateful Transport on Native Surfaces

**Version:** 0.20.2
**Status:** planned
**Source:** feature intake session, 2026-09-28 (design_plan.md §5.5; mockup docs/mockups/v22-transport-actions.html)

## Goal

Make "run my effect" a visible, stateful thing instead of eight palette commands and a status
item that does nothing when clicked. Ctrl+F5 becomes a real session, so VS Code's own toolbar
gives Stop and Restart. An editor-title ▶ and a Daisy view in Run and Debug make Run, Debug and
Flash discoverable. After this milestone, the user can always see whether the emulator is
stopped, building, running, debugging, failed or crashed, and act on it from where they are
looking, without any custom-coloured UI.

## Sprint Tasks

### [x] feat: pure transport state model (FR-TRN-5)

Status-bar text is written from 7 separate places in `extension.ts`, so no single component
knows the transport state.

**Affected files:** `src/transport/transport-state.ts`, `src/test/unit/transport/transport-state.test.ts`

**DoD:**
- `TransportState` + reducer covering stopped / building / deploying / running / debugging / paused / buildFailed / crashed, `mode` (run/debug), problem count, `stale`, and board
- events: deploy started / failed (with problem count) / succeeded, session started / ended, emulator exited / crashed, source saved, board detected / not detected
- no `vscode` import; unit-tested for every transition, including a save while stopped (not stale) and a save while running (stale); `npm test` green

---

### [x] feat: Ctrl+F5 starts a real run session (FR-TRN-1)

Today `resolveDebugConfiguration` returns `undefined` for `noDebug`, so a run creates no
session: no toolbar, no Stop.

**Affected files:** `src/debug/run-config-provider.ts`, `src/debug/run-session-adapter.ts`, `src/extension.ts`, `src/test/unit/debug/run-config-provider.test.ts`, `src/test/unit/debug/run-session-adapter.test.ts`

**DoD:**
- `noDebug`: build + deploy + start audio, then return the config so a live `ds-ide` session starts, backed by the new `run-session-adapter` (stays alive; `disconnect`/`terminate` stop the emulator; an emulator exit sends `terminated`)
- the floating debug toolbar shows Restart / Stop during a run; ⇧F5 stops
- no orphans in any ordering: user stop, emulator crash, window reload, second launch while running (unit tests per ordering)
- F5 debug path unchanged (`daisy-debug` hand-off); all existing commands and keybindings unchanged
- `npm test` green; `npm run test:e2e` still green

---

### [x] feat: Restart rebuilds and redeploys (FR-TRN-2)

**Affected files:** `src/debug/run-session-adapter.ts`, `src/debug/run-config-provider.ts`, `src/test/unit/debug/run-session-adapter.test.ts`

**DoD:**
- the adapter declares no `supportsRestartRequest`, so ↻ / ⇧⌘F5 terminates and relaunches through `resolveDebugConfiguration` (rebuild + redeploy) in the same mode, for run and for debug
- manual check: a saved edit is running after Restart; a build error during Restart ends the session and surfaces per FR-TRN-6
- `npm test` green

> **Implementation decision (2026-09-29, user-approved, "adapter-owned Restart"):** VS Code's Restart
> re-runs `resolveDebugConfiguration` only when launch.json changed; otherwise it resends `launch`
> with the already-resolved config. So `resolveDebugConfiguration` stamps each config with a one-time
> `__dsIdeLaunchId`, and the adapter rebuilds + redeploys itself when a launch's id was already
> consumed. For F5, the `ds-ide` session now stays live too and attaches `daisy-debug` as its child
> (`parentSession`, `lifecycleManagedByParent: true`), so the debug toolbar's ↻ / ■ reach the ds-ide
> session. `DsIdeTerminatingAdapter` is removed (every ds-ide session is live). This deviates from
> 04_architecture's "debug path unchanged / terminating adapter stays" wording.

---

### [x] feat: editor-title ▶ with Run / Debug / Flash (FR-TRN-3)

**Affected files:** `package.json`, `src/extension.ts`, `src/test/unit/extension.test.ts`

**DoD:**
- new commands `ds-ide.runEffect` (startDebugging with `noDebug: true`), `ds-ide.debugEffect`, `ds-ide.buildAndFlash`
- contributed to `editor/title/run` with `when` = `ds-ide.isDaisyProject && ds-ide.isEffectSource`; the new `ds-ide.isEffectSource` context key tracks the active editor
- not shown on other files or in non-Daisy workspaces
- `npm test` green; manual check that VS Code remembers the last-used action

---

### [x] feat: Daisy view in the Run and Debug container (FR-TRN-4)

**Affected files:** `package.json`, `src/views/daisy-view.ts`, `src/transport/transport-controller.ts`, `src/extension.ts`, `src/test/unit/views/daisy-view.test.ts`

**DoD:**
- `views.debug` contributes `ds-ide.daisyView` (`when: ds-ide.isDaisyProject`), a native `TreeDataProvider` with Emulator (state + detail), Source changed (only when stale, with *Restart to apply*) and Board rows; `ThemeIcon` / `ThemeColor` only
- `view/title` actions Run / Debug / Stop-or-Cancel / ⚡ Build & Flash / Refresh / Show Emulator Output, with visibility driven by the `ds-ide.transportPhase` context key; build-for-hardware-only reachable from the view
- build / deploy / hardware work shows progress on the view (`withProgress` with the view's id) alongside the existing notification
- `npm test` green; manual check in light and dark themes

---

### [x] feat: status bar reduced to a clickable state item + Flash (FR-TRN-5)

**Affected files:** `src/transport/transport-controller.ts`, `src/extension.ts`, `src/test/unit/extension.test.ts`

**DoD:**
- all 7 direct `statusBar.text` writes in `extension.ts` replaced by `transport-controller` rendering from `TransportState`
- state item `Daisy: <state>` with `command` assigned: build failed → `statusBarItem.errorBackground`, opens Problems; crashed → `statusBarItem.warningBackground`, opens Emulator output; otherwise reveals the Daisy view; *restart to apply* when stale; fidelity-caveat tooltip kept
- ⚡ Flash item (shows `no board` when detection found none); both items have their own id/name and are hidden outside Daisy projects; no status-bar Run / Stop
- `npm test` green

---

### [x] feat: surface build failures and crashes (FR-TRN-6)

**Affected files:** `src/transport/transport-controller.ts`, `src/debug/run-config-provider.ts`, `src/test/unit/transport/transport-controller.test.ts`

**DoD:**
- a failed build (run, debug or restart): error notification "Build failed with N problems. Nothing was deployed." with *Show Problems*; view and state item show *build failed*; errors reach Problems through the existing diagnostics path (unchanged)
- an emulator crash: error notification with *Show Output* and *Debug*; view and state item show *crashed*
- `npm test` green

---

### [x] feat: Build & Flash with on-demand board detection (FR-TRN-7)

No part of ds-ide detects a board today; `dfu-flash.ts` just runs `dfu-util` and reports.

**Affected files:** `src/hardware/board-detect.ts`, `src/commands/dfu-flash.ts`, `src/extension.ts`, `src/test/unit/hardware/board-detect.test.ts`

**DoD:**
- pure `parseDfuList(stdout)` unit-tested against real `dfu-util -l` output (board present, absent, several devices); `detectBoard()` resolves `dfu-util` through `src/hardware/toolchain.ts`
- detection runs on Daisy-view visibility, on Refresh, and immediately before flashing; no polling
- `ds-ide.buildAndFlash` asks for modal confirmation naming the project and the detected board, then reuses the existing `buildHardware` + `flash` paths with cancellable progress
- no board: warning with BOOT + RESET instructions and *Retry*; no hardware build is started
- `npm test` green; manual check with and without a board in DFU mode
