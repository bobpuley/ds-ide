/// <reference lib="dom" />
import type { ScopeHostMessage } from './messages';
import { hasKnownCommand } from './message-guard';
import { el } from './dom-lookup';
import { createRafCoalescer } from './raf-coalesce';
import { readThemeColor, onThemeChange } from './theme/theme-runtime';
import { loadScopeColors } from './scope-colors';
import { ScopeCapture } from './scope/scope-capture';
import {
  DEFAULT_TIME_BASE_MS, DIVISIONS, windowSamples, pointsPerDivision, isLowResolution,
  visibleRange, timeTicks, amplitudeTicks, autoGain, peakAbs, samplePosition, type GainMode, type AmpUnit,
} from './scope/scope-view';

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
const scopeControlsEl = el<HTMLElement>('scope-controls');
const timeBaseEl = el<HTMLSelectElement>('timebase');
const rateNoteEl = el<HTMLElement>('rate-note');

// Canvas colours come from the theme (FR-THM-2): read once here and again only
// when the theme changes (FR-THM-5), never per frame.
let colors = loadScopeColors(n => readThemeColor(n));

let lastIn: number[] = [], lastOut: number[] = [];
// FR-SCI-3: stitched history of the snapshots; the axes / time-base tasks draw from it.
const capture = new ScopeCapture();
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
  const color  = lastStatusRunning ? colors.running : colors.stopped;
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
  scopeControlsEl.style.display = 'flex';
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

// Plot margins leave room for the axis labels (FR-SCI-4).
const PLOT_LEFT = 44, PLOT_RIGHT = 8, PLOT_TOP = 8, PLOT_BOTTOM = 18;
let msPerDiv = DEFAULT_TIME_BASE_MS;
let gainMode: GainMode = 1;
let ampUnit: AmpUnit = 'lin';

function updateRateNote(): void {
  const rate = capture.effectiveRate;
  if (rate <= 0) { rateNoteEl.textContent = ''; rateNoteEl.classList.remove('low-res'); return; }
  const low = isLowResolution(msPerDiv, rate);
  const ppd = Math.round(pointsPerDivision(msPerDiv, rate));
  rateNoteEl.textContent = `effective rate ${(rate / 1000).toFixed(rate % 1000 ? 1 : 0)} kHz` +
    (low ? ` — low resolution (${ppd} points/div)` : '');
  rateNoteEl.classList.toggle('low-res', low);
}

function draw(): void {
  const W = canvas.width, H = canvas.height;
  const pw = W - PLOT_LEFT - PLOT_RIGHT, ph = H - PLOT_TOP - PLOT_BOTTOM;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, W, H);
  if (pw <= 0 || ph <= 0) return;
  ctx.lineWidth = 1;
  ctx.font = '10px monospace';
  ctx.fillStyle = colors.axis;
  // Amplitude axis: a grid line and a label per tick.
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const win = windowSamples(msPerDiv, capture.effectiveRate);
  // Until the rate is known (no status yet), fall back to the newest snapshot as before.
  const inBuf = win > 0 ? capture.channel('in') : lastIn;
  const outBuf = win > 0 ? capture.channel('l') : lastOut;
  const span = win > 0 ? win : lastIn.length;
  const range = visibleRange(inBuf.length, span);
  const gain = gainMode === 'auto'
    ? autoGain(Math.max(peakAbs(inBuf, range.start, range.count), peakAbs(outBuf, range.start, range.count)))
    : gainMode;
  for (const t of amplitudeTicks(gain, ampUnit)) {
    const y = PLOT_TOP + ph * (0.5 - t.pos / 2);
    ctx.strokeStyle = colors.grid;
    ctx.beginPath(); ctx.moveTo(PLOT_LEFT, y + 0.5); ctx.lineTo(PLOT_LEFT + pw, y + 0.5); ctx.stroke();
    if (t.label) ctx.fillText(t.label, PLOT_LEFT - 4, y);
  }
  // Time axis: ten divisions, labelled in ms every second one.
  ctx.strokeStyle = colors.grid;
  for (let d = 0; d <= DIVISIONS; d++) {
    const x = PLOT_LEFT + (pw * d) / DIVISIONS;
    ctx.beginPath(); ctx.moveTo(x + 0.5, PLOT_TOP); ctx.lineTo(x + 0.5, PLOT_TOP + ph); ctx.stroke();
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const t of timeTicks(msPerDiv)) {
    ctx.fillText(t.label, PLOT_LEFT + (pw * t.div) / DIVISIONS, PLOT_TOP + ph + 4);
  }
  ctx.textAlign = 'right';
  ctx.fillText('ms', W - 2, PLOT_TOP + ph + 4);

  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText(`×${gain >= 10 ? gain.toFixed(0) : gain.toFixed(1).replace(/\.0$/, '')}${gainMode === 'auto' ? ' auto' : ''}`, W - PLOT_RIGHT - 4, PLOT_TOP + 3);
  const { start, count } = range;
  ctx.save();
  ctx.beginPath(); ctx.rect(PLOT_LEFT, PLOT_TOP, pw, ph); ctx.clip();
  drawWave(inBuf, start, count, span, gain, colors.traceIn, pw, ph);
  drawWave(outBuf, start, count, span, gain, colors.traceOut, pw, ph);
  ctx.restore();
}

function drawWave(
  pts: readonly number[], start: number, count: number, span: number, gain: number, color: string, pw: number, ph: number,
): void {
  if (count < 2 || span < 2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < count; i++) {
    const x = PLOT_LEFT + (i / (span - 1)) * pw;
    const y = PLOT_TOP + ph * (0.5 - samplePosition(pts[start + i] ?? 0, gain, ampUnit) / 2);
    if (i === 0) ctx.moveTo(x, y);
    else         ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function drawSpectrum(): void {
  const W = specCanvas.width, H = specCanvas.height;
  specCtx.clearRect(0, 0, W, H);
  specCtx.fillStyle = colors.background;
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
    specCtx.strokeStyle = colors.grid;
    specCtx.lineWidth = 1;
    specCtx.beginPath();
    specCtx.moveTo(LEFT, y); specCtx.lineTo(W, y);
    specCtx.stroke();
    if (y - lastDbLabelY >= 11) {
      specCtx.fillStyle = colors.axis;
      specCtx.fillText(db + 'dB', LEFT - 4, y + 4);
      lastDbLabelY = y;
    }
  }
  specCtx.textAlign = 'left';
  specCtx.strokeStyle = colors.grid;
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
  drawSpecLine(lastSpecIn,  colors.traceIn);
  drawSpecLine(lastSpecOut, colors.traceOut);
  if (lastBinHz > 0) {
    specCtx.fillStyle = colors.axis;
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

timeBaseEl?.addEventListener('change', () => {
  msPerDiv = parseFloat(timeBaseEl.value) || DEFAULT_TIME_BASE_MS;
  updateRateNote();
  flushScopeDraw();
});
function wireSegment(id: string, attr: string, onPick: (value: string) => void): void {
  const seg = document.getElementById(id);
  seg?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('.seg-btn');
    const value = btn?.dataset[attr];
    if (!btn || value === undefined) return;
    seg.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b === btn));
    onPick(value);
    flushScopeDraw();
  });
}
wireSegment('gain-seg', 'gain', v => { gainMode = v === 'auto' ? 'auto' : (Number(v) as GainMode); });
wireSegment('unit-seg', 'unit', v => { ampUnit = v === 'db' ? 'db' : 'lin'; });
window.addEventListener('resize', resize);
// Repaint in the new theme even when nothing is streaming (stopped scope, FR-THM-5).
onThemeChange(() => {
  colors = loadScopeColors(n => readThemeColor(n));
  updateStatusEl();
  draw();
  drawSpectrum();
});
resize();

// FR-EXT-34: 'scope'/'spectrum' IPC messages can arrive well above the
// display refresh rate — draw()/drawSpectrum() read current module state
// (lastIn/lastOut/lastSpecIn/lastSpecOut) rather than a passed argument, so
// coalescing the *call* to one per frame is enough; the redraw always picks
// up whatever the latest message left in that state (mirrors the pot/
// encoder knob drag coalescing in controls/convention-canvas.ts).
const flushScopeDraw = createRafCoalescer<void>(() => draw(), (cb) => requestAnimationFrame(cb));
const flushSpectrumDraw = createRafCoalescer<void>(() => drawSpectrum(), (cb) => requestAnimationFrame(cb));

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
    capture.push({ in: lastIn, out: lastOut, outR: msg.out_r, step: msg.step });
    updateRateNote();
    flushScopeDraw();
  } else if (msg.command === 'status') {
    hasStatus = true;
    showScope();
    lastStatusRunning   = !!msg.running;
    lastStatusSampleRate = msg.sampleRate || lastStatusSampleRate;
    lastStatusBlockSize  = msg.blockSize  || lastStatusBlockSize;
    // A rate / block-size change or a stop leaves stale-rate samples in the ring.
    capture.setConfig(lastStatusSampleRate, lastStatusBlockSize);
    if (!msg.running) capture.clear();
    updateRateNote();
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
    flushSpectrumDraw();
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
