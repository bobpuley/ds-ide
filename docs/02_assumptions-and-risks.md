# 02 — Assumptions & Risks (v17)

> **All prior versions complete** — full bet/risk history in their respective archives.
> **v16 complete** — all v16 bets held; risks resolved or managed.
> Archived: [`docs/v16/02_assumptions-and-risks.md`](v16/02_assumptions-and-risks.md).

## v17 assumptions & risks

> ⚠️ ASSUMPTION: Giving Program Change its own `MidiMessageType::ProgramChange` will
> silently break any existing effect code that reads Program Change via the
> `Unknown` case + `data[0]` workaround (e.g. `ds-ide-test-proj/tremolo-filter-midi/tremolo_filter_midi.cpp`),
> since those bytes will no longer be classified as `Unknown` once the new type
> exists. This is a test-project-only workaround today (never a documented/
> supported API), so the blast radius is believed to be limited to ad hoc test
> projects built against the old behavior, not any shipped ds-ide feature —
> but it is a real behavior change for anyone who copied that pattern.
