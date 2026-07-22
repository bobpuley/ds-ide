/// <reference lib="dom" />
import type { MidiHostMessage } from './messages';
import { pushMonitorEntry, MAX_MONITOR_ENTRIES } from './midi-monitor';
import type { MidiMonitorEntry } from './midi-monitor';

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const vscode = acquireVsCodeApi();
const keyboardEl = el<HTMLElement>('keyboard');
const monitorEl = el<HTMLElement>('monitor');

// One octave (C4-B4, MIDI notes 60-71) — the DoD's "at least one octave".
const FIRST_NOTE = 60;
const OCTAVE_LENGTH = 12;
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const DEFAULT_VELOCITY = 100;

for (let i = 0; i < OCTAVE_LENGTH; i++) {
  const note = FIRST_NOTE + i;
  const key = document.createElement('div');
  key.className = 'key';
  key.title = (NOTE_NAMES[i] ?? '') + Math.floor(note / 12 - 1);
  key.addEventListener('mousedown', () => {
    key.classList.add('pressed');
    vscode.postMessage({ command: 'noteOn', note, velocity: DEFAULT_VELOCITY });
  });
  const release = () => {
    if (!key.classList.contains('pressed')) return;
    key.classList.remove('pressed');
    vscode.postMessage({ command: 'noteOff', note, velocity: 0 });
  };
  key.addEventListener('mouseup', release);
  key.addEventListener('mouseleave', release);
  keyboardEl.appendChild(key);
}

const MIDI_TYPE_NAMES = ['NoteOff', 'NoteOn', 'ControlChange', 'Unknown'];

let history: MidiMonitorEntry[] = [];

function renderMonitor(): void {
  monitorEl.innerHTML = '';
  for (const entry of history) {
    const row = document.createElement('div');
    row.className = 'monitor-row';
    const typeName = MIDI_TYPE_NAMES[entry.midiType] ?? 'Unknown';
    row.textContent = `ch${entry.channel} ${typeName} ${entry.data1} ${entry.data2}`;
    monitorEl.appendChild(row);
  }
  monitorEl.scrollTop = monitorEl.scrollHeight;
}

window.addEventListener('message', (e: MessageEvent<MidiHostMessage>) => {
  const msg = e.data;
  if (msg.command === 'midiRx') {
    history = pushMonitorEntry(history, {
      status: msg.status, data1: msg.data1, data2: msg.data2,
      channel: msg.channel, midiType: msg.midiType, timestamp: performance.now(),
    }, MAX_MONITOR_ENTRIES);
    renderMonitor();
  }
});

vscode.postMessage({ command: 'webviewReady' });
