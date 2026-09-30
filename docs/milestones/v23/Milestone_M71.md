# M71 — Scope Instrument — Analysis

**Version:** 0.22.0
**Status:** planned
**Source:** feature intake session, 2026-09-30 (01_input-ideas.md; design_plan.md P0-4; layout per docs/mockups/v22-scope-instrument.html)

## Goal

A periodic waveform crawls across the scope, the spectrum is peak-normalised on a linear
frequency axis, and there is no way to hand a capture to someone else or to look back at a
clip. After this milestone the scope has an edge trigger with a draggable level marker and a
best-effort single-shot, a spectrum with Lin / Log frequency and Relative / Absolute dBFS, PNG
and CSV export, and a timestamped event history.

## Sprint Tasks

### [ ] feat: edge trigger with a draggable level marker (FR-SCI-9)

**Affected files:** `src/webview/scope/scope-trigger.ts`, `src/webview/scope-webview.ts`, `src/webview/scope-panel.ts`, `src/test/unit/webview/scope-trigger.test.ts`

**DoD:**
- Free / rising / falling trigger on In or Out L; a marker on the amplitude axis sets the level by dragging
- the plot starts at the first crossing in the capture; with none it shows "no trigger"
- unit tests cover rising, falling, no crossing and a crossing at the window edge

---

### [ ] feat: best-effort single-shot (FR-SCI-10)

**Affected files:** `src/webview/scope-webview.ts`, `src/webview/scope-panel.ts`, `src/test/unit/webview/scope-panel.test.ts`

**DoD:**
- "1× Single" arms the trigger and freezes the display on the first triggered capture; pressing it again resumes
- the control is labelled best-effort (tooltip) until M72

---

### [ ] feat: spectrum frequency and level scaling (FR-SCI-11)

**Affected files:** `src/webview/scope/scope-spectrum-scale.ts`, `src/webview/scope-webview.ts`, `src/webview/scope-panel.ts`, `src/test/unit/webview/scope-spectrum-scale.test.ts`

**DoD:**
- Lin / Log frequency and Relative / Absolute dBFS toggles with labelled Hz and dB axes; Absolute mode does not renormalise to the running peak
- unit tests cover the Log mapping (20 Hz–20 kHz) and that halving the input lowers the absolute trace by 6 dB

---

### [ ] feat: snapshot PNG and CSV export (FR-SCI-12)

**Affected files:** `src/webview/scope/scope-export.ts`, `src/webview/scope-webview.ts`, `src/webview/scope-panel.ts`, `src/webview/messages.ts`, `src/test/unit/webview/scope-export.test.ts`

**DoD:**
- the snapshot button saves a PNG of the scope and spectrum through a save dialog; the export button saves the visible samples as CSV (header row, time in ms, one column per visible channel)
- unit tests cover the CSV text for one, two and three channels

---

### [ ] feat: timestamped event history (FR-SCI-13)

**Affected files:** `src/webview/scope/scope-events.ts`, `src/webview/scope-webview.ts`, `src/webview/scope-panel.ts`, `src/test/unit/webview/scope-events.test.ts`

**DoD:**
- CLIP, DENORMAL and xrun events are kept with a timestamp in a log of at most 200 entries; the strip shows the latest, and clicking it expands the full log
- unit tests cover append, the 200-entry bound and ordering
