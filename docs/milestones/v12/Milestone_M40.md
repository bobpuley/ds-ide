# M40 — Extension UX & Workspace Safety

**Version:** 0.13.2
**Status:** planned
**Source:** 2026-07-02 VS Code extension code review — MEDIUM findings

## Goal

Fix the UX and workspace-safety gaps that erode user trust without being outright crashes: leaked output channels, notification fatigue that drowns out genuinely important warnings, edits that can escape the workspace or mangle a customized source file, multi-root workspace mishandling, and unthrottled real-time input flooding persisted storage. After M40, notifications are proportionate, output channels don't accumulate, wiring edits stay inside the workspace and target only their marker ranges, multi-root save routing is correct, and dragging a knob doesn't hammer `workspaceState`.

## Sprint Tasks

### [ ] fix: Create output channels once and track them in `context.subscriptions` (FR-UX-1)

`flashToHardware` creates a new `"Daisy IDE Flash"` channel on every invocation and never disposes it; `buildForHardware` has the same latent fallback.

**Affected files:** `src/commands/dfu-flash.ts`, `src/commands/hardware-build.ts`, `src/extension.ts`

**DoD:**
- The `"Daisy IDE Flash"` channel is created once in `activate()`, registered in `context.subscriptions`, and passed into `flashToHardware`
- `buildForHardware`'s channel parameter is made required, removing the per-call fallback
- Flashing to hardware 10 times in one session leaves exactly one `"Daisy IDE Flash"` entry in the Output panel dropdown

---

### [ ] fix: Aggregate and deduplicate notifications; report emulator connection state honestly (FR-UX-2)

`loadControllerConfig` shows one warning toast per validation error from six-plus call sites, including the save listener that fires on every relevant save; transport commands show unconditional "audio started/stopped" toasts even when no emulator is connected; routine build/deploy successes duplicate the status bar with extra toasts.

**Affected files:** `src/extension.ts`, `src/commands/transport.ts`, `src/commands/build.ts`, `src/commands/deploy.ts`

**DoD:**
- YAML validation errors are aggregated into a single warning (or published to a `DiagnosticCollection` with no toast), deduplicated across repeated saves of unchanged errors
- `EmulatorManager` exposes an `isConnected` getter; transport commands show a "no emulator running" warning instead of a false success toast when disconnected
- Routine build/deploy success relies on the status bar; redundant success toasts are removed
- A `controllers.yaml` with 5 validation errors produces at most one toast per distinct error set, not one per save

---

### [ ] fix: Contain Wiring Editor edits to the workspace and to marker ranges (FR-UX-3)

`ds-ide.effectSource` accepts an absolute path with no containment check (settable via a committed `.vscode/settings.json`), letting a crafted project redirect edits outside the workspace; `makeBlockEdit` also replaces the **entire document** whenever a marker pair is missing.

**Affected files:** `src/commands/find-effect-source.ts`, `src/extension.ts`, `src/wiring/controls-writer.ts`

**DoD:**
- `findEffectSource` rejects a configured `effectSource` path that resolves outside any workspace folder, with an actionable error
- The full-file-replacement fallback is replaced by a one-time modal confirmation before appending marker blocks to a file that has none
- No edit rewrites lines outside the marker ranges once markers exist
- A workspace-committed `settings.json` pointing `effectSource` outside the workspace produces an error, not a silent edit

---

### [ ] fix: Route multi-root workspace resolution through proper URI semantics (FR-UX-4)

Every workspace-dependent operation hardcodes `workspaceFolders[0]`; the save-listener's "in workspace" check (`saved.startsWith(folder)`) is prefix-unsafe and false-positives sibling directories.

**Affected files:** `src/extension.ts`, `src/commands/build.ts`

**DoD:**
- The save listener uses `vscode.workspace.getWorkspaceFolder(doc.uri)` (or a prefix check that respects `path.sep` boundaries) instead of raw `startsWith`
- Project-root resolution is centralized in one helper
- When multiple folders exist, the user can select which folder ds-ide operates on (quick-pick, persisted in `workspaceState`) instead of always folder 0
- A save in a sibling directory sharing a path prefix with the active project folder does not trigger ds-ide's save-listener logic

---

### [ ] fix: Debounce `workspaceState` persistence for real-time control drags (FR-UX-5)

Dragging a Controls-webview knob posts a `pot` message on every mousemove (~60–120 Hz); each message triggers a full `workspaceState` read-modify-write persisted write plus an IPC send with no throttling.

**Affected files:** `src/webview/controls-webview.ts`, `src/webview/scope-webview.ts`, `src/controllers/pot-store.ts`, `src/extension.ts`

**DoD:**
- IPC sends continue at input rate (real-time responsiveness preserved)
- `workspaceState` persistence is debounced — flushed on `mouseup` or after ~250ms idle, not per mousemove
- Webview-side mousemove updates are coalesced with `requestAnimationFrame`
- A 5-second continuous knob drag produces at most ~20 `workspaceState.update` calls
