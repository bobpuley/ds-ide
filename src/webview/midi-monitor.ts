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

// Mirrors messages.ts's MidiHostMessage 'midiRx' payload plus a client-side
// arrival timestamp for display ordering.
export interface MidiMonitorEntry {
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
