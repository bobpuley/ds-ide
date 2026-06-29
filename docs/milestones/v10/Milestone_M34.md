# M34 — UI Polish: Independent Editors, Always-Visible Audio Settings, Panel Icons

**Status:** complete  
**Target version:** 1.0.0

---

## Goals

- Remove the collapsible toggle from the Daisy Scope Audio Settings footer — section is always visible.
- Promote Controls Editor and Wiring Editor from sidebar WebviewView panels to independent WebviewPanel tool windows the user can freely reposition.
- Assign distinct, meaningful icons (knob + pin-header) to the two editor panels.

---

## Sprint Tasks

- [x] **FR-SCOPE-1** — Remove collapsible from Scope Audio Settings section
  - In `src/webview/scope-panel.ts`: delete `.coll-section`, `.coll-header`, `.coll-arrow`, `.coll-body` CSS; replace `<div class="coll-section" id="emulator-section">…</div>` with a plain always-visible `<div id="emulator-section">…</div>`; remove the JS toggle handler (`emulator-header` click/keydown listener, `aria-expanded` logic).
  - DoD: Daisy Scope renders with audio settings always visible; no toggle arrow; no JS collapse logic; no `.coll-*` CSS classes remain.

- [x] **FR-TWE-1 / FR-TWE-2** — Refactor Controls Editor and Wiring Editor to `WebviewPanel`
  - Replace `ControlsViewProvider` (implements `WebviewViewProvider`) with a `ControlsEditorPanel` module exposing `createOrReveal(context, emulatorManager): void`.
  - Replace `WiringViewProvider` (implements `WebviewViewProvider`) with a `WiringEditorPanel` module exposing `createOrReveal(context, emulatorManager): void`.
  - Each `createOrReveal` calls `vscode.window.createWebviewPanel('ds-ide.controlsEditor', 'Controls Editor', ViewColumn.Beside, {...})` (or reveals the existing panel if already open) and wires up message handlers.
  - Remove `registerWebviewViewProvider` calls from `activate()`.
  - Remove the `ds-ide.controlsEditor` and `ds-ide.wiringEditor` view entries from `package.json` `contributes.views["ds-ide-sidebar"]`.
  - DoD: Controls Editor and Wiring Editor open as tabs in the editor area; both can be visible simultaneously in different editor groups; sidebar no longer contains the panel content.

- [x] **FR-TWE-3** — Controls Editor auto-opens on deploy/play
  - In `deployToEmulator` / `performBuildAndDeploy`: replace the old `controlsViewProvider.reveal()` call (if any) with `ControlsEditorPanel.createOrReveal(...)`.
  - DoD: pressing Play creates/reveals the Controls Editor tab; if already open, it is revealed in-place.

- [x] **FR-TWE-4** — DS-IDE sidebar becomes a launcher welcome view
  - Add a `ds-ide.launchView` entry to `package.json` `contributes.views["ds-ide-sidebar"]` (or use a `viewsWelcome` contribution with two buttons).
  - Register `ds-ide.openControlsEditor` and `ds-ide.openWiringEditor` commands; each calls the corresponding `createOrReveal`.
  - DoD: clicking the DS-IDE sidebar icon shows a welcome view with "Open Controls Editor" and "Open Wiring Editor" actions; each opens the corresponding editor panel.

- [x] **FR-TWE-5** — Delete `collapseSibling` and related dead code
  - Delete: `collapseSibling` function, both `onDidChangeVisibility` subscriptions, `CONTROLS_VIEW_ID` / `WIRING_VIEW_ID` export constants, any import of `WebviewViewProvider` used only for Controls/Wiring.
  - DoD: `extension.ts` contains no reference to `collapseSibling`, `workbench.action.collapseSection`, or `registerWebviewViewProvider` for Controls/Wiring.

- [x] **FR-TWE-6** — Panel state restoration on reopen
  - `EmulatorManager` (or a new `ControlsState` / `WiringState` store) retains last-known `ControlsConfig` and wired-pin set.
  - `ControlsEditorPanel.createOrReveal` pushes stored state to a newly created panel via `panel.webview.postMessage`.
  - `WiringEditorPanel.createOrReveal` does the same for wired pins.
  - DoD: close Controls Editor after assigning pots → reopen → pots are restored to their last positions without re-deploying.

- [x] **FR-ICON-1** — Create Controls Editor knob icon (dark + light SVG)
  - Create `media/controls-editor-icon-dark.svg` and `media/controls-editor-icon-light.svg`.
  - Icon: circular knob (outer ring) with a position indicator line pointing up, 16×16 viewBox.
  - Set `iconPath: { light: ..., dark: ... }` in `ControlsEditorPanel.createOrReveal`.
  - DoD: Controls Editor tab shows the knob icon in both dark and light VS Code themes.

- [x] **FR-ICON-2** — Create Wiring Editor DIP chip icon (dark + light SVG)
  - Create `media/wiring-editor-icon-dark.svg` and `media/wiring-editor-icon-light.svg`.
  - Icon: vertical DIP IC package — tall narrow rectangle (body: x=6 y=1 w=5 h=13 rx=1) with 4 pins on the left (cx=4, cy=3/6/9/12) and 4 pins on the right (cx=13, cy=3/6/9/12). Dark variant uses stroke/fill `#C5C5C5`; light variant uses `#424242`.
  - Set `iconPath: { light: ..., dark: ... }` in `WiringEditorPanel.createOrReveal`.
  - DoD: Wiring Editor tab shows the IC package icon; icon is visually distinct from the Controls Editor knob icon.
