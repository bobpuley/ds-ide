# M63 — Manual Test Tracker

**Version:** 0.19.1
**Status:** in progress
**Source:** feature intake session, 2026-08-30

## Goal

Give the project a lightweight, hand-editable way to track manual verification of use cases
that are hard to cover with unit tests — real audio I/O, hardware build/flash, breakpoint
timing, webview rendering, MIDI/OLED/SD peripheral behavior. After this milestone, a single
standalone HTML page at `src/test/manual/manual-tests.html` lists concrete manual test cases
(title, description, steps, expected result, status) for these areas, pre-populated with an
initial real set rather than shipped empty, ready to be run after each relevant implementation
and extended as new hard-to-unit-test surfaces appear.

## Sprint Tasks

### [x] feat: add manual test tracker HTML page (FR-TEST-1)

Created `src/test/manual/manual-tests.html`: a standalone, hand-edited page (no build step)
listing manual test cases. Each entry has a title, short description, numbered steps, expected
result, and a status `<select>` (`pending` | `success` | `fail`) — choosing a value recolors
that entry's badge and whole block (green for success, red for fail) via one minimal inline
`<script>` element, a visual-only preview with no persistence beyond whatever `selected` option
is saved in the file. A page-top summary line tallies current pending/success/fail counts
across all entries and updates live as selections change. Pre-populated with 16 test cases
surveying ds-ide's existing
hard-to-unit-test areas: emulator build/run loop timing, on-screen pot → ADC → scope,
breakpoint time-freeze, NaN/clipping flagging, live audio I/O, hardware build parity, DFU
flash, hardware variant prompt/persistence, hardware memory-budget alerting, Controls Editor
wiring round-trip, Wiring Editor pin-conflict detection, MIDI (on-screen keyboard + host bridge
+ monitor), OLED framebuffer rendering, session recording/replay, SD card viewer, and
scope/spectrum real-time tracking.

**Affected files:** `src/test/manual/manual-tests.html`

**DoD:**
- File exists at `src/test/manual/manual-tests.html`, opens correctly as a standalone page in
  a browser with no server or build step.
- Every test entry has all five required fields: title, description, steps, expected result,
  status (defaulting to `pending`).
- At least one test case exists per major hard-to-unit-test area identified during intake
  (emulator run loop, ADC/pots, breakpoint/debug, DSP correctness flagging, real audio I/O,
  hardware build & flash, hardware variant/memory-budget alerting, Controls/Wiring editors,
  MIDI, OLED, session recording, SD card, scope/spectrum).
- Choosing a status value in a test's `<select>` recolors that entry (badge + block) —
  green for success, red for fail; a persisted result requires hand-editing the `selected`
  option in the file. The page's only script is the single inline toggle handler — no other
  JS-driven logic or persistence.
