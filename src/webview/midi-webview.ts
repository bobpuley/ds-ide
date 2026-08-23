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
const pcSelectEl = el<HTMLSelectElement>('pc-select');
const ccNumEl = el<HTMLInputElement>('cc-num');
const ccValEl = el<HTMLInputElement>('cc-val');

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

// Positionally indexed to match daisy::MidiMessageType's enum order
// (emulator/shim/include/daisy/midi_event.h) — keep in sync with it.
const MIDI_TYPE_NAMES = ['NoteOff', 'NoteOn', 'ControlChange', 'ProgramChange', 'Unknown'];

let history: MidiMonitorEntry[] = [];

function renderMonitor(): void {
  monitorEl.innerHTML = '';
  for (const entry of history) {
    const row = document.createElement('div');
    row.className = 'monitor-row dir-' + entry.direction;
    const typeName = MIDI_TYPE_NAMES[entry.midiType] ?? 'Unknown';
    const dirLabel = entry.direction === 'rx' ? '↓ Rx' : '↑ Tx';
    row.textContent = `${dirLabel} ch${entry.channel} ${typeName} ${entry.data1} ${entry.data2}`;
    monitorEl.appendChild(row);
  }
  monitorEl.scrollTop = monitorEl.scrollHeight;
}

window.addEventListener('message', (e: MessageEvent<MidiHostMessage>) => {
  const msg = e.data;
  if (msg.command === 'midiRx' || msg.command === 'midiTx') {
    history = pushMonitorEntry(history, {
      direction: msg.command === 'midiRx' ? 'rx' : 'tx',
      status: msg.status, data1: msg.data1, data2: msg.data2,
      channel: msg.channel, midiType: msg.midiType, timestamp: performance.now(),
    }, MAX_MONITOR_ENTRIES);
    renderMonitor();
  }
});

// FR-MIDI-1: Program Change / Control Change sender.
for (let i = 0; i <= 127; i++) {
  const opt = document.createElement('option');
  opt.value = String(i);
  opt.textContent = String(i);
  pcSelectEl.appendChild(opt);
}

el<HTMLElement>('pc-send').addEventListener('click', () => {
  const program = parseInt(pcSelectEl.value, 10);
  vscode.postMessage({ command: 'programChange', program });
});

el<HTMLElement>('cc-send').addEventListener('click', () => {
  const controller = parseInt(ccNumEl.value, 10);
  const value = parseInt(ccValEl.value, 10);
  vscode.postMessage({ command: 'controlChange', controller, value });
});

vscode.postMessage({ command: 'webviewReady' });
