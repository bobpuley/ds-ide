# Handoff — M22 Controls Editor bugs (in progress)

**Date:** 2026-06-20  
**Branch:** `feat/m21-run-provider` (M22 lives on this branch — name is a legacy of M21)  
**Test suite:** 341/341 passing  
**Sprint gate:** NOT yet closed — two bugs found in human testing, not yet confirmed fixed

---

## Context

M22 ("Secondary Sidebar Panels") is fully implemented in code and all unit tests pass. The
milestone moves Controls Editor and Wiring Editor from floating `WebviewPanel`s into persistent
`WebviewView`s in a DS-IDE secondary sidebar container (`ds-ide-sidebar` in the Activity Bar).

See `docs/milestones/v4/M22.md` for AC-34, AC-35 and the task checklist (T22-1 ✅, T22-2 ✅).

---

## What was changed (all uncommitted, all on branch)

| Path | What |
|------|------|
| `package.json` | Added `viewsContainers.activitybar` + `views.ds-ide-sidebar` (Controls + Wiring entries); `activationEvents` for M21 |
| `media/ds-ide-icon.svg` | New circuit-board icon for the Activity Bar entry |
| `src/sidebar/controls-view-provider.ts` | New file — `ControlsViewProvider implements WebviewViewProvider`; full Controls Editor HTML/JS extracted from the old ScopePanel |
| `src/sidebar/wiring-view-provider.ts` | New file — `WiringViewProvider implements WebviewViewProvider`; re-uses `buildHtml` from `wiring-panel.ts` |
| `src/webview/scope-panel.ts` | Stripped: removed tab bar, Controls Editor HTML/JS, `postControlsConfig`, `loadEditor`, `onPotChange`, `onButtonChange`, `onEditorSave`. `show()` simplified to `(sineParams?, audioSource?)`. Scope + Spectrum only. |
| `src/extension.ts` | Removed `WiringPanel`; added `ControlsViewProvider` + `WiringViewProvider`; `performBuildAndDeploy` + `deploy` call `controlsViewProvider.loadEditor(cfg)` and `.postControlsConfig(...)`; `status` messages forwarded to `controlsViewProvider.postStatus(msg)`; two `registerWebviewViewProvider` subscriptions (count: 17 → 19) |
| `src/__mocks__/vscode.ts` | Added `window.registerWebviewViewProvider`, `showOpenDialog`, `showSaveDialog` |
| `src/test/unit/extension.test.ts` | Subscription count updated 17 → 19 |
| `src/test/unit/webview/scope-panel.test.ts` | Rewritten: removed CE tests, updated `show()` call signatures, kept scope/spectrum/audio/recording tests |
| `src/test/unit/sidebar/controls-view-provider.test.ts` | New file |
| `src/test/unit/sidebar/wiring-view-provider.test.ts` | New file |

---

## Open bugs (sprint gate not yet closed)

### Bug 1 — Controls Editor bodies always disabled

**Symptom:** After deploying and starting audio, the control bodies (knob rotation, button press)
in the Controls Editor sidebar remain grayed out (`body-disabled` class stays on). The handles
(drag handles for rearranging) work fine.

**Expected:** After `Start Audio`, the emulator sends `status: { running: true }`. Extension
handler calls `controlsViewProvider.postStatus(msg)`, which sends `{ command: 'status', running: true }`
to the webview. The JS handler calls `updateCeEmulatorState(true)` → removes `body-disabled`.

**Suspected causes (in order of likelihood):**
1. **User didn't rebuild before retesting.** The fix to `loadEditor` + `pendingEditorCfg` in
   `controls-view-provider.ts` was not compiled. Run `npm run compile` inside the extension
   and reload VS Code (`Developer: Reload Window`) before retesting.
2. **Timing race on first sidebar open.** If the sidebar is opened right after the HTML is set
   but before the JS sends `webviewReady`, messages sent via `this.view?.webview.postMessage`
   could be lost. The `_flush` on `webviewReady` should recover this, but check the order.
3. **The emulator never sends `status: { running: true }`.** The ScopePanel scope view's header
   should show "▶ Running" if audio is running. If the scope header shows "Running" but the CE
   is still disabled, the routing is broken. If the scope header also shows "Stopped", the
   emulator hasn't confirmed audio start.

**Key files to inspect:**
- `src/sidebar/controls-view-provider.ts` — `postStatus`, `_flush`, `updateCeEmulatorState` in the HTML JS
- `src/extension.ts` lines ~200–220 — the `manager.on('message', ...)` handler that calls `controlsViewProvider?.postStatus(msg)`

### Bug 2 — `controllers.yaml` saves as empty

**Symptom:** Clicking "Save controllers.yaml" in the Controls Editor sidebar produces an empty (or
missing entries) file even when controls are displayed.

**Root cause (confirmed):** In convention mode (`missingBlock = false`), the save handler reads
`_yamlCfg.pots/buttons/leds` (initialized to `[]`). `_yamlCfg` is only populated via the
`editorLoad` JS message. Previously `loadEditor(cfg)` was never called during `deploy` — only
during `openControllerEditor`.

**Fix applied (in this session):**
1. `ControlsViewProvider` now stores `pendingEditorCfg` and flushes it in `_flush` (before
   `controlsConfig`, so `_yamlCfg` is set before `renderConventionCanvas` runs).
2. `extension.ts` — both `performBuildAndDeploy` and `ds-ide.deploy` now call
   `controlsViewProvider!.loadEditor(cfg)` before `postControlsConfig`.

**The fix was not confirmed** by the user — they said "nothing was fixed, stop for now". Most
likely they didn't rebuild+reload before retesting. Verify by running `npm run compile` and
reloading VS Code.

---

## How to continue

1. Run `npm run compile` inside `/Users/marcopugliese/workspaces/daisy/ds-ide`
2. Reload the VS Code extension host (`Developer: Reload Window` or `F1 → Reload Window`)
3. Open a ds-ide project, run Deploy to Emulator, then Start Audio
4. Check:
   - Scope header shows "▶ Running"
   - Controls Editor sidebar bodies are no longer grayed (knobs turnable)
   - Click "Save controllers.yaml" → file has correct pot/button/led entries

If Bug 1 persists after rebuild: add temporary `console.log` (Extension Host debug console) in
`ControlsViewProvider.postStatus` and in the HTML's `window.addEventListener('message', ...)` handler
to trace whether the status message is being sent and received.

If Bug 2 persists after rebuild: add a `console.log` in the `editorLoad` JS handler
(`editorLoad(msg.cfg)`) to confirm `_yamlCfg` is being set.

---

## Sprint gate to close M22

After all bugs are confirmed fixed:
1. Collect human-driven test feedback (ACs 34, 35 + regression AC-20,21,24,25,27,28,31)
2. If all green:
   - Merge branch into main
   - Inspect tags (`git tag --list --sort=v:refname`)
   - Propose next semver (currently 0.4.2 released → 0.4.3)
   - Update CHANGELOG.md + commit
   - Create annotated tag + push

---

## Suggested skills

- `/doc-creator-driver:implement` — this skill drives the full implement→test→human-gate→merge→tag
  workflow; invoke it (it will pick up M22 as the in-progress milestone from `docs/05_dev-plan.md`)
- `/typescript-expert` — if you need TypeScript-specific guidance on the webview messaging or
  provider pattern
