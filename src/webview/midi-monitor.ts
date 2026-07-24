// Pure MIDI panel helpers (FR-DEV-18) — no DOM access, unit-testable
// directly (FR-IPC-6's convention, mirroring oled-frame.ts).

// Translates an on-screen keyboard action into the raw byte triplet
// emulator/runtime/ipc_server.cpp's `midiEvent` handler expects. Fixed to
// channel 0 — the virtual keyboard has no channel selector.
export function noteToBytes(
  kind: 'noteOn' | 'noteOff',
  note: number,
  velocity: number,
): { status: number; data1: number; data2: number } {
  const status = kind === 'noteOn' ? 0x90 : 0x80;
  return { status, data1: note, data2: velocity };
}

// FR-MIDI-1: Program Change/Control Change sender — same fixed-channel-0
// convention as noteToBytes (no channel selector in the UI). Program Change
// is a real 2-byte MIDI message (status, program) but the `midiEvent` wire
// message is a fixed 3-number triplet (M47), so data2 is sent as 0 — a
// value ipc_server.cpp's parser never reads for a Program Change status
// byte in the first place (parse_midi_event only recognizes NoteOff/NoteOn/
// ControlChange; PC support here is send-only, matching FR-MIDI-1's scope).
export function programChangeToBytes(program: number): { status: number; data1: number; data2: number } {
  return { status: 0xC0, data1: program, data2: 0 };
}

export function controlChangeToBytes(
  controller: number,
  value: number,
): { status: number; data1: number; data2: number } {
  return { status: 0xB0, data1: controller, data2: value };
}

// Mirrors messages.ts's MidiHostMessage 'midiRx'/'midiTx' payload plus a
// client-side arrival timestamp for display ordering and a `direction` tag
// so the monitor can distinguish the two in one unified list (FR-MIDI-1).
export interface MidiMonitorEntry {
  direction: 'rx' | 'tx';
  status: number;
  data1: number;
  data2: number;
  channel: number;
  midiType: number;
  timestamp: number;
}

export const MAX_MONITOR_ENTRIES = 50;

// Appends `entry`, dropping the oldest once the bounded history is full —
// newest entry last, so the monitor's newest-visible-without-scrolling
// requirement (DoD) reads straightforwardly by rendering the list in order.
export function pushMonitorEntry(
  history: readonly MidiMonitorEntry[],
  entry: MidiMonitorEntry,
  max = MAX_MONITOR_ENTRIES,
): MidiMonitorEntry[] {
  const next = [...history, entry];
  return next.length > max ? next.slice(next.length - max) : next;
}
