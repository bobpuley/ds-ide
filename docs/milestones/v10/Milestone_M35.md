# M35 — Activity Bar Split: Controls and Wiring as Independent Sidebar Views

**Status:** planned
**Target version:** 0.11.0

---

## Goals

Revise the M34 editor navigation design: replace the single DS-IDE Activity Bar icon (with a sidebar welcome view that opened `WebviewPanel` tabs in the editor area) with two dedicated Activity Bar icons — one for the Controls Editor (knob) and one for the Wiring Editor (DIP chip). Clicking each icon shows the corresponding editor directly in the Primary Sidebar as a `WebviewView`.

---

## Sprint Tasks

- [x] **FR-TWE-1** — Add `ds-ide-controls` view container and restore `ControlsViewProvider` as `WebviewViewProvider`
  - Add a `viewsContainers.activitybar` entry `"id": "ds-ide-controls"`, `"title": "Controls Editor"`, `"icon": "media/controls-editor-icon-dark.svg"` to `package.json`.
  - Add a `contributes.views["ds-ide-controls"]` entry with `"id": "ds-ide.controlsEditor"`, `"type": "webview"`, `"name": "Controls Editor"`.
  - Re-register `ControlsViewProvider` (implements `WebviewViewProvider`) in `activate()` via `registerWebviewViewProvider('ds-ide.controlsEditor', ...)`.
  - Remove any `createWebviewPanel` call used for the Controls Editor (introduced in M34).
  - DoD: clicking the knob icon in the Activity Bar reveals the Controls Editor in the sidebar; editor does not open as an editor-area tab.

- [x] **FR-TWE-2** — Add `ds-ide-wiring` view container and restore `WiringViewProvider` as `WebviewViewProvider`
  - Add a `viewsContainers.activitybar` entry `"id": "ds-ide-wiring"`, `"title": "Wiring Editor"`, `"icon": "media/wiring-editor-icon-dark.svg"` to `package.json`.
  - Add a `contributes.views["ds-ide-wiring"]` entry with `"id": "ds-ide.wiringEditor"`, `"type": "webview"`, `"name": "Wiring Editor"`.
  - Re-register `WiringViewProvider` (implements `WebviewViewProvider`) in `activate()` via `registerWebviewViewProvider('ds-ide.wiringEditor', ...)`.
  - Remove any `createWebviewPanel` call used for the Wiring Editor (introduced in M34).
  - DoD: clicking the DIP chip icon reveals the Wiring Editor in the sidebar; both editors can be open simultaneously in their respective sidebar slots.

- [x] **FR-TWE-3** — Controls Editor auto-reveals on deploy/play via focus command
  - In `deployToEmulator` / `performBuildAndDeploy`: replace the M34 `ControlsEditorPanel.createOrReveal(...)` call with `vscode.commands.executeCommand('workbench.view.extension.ds-ide-controls')` (or the equivalent `ds-ide.controlsEditor.focus` if registered).
  - DoD: pressing Play focuses the Controls Editor in the Activity Bar sidebar; the knob icon becomes active.

- [x] **FR-TWE-4** — Remove M34 launcher container, welcome view, and open commands
  - Remove `"ds-ide-sidebar"` from `contributes.viewsContainers.activitybar` in `package.json`.
  - Remove the `"ds-ide.launchView"` entry from `contributes.views["ds-ide-sidebar"]`.
  - Remove `ds-ide.openControlsEditor` and `ds-ide.openWiringEditor` command registrations from `activate()` and from `contributes.commands` in `package.json`.
  - DoD: `package.json` contains no `"ds-ide-sidebar"` container entry; `extension.ts` registers no `openControlsEditor` / `openWiringEditor` commands.

- [x] **FR-TWE-5** — Confirm absence of `collapseSibling` and mutual-exclusion code
  - Verify (and document in code review checklist) that `collapseSibling`, `onDidChangeVisibility` mutual-exclusion subscriptions, and `CONTROLS_VIEW_ID` / `WIRING_VIEW_ID` remain absent. No new mutual-exclusion logic is introduced.
  - DoD: `extension.ts` contains no reference to `collapseSibling`, `workbench.action.collapseSection`, or any mutual-exclusion mechanism for the two editors.

- [x] **FR-TWE-6** — State sync on `onDidChangeVisibility`
  - In `ControlsViewProvider.resolveWebviewView` and on `onDidChangeVisibility → true`: push last-known `ControlsConfig` from `EmulatorManager` to the webview via `postMessage`.
  - Same pattern for `WiringViewProvider` with wired-pin set.
  - DoD: switching away from the Controls Editor Activity Bar icon and back preserves pot positions without redeploy; reloading VS Code and re-opening the Controls Editor restores last-known pot positions.

- [x] **FR-ICON-1** — Wire knob SVG as Activity Bar icon for `ds-ide-controls`
  - `"icon": "media/controls-editor-icon-dark.svg"` in the `viewsContainers.activitybar` entry for `ds-ide-controls`.
  - No `WebviewPanel.iconPath` needed for Controls Editor.
  - DoD: Activity Bar shows the knob icon; clicking it opens the Controls Editor sidebar.

- [x] **FR-ICON-2** — Wire DIP chip SVG as Activity Bar icon for `ds-ide-wiring`
  - `"icon": "media/wiring-editor-icon-dark.svg"` in the `viewsContainers.activitybar` entry for `ds-ide-wiring`.
  - DoD: Activity Bar shows the DIP chip icon; clicking it opens the Wiring Editor sidebar; icon is visually distinct from the knob icon.
