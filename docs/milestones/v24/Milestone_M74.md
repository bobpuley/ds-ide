# M74 — Editor Polish

**Version:** 0.24.1
**Status:** released
**Source:** intake session, 2026-10-01 (01_input-ideas.md; design_plan.md P1-6, P2-2; user request)

## Goal

The Wiring Editor draws five pin states with no key, the Controls Editor header carries a play/stop glyph that duplicates other status surfaces, and cards can only be placed by hand. After this milestone the Wiring Editor has a legend, the header drops the glyph, and three header buttons tidy the layout: align to grid, auto-arrange and reset positions.

## Sprint Tasks

### [x] feat: Wiring Editor legend (FR-WLG-1)

**Affected files:** `src/wiring/wiring-panel.ts`, `src/test/unit/wiring/wiring-panel.test.ts`

**DoD:**
- a legend lists every pin state the board draws, using the same classes and theme tokens as the pins
- each entry pairs its colour with a shape or label, so colour is not the only cue
- a unit test fails if a pin state class used by the board has no legend entry

---

### [x] fix: remove the play/stop marker from the Controls header (FR-CEH-1)

**Affected files:** `src/sidebar/controls-editor-panel.ts`, `src/webview/controls/convention-canvas.ts`, `src/test/unit/sidebar/controls-editor-panel.test.ts`

**DoD:**
- the header no longer contains `ce-emu-status`
- cards still dim while the emulator is stopped and undim while it runs
- the header's remaining content is unchanged

---

### [x] feat: layout helper functions and Align to grid (FR-CEH-2)

**Affected files:** `src/webview/controls/layout-helpers.ts`, `src/webview/controls/layout-actions.ts`, `src/sidebar/controls-editor-panel.ts`, `src/webview/controls-webview.ts`, `src/test/unit/webview/controls-layout-helpers.test.ts`, `src/test/unit/sidebar/controls-editor-panel.test.ts`

**DoD:**
- new pure module computes grid-snapped positions (20 px, never negative)
- an *Align to grid* header button moves every card and schedules an auto-save
- the layout buttons are enabled only in convention mode (the legacy yaml-only canvas keeps positions in its own model)
- unit tests cover rounding, negative clamping and already-aligned input

---

### [x] feat: Auto-arrange (FR-CEH-3)

**Affected files:** `src/webview/controls/layout-helpers.ts`, `src/webview/controls/convention-canvas.ts`, `src/sidebar/controls-editor-panel.ts`, `src/test/unit/webview/controls-layout-helpers.test.ts`

**DoD:**
- an *Auto-arrange* header button lays cards out in rows in controls-block order, wrapping at the canvas width, with cards not in code last
- no two cards overlap; the result is saved through auto-save
- unit tests cover ordering, wrapping and the not-in-code cards

---

### [x] feat: Reset positions (FR-CEH-4)

**Affected files:** `src/webview/controls/layout-helpers.ts`, `src/webview/controls/layout-actions.ts`, `src/webview/controls/convention-canvas.ts`, `src/sidebar/controls-editor-panel.ts`, `src/test/unit/webview/controls-layout-helpers.test.ts`, `src/test/unit/sidebar/controls-editor-panel.test.ts`

**DoD:**
- a *Reset positions* header button returns every card to the default cascade (the layout used when no position is stored)
- the default-cascade rule is shared with the canvas's first render, not duplicated
- the result is saved through auto-save; a unit test covers the cascade

---

### [x] fix: stable Scope toolbar — uniform button font, read-out off the toolbar (FR-SCI-7)

Found in manual testing: the segmented buttons used the browser's default button font, so they looked larger than the other controls, and the cursor read-out in the toolbar made it wrap onto a second row whenever the mouse moved over the plot.

**Affected files:** `src/webview/scope-panel.ts`, `src/test/unit/webview/scope-panel.test.ts`

**DoD:**
- `.seg-btn` and `.ctl-btn` share one font size and line height and never wrap their label
- the cursor read-out is an overlay in the plot's corner, so hovering never changes the toolbar's height

---

### [x] feat: 20 ms/div time base (FR-SCI-4)

Requested during manual testing. Slower bases (50 ms/div up to 1000 ms/div) are deferred: they need a larger circular ring and a roll mode without a trigger.

**Affected files:** `src/webview/scope/scope-view.ts`, `src/webview/scope/scope-capture.ts`, `src/test/unit/webview/scope-view.test.ts`, `src/test/unit/webview/scope-capture.test.ts`

**DoD:**
- the Time selector offers 20 ms/div after 10 ms/div
- the capture ring keeps 300 ms (the widest window, 200 ms, plus 100 ms of trigger headroom), tested against the widest time base so a future option cannot outgrow it

