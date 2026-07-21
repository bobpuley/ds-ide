# M45 — MicroSD & Bus-Peripheral UI

**Version:** 0.16.0
**Status:** planned
**Source:** intake 2026-07-21 — device support expansion

## Goal

Land the first *bus-attached* peripheral and, with it, the UI vocabulary every later peripheral
depends on: a peripherals section in the Wiring Editor, bus groups drawn on the board as one
collapsed bracket, detail on demand through tooltip and popover, and conflicting actions refused
with a concrete remedy rather than applied and flagged. MicroSD is chosen to go first because its
emulation is genuinely cheap — FatFS mapped onto a workspace-relative host directory — so the
milestone's real weight sits in the UI rather than the shim, and samplers and looper projects
become testable as a side effect.

## Sprint Tasks

*Sprint tasks are written once M44 has proven the M43 registry. Requirements FR-DEV-10 through
FR-DEV-13 in [`03_requirements.md`](../../03_requirements.md) are provisional until then; the UX
they encode is settled and demonstrated in
[`docs/mockups/v14-peripheral-ux.html`](../../mockups/v14-peripheral-ux.html).*
