# M52 — MIDI Program Change Typed Support

**Version:** 0.17.0
**Status:** in progress
**Source:** feature request — 2026-08-23 intake session (surfaced during MIDI host-bridge testing
with `ds-ide-test-proj/tremolo-filter-midi/`)

## Goal

Today the emulator shim's `MidiEvent` model (`emulator/shim/src/midi_event.cpp`) only classifies
NoteOff, NoteOn, and ControlChange — a Program Change message (status `0xC0`) is forwarded
correctly over IPC and visible in the MIDI monitor (send-only per M47/M48's `FR-MIDI-1` scope,
`src/webview/midi-monitor.ts`), but arrives at effect code as `MidiMessageType::Unknown`, with the
program number recoverable only by reading `data[0]` off that fallback — an undocumented
implementation detail, not a supported API. After this milestone, `MidiMessageType::ProgramChange`
and `AsProgramChange()` exist as a first-class typed message, mirroring real libDaisy's shape, so
effect authors can `switch` on `ProgramChange` directly instead of reverse-engineering it from
`Unknown`.

## Sprint Tasks

### [ ] feat: add MidiMessageType::ProgramChange and AsProgramChange() to the emulator shim (FR-DEV-20)

`emulator/shim/include/daisy/midi_event.h`'s `MidiMessageType` enum gains a `ProgramChange` value
and a `ProgramChangeEvent` struct (`channel`, `program`), mirroring the existing
`ControlChangeEvent` shape and real libDaisy's `MidiEvent::AsProgramChange()`.
`parse_midi_event` (`emulator/shim/src/midi_event.cpp`) recognizes status byte `0xC0` and
classifies it as `ProgramChange` instead of falling through to `Unknown` — `data[0]` carries the
program number (`data[1]`/data2 stays unused, matching `midi-monitor.ts`'s
`programChangeToBytes`'s existing 2-byte convention). No range validation/clamping is added — the
byte passes through as-is, consistent with how NoteOn/ControlChange are handled today.

**Affected files:** `emulator/shim/include/daisy/midi_event.h`, `emulator/shim/src/midi_event.cpp`,
`tests/midi-shim/test_midi.cpp`

**DoD:**
- `MidiMessageType::ProgramChange` and `MidiEvent::AsProgramChange()` exist and compile.
- `parse_midi_event` classifies status `0xC0` as `ProgramChange` (returns `true`), not `Unknown`.
- `AsProgramChange()` returns the correct `channel` and `program` (from `data[0]`) for a decoded
  Program Change event.
- Existing NoteOff/NoteOn/ControlChange classification behavior is unchanged (regression check).
- `tests/midi-shim/test_midi.cpp` covers the new `0xC0` case.
- `ds-ide-test-proj/tremolo-filter-midi/tremolo_filter_midi.cpp` is updated to use
  `MidiMessageType::ProgramChange`/`AsProgramChange()` instead of the `Unknown`/`data[0]`
  workaround (per `02_assumptions-and-risks.md`'s recorded break-risk), confirming the new API
  works end to end against the on-screen MIDI panel's Program dropdown.
