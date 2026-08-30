# M62 — MIDI Monitor IPC Schema Fix

**Version:** 0.19.0
**Status:** released
**Source:** bug intake session, 2026-08-30 (reported while testing `tremolo-filter-midi`)

## Goal

Fix the MIDI message monitor so it actually shows MIDI events. Today the emulator correctly
emits `midiRx`/`midiTx` IPC messages and the webview panel is already written to consume them,
but the extension's IPC schema-validation boundary silently drops every one of them before they
arrive, because it was never taught the shape of these two message types. After this milestone,
`midiRx`/`midiTx` messages pass validation and the MIDI monitor panel reflects live MIDI
traffic, fulfilling FR-DEV-18 as originally intended.

## Sprint Tasks

### [x] fix: add midiRx/midiTx narrowers to the IPC schema whitelist (FR-DEV-18)

`src/ipc/narrow.ts`'s `NARROWERS` whitelist — the schema-validation boundary introduced by
FR-IPC-2 that every emulator-emitted IPC message must pass before `IpcClient` will emit it —
has no entry for `midiRx` or `midiTx`. The emulator (`emulator/runtime/ipc_server.cpp:483`)
sends well-formed `{"type":"midiRx","status":...,"data1":...,"data2":...,"channel":...,
"midiType":...}` messages, and `src/webview/midi-panel.ts:44` already has working consumer
code (`if (msg['type'] === 'midiRx') this.postMidiRx(msg)`), but `parseIpcMessage()` returns
`undefined` for both types today, so `IpcClient.onData` logs `dropped IPC message failing
schema validation` and discards every one. Confirmed via `git log -- src/ipc/narrow.ts`: no
commit for the MIDI panel feature (FR-MIDI-1/FR-DEV-18) ever touched this file.

**Affected files:** `src/ipc/narrow.ts`

**DoD:**
- `NARROWERS` gains a `midiRx` and a `midiTx` entry, each requiring numeric `status`, `data1`,
  `data2`, `channel`, `midiType` fields (matching the existing `led`/`rgbLed` narrower style —
  reject if any field is missing or non-numeric).
- Sending MIDI Program Change and Control Change into a test effect (e.g.
  `tremolo-filter-midi`) no longer logs `dropped IPC message failing schema validation` for
  `midiRx`, and the events appear in the MIDI monitor panel.
- A unit test alongside `src/ipc/narrow.ts`'s existing tests (if any) covers both the accept
  and reject paths for `midiRx`/`midiTx`.
