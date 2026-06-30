# 04 — Architecture (v10)

> **v9 complete** — full v9 architecture in
> [`docs/v9/04_architecture.md`](v9/04_architecture.md).

## v10 Architecture Notes

### Overall system design — unchanged

The two-process architecture (VS Code extension ↔ native emulator process over a UNIX domain socket) is unchanged from v9. No new IPC message types, no new processes, and no emulator changes are required for v10. All v10 changes are confined to the VS Code extension layer.

---

### Controls Editor and Wiring Editor: WebviewView per Activity Bar container (M35 revision)

**v9 model (reference):**
```
ActivityBar DS-IDE icon
  └── ds-ide-sidebar (WebviewViewContainer)
        ├── ds-ide.controlsEditor  (WebviewViewProvider → ControlsViewProvider)
        └── ds-ide.wiringEditor    (WebviewViewProvider → WiringViewProvider)
```
The two panels were stacked in the sidebar; a `collapseSibling` workaround enforced mutual exclusion.

**M34 model (shipped at 0.10.0, superseded by M35):**
```
ActivityBar DS-IDE icon
  └── ds-ide-sidebar (WebviewViewContainer)
        └── ds-ide.launchView  (welcome view — two buttons)

Editor area (user-positioned):
  ├── [WebviewPanel] Controls Editor  (vscode.window.createWebviewPanel)
  └── [WebviewPanel] Wiring Editor    (vscode.window.createWebviewPanel)
```

**M35 model (current target):**
```
ActivityBar knob icon (controls-editor-icon-dark.svg)
  └── ds-ide-controls (WebviewViewContainer)
        └── ds-ide.controlsEditor  (WebviewViewProvider → ControlsViewProvider)

ActivityBar DIP chip icon (wiring-editor-icon-dark.svg)
  └── ds-ide-wiring (WebviewViewContainer)
        └── ds-ide.wiringEditor    (WebviewViewProvider → WiringViewProvider)
```

Key changes from M34 → M35:
- `ControlsViewProvider` and `WiringViewProvider` are restored as `WebviewViewProvider` implementations (no `createWebviewPanel` calls for editors).
- `package.json` gains two `viewsContainers.activitybar` entries (`"ds-ide-controls"` and `"ds-ide-wiring"`), each with its respective SVG icon.
- The old `"ds-ide-sidebar"` view container entry and the `"ds-ide.launchView"` view entry are removed.
- `activate()` in `extension.ts` calls `registerWebviewViewProvider` for both Controls and Wiring (under their respective containers). The M34 `ds-ide.openControlsEditor` / `ds-ide.openWiringEditor` commands are removed.
- Auto-reveal on deploy uses `vscode.commands.executeCommand('workbench.view.extension.ds-ide-controls')` (or `ds-ide.controlsEditor.focus`) rather than `createOrReveal()`.
- No mutual-exclusion logic is needed: each editor has its own sidebar slot.

**State ownership:**
State (ControlsConfig, wired pins) remains in `EmulatorManager`. `WebviewView` instances are hidden (not disposed) when the user switches away; state persists in the webview across hide/show. On `onDidChangeVisibility → true`, if the view was recreated (window reload), the host pushes last-known state to the webview.

**View lifecycle:**
- Controls Editor: revealed on emulator deploy (via focus command) and when user clicks knob Activity Bar icon.
- Wiring Editor: revealed only when user clicks DIP chip Activity Bar icon. No auto-reveal on deploy.

---

### Scope Panel — Audio Settings section

The collapsible `#emulator-section` (`coll-section` / `coll-header` / `coll-body` CSS pattern) was replaced with a plain `<div>` section in M34. All JavaScript toggling `aria-expanded` and the `collapsed` class was removed. This change is complete and unchanged in M35.

---

### Icons

The SVG files created in M34 are reused in M35 as Activity Bar icons (declared in `viewsContainers.activitybar`), not as `WebviewPanel.iconPath`:

| File | Used as |
|------|---------|
| `media/controls-editor-icon-dark.svg` | Activity Bar icon for `ds-ide-controls` container |
| `media/controls-editor-icon-light.svg` | (retained, may be referenced by `iconPath` if needed elsewhere) |
| `media/wiring-editor-icon-dark.svg` | Activity Bar icon for `ds-ide-wiring` container |
| `media/wiring-editor-icon-light.svg` | (retained) |

`viewsContainers.activitybar` accepts a single `"icon"` path; VS Code applies theme tinting automatically. The `WebviewPanel.iconPath` property is no longer used for the editors.
