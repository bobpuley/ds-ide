# 03 — Requirements (v17)

> **v16 complete** — all v16 requirements implemented; ACs green.
> Archived: [`docs/v16/03_requirements.md`](v16/03_requirements.md).

## v17 requirements

**FR-DEV-20 — MIDI Program Change as a typed message (M52).** The emulator shim's
`MidiEvent` model gains a first-class `MidiMessageType::ProgramChange` and matching
`AsProgramChange()` accessor (mirroring real libDaisy's shape), and
`parse_midi_event` (`emulator/shim/src/midi_event.cpp`) recognizes status byte
`0xC0` and classifies it as `ProgramChange` instead of falling through to
`Unknown`. The program number arrives as `data[0]` (data2 unused, matching the
existing 2-byte Program Change wire convention in `midi-monitor.ts`'s
`programChangeToBytes`). No range validation/clamping is added — the byte is
passed through as-is, consistent with how NoteOn/ControlChange are handled
today. Out of scope: PitchBend, ChannelPressure/PolyKeyPressure, SystemCommon/
SystemRealTime — these remain unmodeled (see `01_input-ideas.md`).

> ⚠️ ASSUMPTION: see `02_assumptions-and-risks.md` — this is a breaking change
> for any effect code relying on the old `Unknown` + `data[0]` workaround.
