# M46 — OLED Display

**Version:** 0.17.0
**Status:** planned
**Source:** intake 2026-07-21 — device support expansion

## Goal

Make menu-driven firmware debuggable. A large fraction of non-trivial Daisy projects drive an
SSD1306 over SPI or I2C, and today none of that is observable in ds-ide at all — the developer is
back to flashing hardware to see whether a menu renders. After this milestone the emulator captures
the display framebuffer off the real-time path and a webview panel renders it at native 128×64, so
UI logic can be stepped through and watched in place.

## Sprint Tasks

*Sprint tasks are written once M44 has proven the M43 registry and M45 has landed the
bus-peripheral UI this milestone builds on. Requirements FR-DEV-14 and FR-DEV-15 in
[`03_requirements.md`](../../03_requirements.md) are provisional until then. The framebuffer
transport rests on an explicit assumption recorded in
[`02_assumptions-and-risks.md`](../../02_assumptions-and-risks.md) — that ~1 KB/frame can ship over
the existing SPSC ring without perturbing the audio thread — which must be measured, not assumed,
before acceptance criteria are fixed.*
