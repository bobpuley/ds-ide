# 02 — Assumptions & Risks (v15)

> **All prior versions complete** — full bet/risk history in their respective archives.
> **v14 complete** — all v14 bets held; risks resolved or managed.
> Archived: [`docs/v14/02_assumptions-and-risks.md`](v14/02_assumptions-and-risks.md).

*v15 bets and risks to be defined during planning.*

## Carried-over open items

- **`MidiUartHandler::Config` field names unverified against real hardware** — M47
  (`docs/v14/05_dev-plan.md` / [`docs/milestones/v14/Milestone_M47.md`](milestones/v14/Milestone_M47.md))
  modeled `MidiUartHandler` on the corpus-confirmed `MidiUsbHandler` shape rather than a confirmed
  header, since no corpus example exercises `MidiUartHandler`. Doesn't affect emulator behavior (the
  shim defines its own type regardless), but must be verified against real libDaisy before any v15
  milestone attempts a hardware build touching MIDI TRS.
