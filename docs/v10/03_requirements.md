# 03 — Requirements (v10)

> **v9 complete** — all v9 requirements implemented; ACs green.
> Archived: [`docs/v9/03_requirements.md`](v9/03_requirements.md).

## v10 Requirements

All requirements below are from the 2026-06-29 intake. See `01_input-ideas.md` for the raw ideas.

---

### Scope Panel — Audio Settings Always Visible (M34)

**FR-SCOPE-1 — Audio Settings section is always expanded**
The `#emulator-section` collapsible in the Daisy Scope HTML must be replaced with a permanently visible section. The `.coll-header` toggle button, `.coll-arrow`, `collapsed` CSS class, and the `aria-expanded` toggle script must all be removed. The audio source selector and related controls render inline, always visible, without a disclosure widget.
AC: The Daisy Scope panel shows the audio settings controls at all times; there is no arrow, no toggle, and no way to hide the section; the panel HTML contains no `.coll-section`, `.coll-header`, or `.coll-body` elements.

---

### Independent Sidebar Views (M35) — replaces M34 FR-TWE-1 through FR-TWE-6 and FR-ICON-1 through FR-ICON-2

**FR-TWE-1 — Controls Editor lives in its own Activity Bar sidebar container**
A new `viewsContainers.activitybar` entry (`"id": "ds-ide-controls"`) is added to `package.json` with the knob SVG as its icon. `ControlsViewProvider` (implements `WebviewViewProvider`) is re-registered under `contributes.views["ds-ide-controls"]` with view id `'ds-ide.controlsEditor'`. The Controls Editor renders inside the Primary Sidebar when the user clicks the knob icon in the Activity Bar.
AC: clicking the knob icon in the Activity Bar reveals the Controls Editor in the sidebar; the editor does not open as a tab in the editor area.

**FR-TWE-2 — Wiring Editor lives in its own Activity Bar sidebar container**
A new `viewsContainers.activitybar` entry (`"id": "ds-ide-wiring"`) is added to `package.json` with the DIP chip SVG as its icon. `WiringViewProvider` (implements `WebviewViewProvider`) is re-registered under `contributes.views["ds-ide-wiring"]` with view id `'ds-ide.wiringEditor'`. The Wiring Editor renders inside the Primary Sidebar when the user clicks the DIP chip icon.
AC: clicking the DIP chip icon reveals the Wiring Editor in the sidebar; both editors can be active simultaneously (each in its own sidebar slot) when both Activity Bar icons are selected.

**FR-TWE-3 — Controls Editor auto-reveals on deploy/play**
On emulator start, the extension executes `vscode.commands.executeCommand('ds-ide.controlsEditor.focus')` (or the equivalent `workbench.view.extension.ds-ide-controls` command) to reveal the Controls Editor sidebar panel. The existing trigger point (`deployToEmulator` / `performBuildAndDeploy`) is updated to use this command.
AC: pressing Play focuses the Controls Editor in the Activity Bar sidebar; if the panel is already visible, it is revealed in-place.

**FR-TWE-4 — Single DS-IDE Activity Bar launcher icon and sidebar welcome view are removed**
The original `ds-ide-sidebar` `viewsContainers.activitybar` entry (the generic DS-IDE icon with the launcher welcome view) is removed from `package.json`. The `ds-ide.openControlsEditor` and `ds-ide.openWiringEditor` commands introduced in M34 are removed (access is now via Activity Bar icons directly). The `ds-ide.launchView` view entry is removed from `contributes.views`.
AC: the Activity Bar contains no generic DS-IDE launcher icon; it has only the two dedicated editor icons (knob and DIP chip).

**FR-TWE-5 — `collapseSibling` and related dead code remain absent**
The `collapseSibling` function, `onDidChangeVisibility` subscriptions, and `CONTROLS_VIEW_ID` / `WIRING_VIEW_ID` export constants were deleted in M34 and must not be reintroduced. With two separate view containers, mutual-exclusion logic is not needed.
AC: `extension.ts` contains no reference to `collapseSibling`, `workbench.action.collapseSection`, or any mutual-exclusion mechanism for the two editors.

**FR-TWE-6 — View state is maintained across sidebar hide/show and synced from host on reload**
`WebviewView` instances are hidden (not disposed) when the user switches away from their Activity Bar icon; state in the webview naturally persists. The extension host (`EmulatorManager` or a dedicated state store) retains the last-known `ControlsConfig` and wired-pin set. On `onDidChangeVisibility` becoming `true`, if the view was recreated (e.g. after a window reload), the host pushes the stored state to the webview.
AC: switching away from the Controls Editor Activity Bar icon and back preserves pot positions without a redeploy; reloading VS Code and reopening the Controls Editor also restores last-known pot positions.

---

### Activity Bar Icons (M35) — replaces M34 FR-ICON-1 through FR-ICON-2

**FR-ICON-1 — Controls Editor Activity Bar icon is the knob/potentiometer SVG**
The existing `media/controls-editor-icon-dark.svg` (or a single-path variant) is declared as the `"icon"` for the `"ds-ide-controls"` `viewsContainers.activitybar` entry in `package.json`. The `iconPath` property on any `WebviewPanel` for the Controls Editor is removed (panels are no longer used).
AC: the Activity Bar shows a knob icon that, when clicked, opens the Controls Editor sidebar; the icon is distinguishable from the Wiring Editor icon at a glance.

**FR-ICON-2 — Wiring Editor Activity Bar icon is the DIP chip / IC package SVG**
The existing `media/wiring-editor-icon-dark.svg` (or a single-path variant) is declared as the `"icon"` for the `"ds-ide-wiring"` `viewsContainers.activitybar` entry in `package.json`. The `iconPath` on any Wiring Editor `WebviewPanel` is removed.
AC: the Activity Bar shows a DIP chip icon that, when clicked, opens the Wiring Editor sidebar; the icon is visually distinct from the Controls Editor knob icon.
