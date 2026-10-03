# M75 — Scope Toolbar Popovers

**Version:** 0.24.2
**Status:** planned
**Source:** intake session, 2026-10-03 (01_input-ideas.md; user request; mockup `docs/mockups/v22-scope-instrument_alt1.html`)

## Goal

The Scope toolbar and spectrum bar show every option of Gain, Scale, Trigger, frequency axis and level mode at once, as thirteen segmented buttons, which uses most of the toolbar width and makes the current setting hard to spot. After this milestone each of those five settings is one chip showing only its current value; clicking it opens a popover with the choices, and a chip that is not at its default is marked amber with a `●`.

## Sprint Tasks

### [x] feat: chip menu model (FR-SCI-15)

The options, labels, defaults and enabled state of the five chips are pure data, so they can be unit-tested without a DOM.

**Affected files:** `src/webview/scope/scope-chips.ts`, `src/test/unit/webview/scope-chips.test.ts`

**DoD:**
- a pure module defines the five chips (gain, scale, trigger, frequency axis, level mode), each with its option list, default value and a label function for its current value
- the Trigger chip label is `Free` or the edge glyph plus source (`↗ In`, `↘ L`); the Trigger menu has Edge and Source groups and reports Source as disabled while the edge is Free
- an `isDefault(chip, value)` helper is true exactly at Gain ×1, Scale Linear, Trigger Free, Log Hz and Absolute dBFS
- unit tests cover every label, the disabled rule and the defaults

---

### [x] feat: replace the segmented groups with chips (FR-SCI-15)

**Affected files:** `src/webview/scope-panel.ts`, `src/webview/scope-webview.ts`, `src/test/unit/webview/scope-panel.test.ts`

**DoD:**
- the toolbar renders Gain, Scale and Trigger as one chip each, and the spectrum bar renders the frequency axis and level mode as one chip each; the segmented groups `gain-seg`, `unit-seg`, `trig-seg`, `trigsrc-seg`, `fscale-seg`, `lmode-seg` are gone
- Time, Freeze, 1× Single and the snapshot/CSV buttons are unchanged
- choosing a value sets the same state the matching segment set before, including `syncCapture()` after a trigger change
- the scope-panel unit test is updated to the chip markup and still fails if a chip is missing

---

### [x] feat: choice popover (FR-SCI-16)

**Affected files:** `src/webview/scope-panel.ts`, `src/webview/scope-webview.ts`, `src/test/unit/webview/scope-panel.test.ts`

**DoD:**
- clicking a chip opens an opaque popover under it, flips above when it would leave the viewport, and stays within the viewport width
- the active entry shows a ✓; the Trigger popover has Edge and Source groups, Source disabled while Free, and stays open after Rising/Falling is picked
- Esc, a click outside and a pick close it; Esc returns focus to the chip; ↑/↓/Enter work
- chips have `aria-haspopup="menu"` and `aria-expanded`; entries are `menuitemradio` with `aria-checked`
- the popover background and text use `--ds-dropdown-bg` / `--ds-dropdown-fg`; a test fails if the popover rule leaves its background unset
- Space still freezes the display and does not fire while a chip or popover has focus

---

### [x] feat: non-default chip marker (FR-SCI-17)

**Affected files:** `src/webview/scope-panel.ts`, `src/webview/scope-webview.ts`, `src/test/unit/webview/scope-panel.test.ts`

**DoD:**
- a chip not at its default shows its value in the warning colour with a `●` before it; at the default it shows neither
- its accessible name ends with "(changed from default)" when not at the default
- a unit test covers a default and a non-default chip

---

### [ ] chore: manual test cases for the chips and popovers (FR-SCI-16)

**Affected files:** `src/test/manual/manual-tests.html`

**DoD:**
- cases cover: opening and closing each popover, the Trigger two-step choice, flip-above in a short panel, the 560 px split-beside-code width on one row, and dark / light / high-contrast legibility
- each case has the standard status select and appears in the page-top summary
