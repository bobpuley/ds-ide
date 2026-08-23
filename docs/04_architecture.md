# 04 — Architecture (v17)

> **v16 complete** — full v16 architecture in
> [`docs/v16/04_architecture.md`](v16/04_architecture.md).

*v17 architecture not yet defined.*

## v17 notes

- **FR-DEV-20 (MIDI Program Change):** no architecture impact. Additive change
  inside the existing `MidiEvent` model — same IPC `midiEvent` triplet wire
  format, same `midi_in_queue`, no new component or data flow.
