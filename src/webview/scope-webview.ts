/// <reference lib="dom" />
import type { ScopeHostMessage } from './messages';
import { hasKnownCommand } from './message-guard';
import { el } from './dom-lookup';

const vscode = acquireVsCodeApi();
const canvas = el<HTMLCanvasElement>('scope');
const ctx = canvas.getContext('2d')!;
const specCanvas = el<HTMLCanvasElement>('spectrum');
const specCtx = specCanvas.getContext('2d')!;
const statusEl   = el<HTMLElement>('status-text');
const btnAudioStart = el<HTMLButtonElement>('btn-audio-start');
const btnAudioStop  = el<HTMLButtonElement>('btn-audio-stop');
const eventsEl = el<HTMLElement>('events');
const gettingStarted = el<HTMLElement>('getting-started');
const sineFreqEl = el<HTMLInputElement>('sine-freq');
const sineAmpEl  = el<HTMLInputElement>('sine-amp');
const sineAmpValEl = el<HTMLElement>('sine-amp-val');
const bufferSizeEl = el<HTMLSelectElement>('buffer-size');
const latencyEl = el<HTMLElement>('latency-display');
const wavChooseEl = el<HTMLButtonElement>('wav-choose');
const wavNameEl = el<HTMLElement>('wav-name');
const wavLoopEl = el<HTMLInputElement>('wav-loop');
const outputVolEl = el<HTMLInputElement>('output-vol');
const volValEl = el<HTMLElement>('vol-val');

let lastIn: number[] = [], lastOut: number[] = [];
let lastSpecIn: number[] = [], lastSpecOut: number[] = [], lastBinHz = 0;
const activeEvents = new Set<string>();
let hasStatus = false;
let xrunCount = 0;
let lastStatusRunning = false;
let lastStatusSampleRate = 0;
let lastStatusBlockSize = 0;

function updateStatusEl(): void {
  if (!statusEl || !hasStatus) return;
  const symbol = lastStatusRunning ? '▶' : '■';
  const color  = lastStatusRunning ? '#4ec94e' : '#f04a4a';
  // Built via DOM APIs, never innerHTML — sampleRate/blockSize/xrunCount
  // originate from the emulator's IPC socket (FR-IPC-2).
  statusEl.textContent = '';
  const dot = document.createElement('span');
  dot.style.color = color;
  dot.textContent = symbol;
  statusEl.appendChild(dot);
  statusEl.appendChild(document.createTextNode(
    '  |  ' + lastStatusSampleRate + ' Hz  |  block ' + lastStatusBlockSize + '  |  xruns: ' + xrunCount,
  ));
}

function showScope(): void {
  if (!hasStatus) return;
  canvas.style.display = 'block';
  specCanvas.style.display = 'block';
  gettingStarted.style.display = 'none';
  resize();
}

function resize(): void {
  canvas.width  = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  specCanvas.width  = specCanvas.clientWidth;
  specCanvas.height = specCanvas.clientHeight;
  draw();
  drawSpectrum();
}

function draw(): void {
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#1e1e1e';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#3c3c3c';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2);
  ctx.moveTo(0, H / 4); ctx.lineTo(W, H / 4);
  ctx.moveTo(0, 3 * H / 4); ctx.lineTo(W, 3 * H / 4);
  ctx.stroke();
  drawWave(lastIn,  '#4ec9b0');
  drawWave(lastOut, '#ce9178');
}

function drawWave(pts: number[], color: string): void {
  if (!pts || pts.length < 2) return;
  const W = canvas.width, H = canvas.height;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const x = (i / (pts.length - 1)) * W;
    const y = H / 2 - pts[i]! * (H / 2 * 0.9);
    if (i === 0) ctx.moveTo(x, y);
    else         ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function drawSpectrum(): void {
  const W = specCanvas.width, H = specCanvas.height;
  specCtx.clearRect(0, 0, W, H);
  specCtx.fillStyle = '#1a1a1a';
  specCtx.fillRect(0, 0, W, H);
  if (!lastSpecIn || lastSpecIn.length < 2) return;
  const N = lastSpecIn.length;
  const maxFreq = Math.min(20000, lastBinHz * N);
  const maxBin  = lastBinHz > 0 ? Math.min(N, Math.ceil(maxFreq / lastBinHz)) : N;
  const peak = Math.max(
    lastSpecIn.slice(0, maxBin).reduce((a, v) => Math.max(a, v), 1e-9),
    lastSpecOut.slice(0, maxBin).reduce((a, v) => Math.max(a, v), 1e-9),
  );
  const LEFT = 36, BOTTOM = 16, TOP = 4;
  const plotW = W - LEFT;
  const plotH = H - BOTTOM - TOP;
  const ampToY = (amp: number): number => TOP + plotH * (1 - amp / peak);
  specCtx.font = '9px monospace';
  specCtx.textAlign = 'right';
  let lastDbLabelY = -Infinity;
  for (let db = 0; db >= -60; db -= 20) {
    const y = ampToY(Math.pow(10, db / 20) * peak);
    specCtx.strokeStyle = '#2a2a2a';
    specCtx.lineWidth = 1;
    specCtx.beginPath();
    specCtx.moveTo(LEFT, y); specCtx.lineTo(W, y);
    specCtx.stroke();
    if (y - lastDbLabelY >= 11) {
      specCtx.fillStyle = '#777';
      specCtx.fillText(db + 'dB', LEFT - 4, y + 4);
      lastDbLabelY = y;
    }
  }
  specCtx.textAlign = 'left';
  specCtx.strokeStyle = '#3c3c3c';
  specCtx.lineWidth = 1;
  specCtx.beginPath();
  specCtx.moveTo(LEFT, TOP + plotH); specCtx.lineTo(W, TOP + plotH);
  specCtx.stroke();
  function drawSpecLine(fft: number[], color: string): void {
    specCtx.strokeStyle = color;
    specCtx.lineWidth = 1.5;
    specCtx.beginPath();
    for (let i = 0; i < maxBin; i++) {
      const x = LEFT + (i / (maxBin - 1)) * plotW;
      const y = ampToY(fft[i]!);
      if (i === 0) specCtx.moveTo(x, y);
      else         specCtx.lineTo(x, y);
    }
    specCtx.stroke();
  }
  drawSpecLine(lastSpecIn,  '#4ec9b0');
  drawSpecLine(lastSpecOut, '#ce9178');
  if (lastBinHz > 0) {
    specCtx.fillStyle = '#999';
    specCtx.font = '10px monospace';
    specCtx.textAlign = 'left';
    const freqLabels = [1000, 2000, 5000, 10000, 20000];
    let lastLabelRight = LEFT - 4;
    for (const f of freqLabels) {
      if (f > maxFreq) break;
      const x = LEFT + (f / maxFreq) * plotW;
      const text = f >= 1000 ? (f / 1000) + 'k' : String(f);
      if (x < lastLabelRight + 4) continue;
      specCtx.fillText(text, x + 2, H - 4);
      lastLabelRight = x + 2 + specCtx.measureText(text).width;
    }
  }
}

function sendSine(): void {
  const freq = parseFloat(sineFreqEl.value);
  const amplitude = parseFloat(sineAmpEl.value);
  if (!isNaN(freq) && !isNaN(amplitude)) {
    vscode.postMessage({ command: 'sine', freq, amplitude });
  }
}

function updateSourceGroups(input: string): void {
  const isSine = input === 'sine';
  const isLive = input === 'live';
  const isWav  = input === 'wav';
  document.getElementById('sine-group')?.classList.toggle('emu-hidden', !isSine);
  document.getElementById('wav-group')?.classList.toggle('emu-hidden', !isWav);
  document.getElementById('buffer-group')?.classList.toggle('emu-hidden', !(isLive || isWav));
  document.getElementById('latency-group')?.classList.toggle('emu-hidden', !isLive);
}

function sendAudioSource(): void {
  const srcEl = document.getElementById('audio-source-select') as HTMLSelectElement | null;
  const input = srcEl ? srcEl.value : 'sine';
  const bufferSize = parseInt(bufferSizeEl?.value || '256', 10);
  const sampleRate = 48000;
  const wavLoop = !!(wavLoopEl && wavLoopEl.checked);
  updateSourceGroups(input);
  vscode.postMessage({
    command: 'audioSource',
    input: input === 'live' || input === 'wav' ? input : 'sine',
    sampleRate, bufferSize, wavLoop,
  });
}

sineFreqEl?.addEventListener('change', sendSine);
sineAmpEl?.addEventListener('input', () => {
  if (sineAmpValEl) sineAmpValEl.textContent = parseFloat(sineAmpEl.value).toFixed(2);
  sendSine();
});
document.getElementById('audio-source-select')?.addEventListener('change', sendAudioSource);
bufferSizeEl?.addEventListener('change', sendAudioSource);
wavChooseEl?.addEventListener('click', () => vscode.postMessage({ command: 'pickWav' }));
wavLoopEl?.addEventListener('change', sendAudioSource);
outputVolEl?.addEventListener('input', () => {
  const vol = parseFloat(outputVolEl.value);
  if (volValEl) volValEl.textContent = vol.toFixed(2);
  vscode.postMessage({ command: 'outputVolume', volume: vol });
});

window.addEventListener('resize', resize);
resize();

const SCOPE_HOST_COMMANDS = new Set<ScopeHostMessage['command']>([
  'scope', 'status', 'wavSelected', 'event', 'xrun', 'latency', 'led',
  'spectrum', 'recordingState', 'replayDone',
]);

window.addEventListener('message', (e: MessageEvent<unknown>) => {
  if (!hasKnownCommand(e.data, SCOPE_HOST_COMMANDS)) return;
  const msg = e.data as ScopeHostMessage;
  if (msg.command === 'scope') {
    lastIn  = msg.in  || [];
    lastOut = msg.out || [];
    draw();
  } else if (msg.command === 'status') {
    hasStatus = true;
    showScope();
    lastStatusRunning   = !!msg.running;
    lastStatusSampleRate = msg.sampleRate || lastStatusSampleRate;
    lastStatusBlockSize  = msg.blockSize  || lastStatusBlockSize;
    updateStatusEl();
    if (btnAudioStart) btnAudioStart.disabled = !!msg.running;
    if (btnAudioStop)  btnAudioStop.disabled  = !msg.running;
    if (!msg.running) {
      activeEvents.clear();
      eventsEl.textContent = '';
    }
  } else if (msg.command === 'wavSelected') {
    if (wavNameEl) wavNameEl.textContent = msg.name || 'no file';
    const srcEl = document.getElementById('audio-source-select') as HTMLSelectElement | null;
    if (srcEl) { srcEl.value = 'wav'; updateSourceGroups('wav'); }
  } else if (msg.command === 'event') {
    if (msg.kind === 'realtime_unavailable') {
      eventsEl.textContent = '⚠ Live input unavailable — check microphone permission. Falling back to sine.';
      const srcEl = document.getElementById('audio-source-select') as HTMLSelectElement | null;
      if (srcEl) { srcEl.value = 'sine'; updateSourceGroups('sine'); }
      return;
    }
    if (msg.kind === 'wav_error') {
      eventsEl.textContent = '⚠ Could not load WAV file — unsupported format or unreadable.';
      return;
    }
    if (typeof msg.kind === 'string') {
      activeEvents.add(msg.kind.toUpperCase());
      eventsEl.textContent = [...activeEvents].map(k => '⚠ ' + k).join('  ');
    }
  } else if (msg.command === 'xrun') {
    xrunCount = msg.count || 0;
    updateStatusEl();
  } else if (msg.command === 'latency') {
    const ms = msg.estimatedMs;
    if (latencyEl) latencyEl.textContent = 'latency: ' + (ms ? ms.toFixed(1) + ' ms' : '—');
  } else if (msg.command === 'led') {
    document.querySelectorAll('.vled-dot[data-pin="' + msg.gpioPin + '"]').forEach(dot => {
      dot.classList.toggle('vled-lit', !!msg.lit);
    });
  } else if (msg.command === 'spectrum') {
    lastSpecIn  = msg.in_fft  || [];
    lastSpecOut = msg.out_fft || [];
    lastBinHz   = msg.binHz   || 0;
    specCanvas.width = specCanvas.clientWidth;
    specCanvas.height = specCanvas.clientHeight;
    drawSpectrum();
  } else if (msg.command === 'recordingState') {
    setRecordingState(!!msg.recording, !!msg.replaying, msg.fileName);
  } else if (msg.command === 'replayDone') {
    setRecordingState(false, false, null);
  }
});

btnAudioStart?.addEventListener('click', () => {
  vscode.postMessage({ command: 'startAudio' });
  if (btnAudioStart) btnAudioStart.disabled = true;
  if (btnAudioStop)  btnAudioStop.disabled  = false;
});
btnAudioStop?.addEventListener('click', () => {
  vscode.postMessage({ command: 'stopAudio' });
  if (btnAudioStart) btnAudioStart.disabled = false;
  if (btnAudioStop)  btnAudioStop.disabled  = true;
  lastStatusRunning = false;
  updateStatusEl();
});

const recStartBtn   = el<HTMLButtonElement>('rec-start-btn');
const recStopBtn    = el<HTMLButtonElement>('rec-stop-btn');
const replayBtn     = el<HTMLButtonElement>('replay-start-btn');
const recFilenameEl = el<HTMLElement>('rec-filename');

let isRecording = false;
let isReplaying = false;

function setRecordingState(recording: boolean, replaying: boolean, fileName?: string | null): void {
  isRecording = recording;
  isReplaying = replaying;
  recStartBtn.disabled  = recording || replaying;
  recStopBtn.disabled   = !recording;
  replayBtn.disabled    = recording || replaying;
  recStartBtn.classList.toggle('recording', recording);
  replayBtn.classList.toggle('replaying', replaying);
  if (fileName != null) recFilenameEl.textContent = fileName || '';
}

recStartBtn.addEventListener('click', () => {
  if (isRecording || isReplaying) return;
  vscode.postMessage({ command: 'recordStart' });
});
recStopBtn.addEventListener('click', () => {
  if (!isRecording) return;
  vscode.postMessage({ command: 'recordStop' });
});
replayBtn.addEventListener('click', () => {
  if (isRecording || isReplaying) return;
  vscode.postMessage({ command: 'replayStart' });
});

vscode.postMessage({ command: 'webviewReady' });
