# M47 — MIDI: TRS & USB

**Version:** 0.18.0
**Status:** planned
**Source:** intake 2026-07-21 — device support expansion

## Goal

Extend ds-ide's usefulness from audio effects to synthesis. MIDI-driven projects are currently
undevelopable without hardware, since nothing can send the emulator a note. After this milestone
the emulator implements both MIDI transports — TRS over UART and USB in its `INTERNAL` (micro USB
connector) and `EXTERNAL` (USB HS, D29–D30) modes — and the extension provides an on-screen
keyboard and message monitor, with a host CoreMIDI bridge on macOS so a real controller can drive
the emulated device.

## Sprint Tasks

*Sprint tasks are written once M44 has proven the M43 registry and M45 has landed the
bus-peripheral UI. Requirements FR-DEV-16 through FR-DEV-18 in
[`03_requirements.md`](../../03_requirements.md) are provisional until then. Host MIDI bridging is
macOS-only for v14 by explicit decision, recorded in
[`02_assumptions-and-risks.md`](../../02_assumptions-and-risks.md); the on-screen keyboard is the
cross-platform fallback.*
