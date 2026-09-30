# M70 — Scope Instrument — Display

**Version:** 0.21.0
**Status:** in progress
**Source:** feature intake session, 2026-09-30 (01_input-ideas.md; design_plan.md P0-4, §6.B-8, §6.B-10; layout per docs/mockups/v22-scope-instrument.html)

## Goal

The Daisy Scope draws two unlabelled traces at a fixed gain, never shows the right output
channel the emulator already captures, and has no levels, so a quiet signal looks like silence
and a clip is a transient string. After this milestone the scope has labelled time and amplitude
axes, gain and dBFS scaling, all three traces (In, Out L, Out R), freeze with a cursor read-out,
and per-channel meters with a latching clip indicator, all on the existing scope stream.

## Sprint Tasks

### [x] docs: confirm the scope instrument layout in the mockup (FR-SCI-1)

The layout is a UI decision, so it is evaluated in the standalone mockup before any view changes.

**Affected files:** `docs/mockups/v22-scope-instrument.html`, `docs/04_architecture.md`

**DoD:**
- the user has evaluated `docs/mockups/v22-scope-instrument.html` at 860 px and 560 px in dark, light and high-contrast themes
- the mockup's open questions (spectrum placement, meters column vs overlay, export format, event-history home) are answered and recorded in 04_architecture.md

---

### [x] feat: carry out_r and decimation step in the scope message (FR-SCI-2)

The emulator already serialises `out_r`, but the `scope` narrower drops it, and the webview cannot
derive the decimation step reliably from the block size.

**Affected files:** `emulator/runtime/audio_engine.cpp`, `src/ipc/narrow.ts`, `src/ipc/types.ts`, `src/webview/messages.ts`, `src/webview/scope-panel.ts`, `src/test/unit/ipc/narrow.test.ts`

**DoD:**
- `build_scope_json()` emits `"step"`; the message stays within `SpscIpcQueue::MAX_MSG`
- the `scope` narrower forwards optional `out_r` and `step`; a message without either still narrows
- the Scope panel forwards both to the webview
- unit tests cover present, absent and malformed `out_r` / `step`

---

### [x] feat: webview capture ring (FR-SCI-3)

**Affected files:** `src/webview/scope/scope-capture.ts`, `src/webview/scope-webview.ts`, `src/test/unit/webview/scope-capture.test.ts`

**DoD:**
- a pure module appends consecutive snapshots per channel to a ring holding at least 100 ms of signal and reports the effective sample rate (`sampleRate / step`)
- the ring is cleared on emulator restart and on sample-rate or block-size change
- unit tests: stitching two snapshots, overflow drops the oldest samples, clear-on-config, a 4-frame block still yields a full 10 ms/div window

---

### [x] feat: labelled axes and time base (FR-SCI-4)

**Affected files:** `src/webview/scope/scope-view.ts`, `src/webview/scope-webview.ts`, `src/webview/scope-panel.ts`, `src/test/unit/webview/scope-view.test.ts`

**DoD:**
- a time-base selector (0.5 / 1 / 2 / 5 / 10 ms per division) sets a 10-division window; ms labels and amplitude labels are drawn on the canvas
- the effective sample rate is shown, and a time base with fewer than 20 points per division is flagged
- unit tests cover window length, tick values and the low-resolution flag

---

### [x] feat: gain and dBFS amplitude scale (FR-SCI-5)

**Affected files:** `src/webview/scope/scope-view.ts`, `src/webview/scope-webview.ts`, `src/webview/scope-panel.ts`, `src/test/unit/webview/scope-view.test.ts`

**DoD:**
- ×1 / ×2 / ×4 / Auto and Linear / dBFS controls; Auto caps at ×64 and never goes below ×1; traces are clipped to the plot
- a −40 dBFS sine is visible at Auto gain and unchanged at ×1
- unit tests cover gain mapping, Auto selection and the dB axis values

---

### [x] feat: stereo traces with a toggling legend (FR-SCI-6)

**Affected files:** `src/webview/scope-webview.ts`, `src/webview/scope-panel.ts`, `src/webview/scope-colors.ts`, `src/webview/theme/theme-css.ts`, `src/test/unit/webview/scope-colors.test.ts`

**DoD:**
- In, Out L and Out R are drawn with solid, dashed and dotted lines; the legend toggles each trace
- a new `--ds-trace-outr` token exists for all four theme kinds and is loaded by `loadScopeColors`
- the theme guard test (FR-THM-6) stays green

---

### [ ] feat: freeze and cursor read-out (FR-SCI-7)

**Affected files:** `src/webview/scope-webview.ts`, `src/webview/scope-panel.ts`, `src/test/unit/webview/scope-panel.test.ts`

**DoD:**
- a Freeze / Resume button and the Space key hold the display and show a FROZEN badge; the capture ring keeps collecting
- hovering the scope shows time and each visible channel's value under the pointer, live or frozen

---

### [ ] feat: per-channel meters with latching clip (FR-SCI-8)

**Affected files:** `src/webview/scope/scope-meters.ts`, `src/webview/scope-webview.ts`, `src/webview/scope-panel.ts`, `src/test/unit/webview/scope-meters.test.ts`

**DoD:**
- a meters column shows peak, RMS, peak-hold and a latching CLIP indicator for In, Out L and Out R, plus a headroom value and a Reset peaks button
- CLIP latches on a full-scale sample for that channel only and clears on click or Reset peaks
- unit tests cover peak, RMS, hold, latch and reset
