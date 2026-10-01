# M74 — Editor Polish

**Version:** 0.24.1
**Status:** in progress
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

### [ ] fix: remove the play/stop marker from the Controls header (FR-CEH-1)

**Affected files:** `src/sidebar/controls-editor-panel.ts`, `src/webview/controls/convention-canvas.ts`, `src/test/unit/sidebar/controls-editor-panel.test.ts`

**DoD:**
- the header no longer contains `ce-emu-status`
- cards still dim while the emulator is stopped and undim while it runs
- the header's remaining content is unchanged

---

### [ ] feat: layout helper functions and Align to grid (FR-CEH-2)

**Affected files:** `src/webview/controls/layout-helpers.ts`, `src/sidebar/controls-editor-panel.ts`, `src/webview/controls-webview.ts`, `src/test/unit/webview/controls-layout-helpers.test.ts`

**DoD:**
- new pure module computes grid-snapped positions (20 px, never negative)
- an *Align to grid* header button moves every card and schedules an auto-save
- unit tests cover rounding, negative clamping and already-aligned input

---

### [ ] feat: Auto-arrange (FR-CEH-3)

**Affected files:** `src/webview/controls/layout-helpers.ts`, `src/webview/controls/convention-canvas.ts`, `src/sidebar/controls-editor-panel.ts`, `src/test/unit/webview/controls-layout-helpers.test.ts`

**DoD:**
- an *Auto-arrange* header button lays cards out in rows in controls-block order, wrapping at the canvas width, with cards not in code last
- no two cards overlap; the result is saved through auto-save
- unit tests cover ordering, wrapping and the not-in-code cards

---

### [ ] feat: Reset positions (FR-CEH-4)

**Affected files:** `src/webview/controls/layout-helpers.ts`, `src/webview/controls/convention-canvas.ts`, `src/sidebar/controls-editor-panel.ts`, `src/test/unit/webview/controls-layout-helpers.test.ts`

**DoD:**
- a *Reset positions* header button returns every card to the default cascade (the layout used when no position is stored)
- the default-cascade rule is shared with the canvas's first render, not duplicated
- the result is saved through auto-save; a unit test covers the cascade
