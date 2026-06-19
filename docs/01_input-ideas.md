# 01 — Input Ideas (v3)

> **v1 complete** — ds-ide 0.1.0–0.1.7 (M0–M7), all ACs green. Full v1 ideas archived in
> [`docs/v1/01_input-ideas.md`](v1/01_input-ideas.md).
>
> **v2 complete** — ds-ide 0.2.0–0.2.9 (M8–M15), all ACs green. Full v2 ideas archived in
> [`docs/v2/01_input-ideas.md`](v2/01_input-ideas.md).

This document collects **v3 feature ideas**. v3 planning started 2026-06-19.

---

## 1. v3 north star

v2 gave developers a realistic inner loop: play live audio through their effect, interact with
virtual hardware controls, step through code at a breakpoint, and flash to real hardware without
leaving the IDE.

v3 makes the **development environment smarter**: the IDE understands the hardware design, not just
the runtime state. The developer can visually wire physical devices to Daisy Seed pins — and the
IDE writes the matching C++ declarations. The control panel for running the effect is no longer a
separate configuration artifact: it is inferred directly from the code and becomes the same canvas
the developer uses to design the hardware layout.

---

## 2. v3 bug backlog (deferred — retest before planning)

These defects were reported at v3 planning kick-off. They need manual retesting to confirm whether
the regression still exists before adding to a milestone.

- **Bug: Audio speaker output may be non-functional** — expected: developer hears the processed
  effect through host speakers in real time (FR-AU-8, M8). Observed: uncertain — needs retesting.
- **Bug: Spectrum graph — overlapping labels** — frequency-axis labels overlap in the spectrum/FFT
  view (M13). Expected: all labels legible at default panel size. *(Scheduled: M16, T16-1)*
- **Bug: Emulator Scope view panel clipped at edges** — content appears cut off; no visible border.
  Expected: clear panel boundary. *(Scheduled: M16, T16-2)*

---

## 3. v3 feature ideas

### 3a. Controls Editor (enhanced, replaces M10b split)

A unified panel that replaces the current split between the "Controller Editor" tab (design-time
layout) and the "Effect controls" section (live runtime interaction).

- **Single panel, two modes** — Design mode for arranging controls on a canvas; Run mode for live
  interaction while the emulator runs. Same panel, same control layout.
- **Infer controls from C++ source** — reads the `// ds-ide:controls:begin` … `// ds-ide:controls:end`
  block in the effect source (D15); extracts declared controls without requiring a separate yaml entry.
- **`controllers.yaml` for placement only** — yaml stores `editor_pos` positions; the code is the
  source of truth for what controls exist and their pin assignments.
- **Fallback** — if no convention block is detected, fall back to yaml (current M10b behaviour) and
  show a diagnostic.

### 3b. Wiring Editor (new)

A separate VS Code panel for mapping physical hardware devices to Daisy Seed pins at design time.

- **Interactive pinout SVG** — schematic-style diagram of the Daisy Seed (all 40 pins labeled and
  clickable). PCB-illustration version deferred.
- **Click-to-assign** — clicking an unassigned pin opens a popup to select a device type (Pot,
  Button, LED). Invalid pin/device combinations show a warning (not blocked in v3; filtering deferred).
- **C++ code generation** — adding a device writes a declaration to the `// ds-ide:controls` block
  in the effect source. Declaration-only in v3; full init calls deferred.
- **No controllers.yaml writes** — the Wiring Editor writes C++ only. The Controls Editor reads
  from code; yaml is for placement.

### 3c. Brainstorm-driven items

Further ideas to emerge from collaborative planning. Candidates from the v3 kick-off:
- Parameter automation (FR-VZ-3, deferred from v2) — record pot-movement timelines for replay.

---

## 4. v3 convention: `// ds-ide:controls` block

The shared contract between the Wiring Editor (which writes it) and the Controls Editor (which reads it):

```cpp
// ds-ide:controls:begin
AdcChannelConfig knob1_cfg; // ds-ide: id=knob1, kind=pot, pin=15
Switch btn1;                 // ds-ide: id=btn1, kind=button, pin=8
// ds-ide:controls:end
```

- No ds-ide header required — pure libDaisy, compiles unchanged for hardware.
- Parser (C9) reads this block; generates nothing for lines without `// ds-ide:` annotation.
- If the block is absent: Controls Editor falls back to `controllers.yaml`; Wiring Editor creates the block on first use.

---

## 5. Roadmap

| Phase | Theme | Key features | Status |
|-------|-------|--------------|--------|
| **v1** | Foundation | Native simulation; VS Code extension; pots; scope; breakpoints | ✅ complete (M0–M7) |
| **v2** | Realism | Live audio I/O; WAV; buttons/GPIO/LEDs; visual editor; full debug; HW build; spectrum; recording; scope UI | ✅ complete (M8–M15) |
| **v3** | Editor intelligence | Controls Editor v3 (two-mode, code inference); Wiring Editor (SVG pinout, C++ gen); spectrum/scope polish; parameter automation | 🔵 planning |
| **vX** | Pre-public release | Built-in board maps; auto-derived controllers (arbitrary code); MIDI; cross-platform audio+debug; ARM toolchain bundle | planned |

---

## Open Conflicts

*(none open at v3 kick-off)*
