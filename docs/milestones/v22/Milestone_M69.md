# M69 — Controls Editor Devices in the Wiring-Palette Style

**Version:** 0.20.4
**Status:** planned
**Source:** feature intake session, 2026-09-29 (01_input-ideas.md; layout per docs/mockups/v22-control-widgets.html, built as this milestone's first task)

## Goal

The Controls Editor draws its own plain widgets (an arc knob, an empty button, a text toggle,
plain dots) while the Wiring Editor palette shows illustrated device art. After this milestone the
six control kinds (pot, button, LED, toggle, encoder, RGB LED) appear in the Controls Editor as the
palette's own art, animated live inside a palette-style tile, from one shared set of art. OLED, SD
card and MIDI devices are unchanged because they have no card there.

## Sprint Tasks

### [x] docs: control-widget mockup in the palette style (FR-CWS-3)

The card look and each widget's live states are UI decisions, so they are evaluated in a
standalone mockup before any code changes.

**Affected files:** `docs/mockups/v22-control-widgets.html`, `docs/04_architecture.md`

**DoD:**
- a standalone HTML mockup shows the six control cards (pot, button, LED, toggle, encoder, RGB LED) with the palette art at card size, in the palette tile frame with accent underline, under switchable Light+, Dark+, High Contrast Dark and High Contrast Light values
- it shows each widget's states side by side: pot at 0 / 50 / 100 %, button released / pressed, toggle positions, encoder at several angles, LED off / lit, RGB LED with a sample colour; plus the stopped (dimmed) state
- the user has evaluated it; any change to the state visuals is written back to 04_architecture.md

---

### [x] feat: shared device art exposes hooks for its moving parts (FR-CWS-1)

**Affected files:** `src/wiring/device-icons.ts`, `src/test/unit/wiring/device-icons.test.ts`

**DoD:**
- pot and encoder art have a `pointer` hook, button a `cap`, toggle a `lever`, LED a `lens` and `glow`, RGB LED a `lens` (`data-part` attributes)
- the palette markup differs from before only by those attributes; its look is unchanged
- `deviceIconSvg(id, accent, { live: true })` returns the art without the palette's fixed size, for the card
- a unit test checks every control kind's art carries the hooks its widget needs
- `npm test` green

---

### [ ] feat: Controls Editor cards render live illustrated widgets (FR-CWS-2)

**Affected files:** `src/webview/controls/device-widget.ts`, `src/webview/controls/convention-canvas.ts`, `src/webview/controls/knob-svg.ts`, `src/webview/controls-webview.ts`, `src/test/unit/webview/device-widget.test.ts`, `src/test/unit/webview/knob-svg.test.ts`

**DoD:**
- `widgetHtml(kind, state)` and the state mapping (pot and encoder angle, lit, pressed, toggle position, RGB colour) are pure and unit-tested for each of the six kinds
- each card shows its device's art as the widget: pot pointer follows the drag with the value shown, button cap looks pressed while held, toggle lever follows the position, encoder pointer follows the position, LED lens glows when lit, RGB LED lens shows the live colour
- pot drag, button press / release, toggle cycling, encoder scroll and the LED / RGB LED IPC handling behave as before; stopped emulator dims and disables the widgets as before
- `knob-svg.ts` and its test are removed
- `npm test` green; manual check of each kind in the four theme kinds

---

### [ ] feat: Controls Editor cards use the palette tile frame (FR-CWS-3)

**Affected files:** `src/sidebar/controls-editor-panel.ts`, `src/test/unit/sidebar/controls-editor-panel.test.ts`

**DoD:**
- each card uses the palette tile look: themed frame, `--ds-accent-<id>` underline, art on its fixed plate; the drag handle, id label and pin label stay
- the M68 widget-outline rules for `.btn-ce`, `.tgl-ce`, `.vled-dot` and `.vrgb-dot` are removed with the elements they styled
- the frame follows all four theme kinds while the art looks the same in each
- `no-hardcoded-colours.test.ts` still passes with no new allow-list entry
- `npm test` green; manual check in the four theme kinds
