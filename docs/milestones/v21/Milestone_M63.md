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

Created `src/test/manual/manual-tests.html`: a standalone, hand-edited static page (no build
step, no JS-driven persistence) listing manual test cases. Each entry has a title, short
description, numbered steps, expected result, and a status badge (`pending` | `success` |
`fail`) styled via CSS classes that the tester edits by hand alongside the status text.
Pre-populated with 16 test cases surveying ds-ide's existing hard-to-unit-test areas: emulator
build/run loop timing, on-screen pot → ADC → scope, breakpoint time-freeze, NaN/clipping
flagging, live audio I/O, hardware build parity, DFU flash, hardware variant prompt/
persistence, hardware memory-budget alerting, Controls Editor wiring round-trip, Wiring Editor
pin-conflict detection, MIDI (on-screen keyboard + host bridge + monitor), OLED framebuffer
rendering, session recording/replay, SD card viewer, and scope/spectrum real-time tracking.

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
- Status is changed only by hand-editing the file (no `<script>` element in the page).
