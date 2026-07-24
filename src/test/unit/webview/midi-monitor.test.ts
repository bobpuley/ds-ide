import { describe, it, expect } from 'vitest';
import {
  noteToBytes, pushMonitorEntry, MAX_MONITOR_ENTRIES, programChangeToBytes, controlChangeToBytes,
} from '../../../webview/midi-monitor';
import type { MidiMonitorEntry } from '../../../webview/midi-monitor';

describe('noteToBytes (FR-DEV-18)', () => {
  it('encodes a NoteOn as status 0x90 on channel 0', () => {
    expect(noteToBytes('noteOn', 60, 100)).toEqual({ status: 0x90, data1: 60, data2: 100 });
  });

  it('encodes a NoteOff as status 0x80 on channel 0', () => {
    expect(noteToBytes('noteOff', 60, 0)).toEqual({ status: 0x80, data1: 60, data2: 0 });
  });
});

describe('programChangeToBytes (FR-MIDI-1)', () => {
  it('encodes a Program Change as status 0xC0 on channel 0 with data2 zeroed', () => {
    expect(programChangeToBytes(5)).toEqual({ status: 0xC0, data1: 5, data2: 0 });
  });
});

describe('controlChangeToBytes (FR-MIDI-1)', () => {
  it('encodes a Control Change as status 0xB0 on channel 0', () => {
    expect(controlChangeToBytes(7, 100)).toEqual({ status: 0xB0, data1: 7, data2: 100 });
  });
});

describe('pushMonitorEntry (FR-DEV-18)', () => {
  function entry(note: number): MidiMonitorEntry {
    return { direction: 'rx', status: 0x90, data1: note, data2: 100, channel: 0, midiType: 1, timestamp: note };
  }

  it('appends an entry to the history', () => {
    const history = pushMonitorEntry([], entry(60));
    expect(history).toHaveLength(1);
    expect(history[0]!.data1).toBe(60);
  });

  it('keeps the newest entry last', () => {
    const history = pushMonitorEntry([entry(60)], entry(64));
    expect(history.map(e => e.data1)).toEqual([60, 64]);
  });

  it('bounds history at MAX_MONITOR_ENTRIES, dropping the oldest', () => {
    let history: MidiMonitorEntry[] = [];
    for (let i = 0; i < MAX_MONITOR_ENTRIES + 5; i++) {
      history = pushMonitorEntry(history, entry(i));
    }
    expect(history).toHaveLength(MAX_MONITOR_ENTRIES);
    expect(history[0]!.data1).toBe(5);
    expect(history[history.length - 1]!.data1).toBe(MAX_MONITOR_ENTRIES + 4);
  });

  it('preserves direction across mixed rx/tx entries in one history (FR-MIDI-1)', () => {
    const txEntry: MidiMonitorEntry = { ...entry(64), direction: 'tx' };
    const history = pushMonitorEntry(pushMonitorEntry([], entry(60)), txEntry);
    expect(history.map(e => e.direction)).toEqual(['rx', 'tx']);
  });
});
