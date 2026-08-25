/// <reference lib="dom" />
import type { ControlsHostMessage, ControlsWebviewMessage } from './messages';
import type { ConventionControl } from '../controllers/controls-convention-parser';
import type { ControlsPlacement } from './scope-panel';
import type { ControllerConfig, Taper, ButtonMode, ActiveLevel } from '../controllers/controller-config';
import type { DeviceType } from '../wiring/wiring-panel';
import { computeKnobGeometry, KNOB_SVG_SIZE, KNOB_CENTER } from './knob-math';
import { createRafCoalescer } from './raf-coalesce';
import { TOGGLE_POSITIONS } from '../devices/codegen/toggle';
import { ENCODER_POSITION_MODULUS, wrapEncoderPosition } from '../devices/codegen/encoder';
import { SdEntry, isTxtEntryName, formatSdSize } from './sd-viewer';
import { decodeOledFrame, computeFrameRate } from './oled-frame';
import { hasKnownCommand } from './message-guard';

interface VsCodeApiForControls {
  postMessage(msg: ControlsWebviewMessage): void;
}

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

// A row in the legacy (missingBlock) YAML editor canvas — unifies the three
// device shapes with kind-specific fields left null where inapplicable.
interface EditorControl {
  kind: DeviceType;
  id: string;
  label: string;
  adcChannel: number | null;
  range: [number, number] | null;
  taper: Taper | null;
  def: number | null;
  gpioPin: number | null;
  mode: ButtonMode | null;
  activeLevel: ActiveLevel | null;
  pos: [number, number];
}

const vscode = acquireVsCodeApi() as unknown as VsCodeApiForControls;
const TRUNC_MAX_LEN = 15;
const TRUNC_SUFFIX = '…';
function truncId(id: string): string { return id.length > TRUNC_MAX_LEN ? id.slice(0, TRUNC_MAX_LEN - 1) + TRUNC_SUFFIX : id; }

type DocListener = { event: string; fn: EventListener };
const _docListeners: DocListener[] = [];
function _addDocListener(event: string, fn: EventListener): void {
  document.addEventListener(event, fn);
  _docListeners.push({ event, fn });
}
function clearDocListeners(): void {
  for (const { event, fn } of _docListeners) document.removeEventListener(event, fn);
  _docListeners.length = 0;
}

const _yamlInitEl = document.getElementById('yaml-init');
const _yamlInit = JSON.parse(_yamlInitEl ? _yamlInitEl.textContent || '{}' : '{}') as Partial<ControllerConfig>;
let _yamlCfg: ControllerConfig = {
  pots: _yamlInit.pots || [], buttons: _yamlInit.buttons || [], leds: _yamlInit.leds || [],
  encoders: _yamlInit.encoders || [], toggles: _yamlInit.toggles || [], rgbleds: _yamlInit.rgbleds || [],
  errors: [],
};

let conventionControls: ConventionControl[] = [];
let conventionPlacements: ControlsPlacement[] = [];
let conventionMissing = true;
let ceEmulatorRunning = false;
let editorControls: EditorControl[] = [];
let nextCtrlIdx = 0;

function escJ(s: unknown): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

type ControlsConfigMsg = Extract<ControlsHostMessage, { command: 'controlsConfig' }>;

function applyControlsConfig(msg: ControlsConfigMsg): void {
  conventionControls = msg.controls || [];
  conventionPlacements = msg.placements || [];
  conventionMissing = !!msg.missingBlock;
  const banner = document.getElementById('convention-banner');
  if (banner) banner.style.display = conventionMissing ? 'flex' : 'none';
  const palette = document.getElementById('palette');
  if (palette) palette.style.display = conventionMissing ? 'flex' : 'none';
  if (!conventionMissing) {
    renderConventionCanvas();
  } else {
    renderCanvas();
  }
}

function updateCeEmulatorState(running: boolean): void {
  ceEmulatorRunning = running;
  const ceStatusEl = document.getElementById('ce-emu-status');
  if (ceStatusEl) {
    ceStatusEl.textContent = running ? '▶' : '■';
    ceStatusEl.className = running ? 'ce-emu-running' : 'ce-emu-stopped';
  }
  document.querySelectorAll('#canvas-area .ctrl-body').forEach(body => {
    body.classList.toggle('body-disabled', !running);
  });
}

function renderConventionCanvas(): void {
  clearDocListeners();
  const area = document.getElementById('canvas-area');
  const hint = document.getElementById('canvas-hint');
  if (!area) return;
  area.querySelectorAll('.ctrl-card').forEach(c => c.remove());
  const placementMap: Record<string, [number, number]> = {};
  for (const p of conventionPlacements) placementMap[p.id] = p.pos;
  const conventionIds = new Set(conventionControls.map(c => c.id));
  let ax = 20, ay = 20;
  function nextPos(): [number, number] { const p: [number, number] = [ax, ay]; ax += 190; if (ax > 580) { ax = 20; ay += 170; } return p; }
  for (const ctrl of conventionControls) {
    const pos = placementMap[ctrl.id] || nextPos();
    area.appendChild(buildConventionCard(ctrl, pos));
  }
  for (const pl of conventionPlacements) {
    if (!conventionIds.has(pl.id)) area.appendChild(buildNotInCodeCard(pl));
  }
  if (hint) hint.style.display = (conventionControls.length === 0 && conventionPlacements.length === 0) ? 'flex' : 'none';
  updateCeEmulatorState(ceEmulatorRunning);
}

function buildKnobSvg(value: number): string {
  const { trackPath, valuePath, dotX, dotY } = computeKnobGeometry(value);
  return `<svg class="knob-svg" viewBox="0 0 ${KNOB_SVG_SIZE} ${KNOB_SVG_SIZE}" width="${KNOB_SVG_SIZE}" height="${KNOB_SVG_SIZE}">` +
    `<circle cx="${KNOB_CENTER}" cy="${KNOB_CENTER}" r="18" fill="#1e1e1e" stroke="#3c3c3c" stroke-width="1.5"/>` +
    '<path d="' + trackPath + '" fill="none" stroke="#3c3c3c" stroke-width="3" stroke-linecap="round"/>' +
    '<path class="knob-value-path" d="' + (valuePath ?? 'M 0 0') + '" fill="none" stroke="#4ec9b0" stroke-width="3" stroke-linecap="round"' + (valuePath ? '' : ' style="display:none"') + '/>' +
    '<circle class="knob-dot" cx="' + dotX.toFixed(2) + '" cy="' + dotY.toFixed(2) + '" r="2.5" fill="#4ec9b0"/>' +
    '</svg>';
}

function updateKnobPaths(knobWrap: HTMLElement, value: number): number {
  const { clampedValue, valuePath, dotX, dotY } = computeKnobGeometry(value);
  const vp = knobWrap.querySelector('.knob-value-path') as SVGPathElement | null;
  if (vp) {
    if (valuePath) {
      vp.setAttribute('d', valuePath);
      vp.style.display = '';
    } else {
      vp.style.display = 'none';
    }
  }
  const dot = knobWrap.querySelector('.knob-dot');
  if (dot) { dot.setAttribute('cx', dotX.toFixed(2)); dot.setAttribute('cy', dotY.toFixed(2)); }
  const valEl = knobWrap.querySelector('.knob-value');
  if (valEl) valEl.textContent = clampedValue.toFixed(3);
  return clampedValue;
}

// sdcard (FR-DEV-10), oled (FR-DEV-14), midiTrs (FR-DEV-16) and midiUsb
// (FR-DEV-17) are bus-attached peripherals and never appear as a control card
// here (they have no ConventionControl entry — see wiredControlIds() in
// devices/registry.ts) — their labels exist only to satisfy DeviceType's
// exhaustiveness.
const KIND_LABELS: Record<DeviceType, string> = {
  pot: 'Pot', button: 'Button', led: 'LED', toggle: 'Toggle', rgbled: 'RGB LED', encoder: 'Encoder',
  sdcard: 'SD Card', oled: 'OLED', midiTrs: 'MIDI TRS', midiUsb: 'MIDI USB',
};

// Encoder rotary dial (FR-DEV-9) — endless rotation, so unlike the pot's
// knob (a bounded arc over [0,1]) this always shows a full circle; the
// pointer's angle is the wrapped position mapped onto a coarser visual
// detent count purely for legibility (the wire value stays the full
// ENCODER_POSITION_MODULUS-resolution position — see codegen/encoder.ts).
const ENCODER_VISIBLE_DETENTS = 32;
const ENCODER_PX_PER_DETENT = 12;

function buildEncoderSvg(position: number): string {
  const cx = KNOB_CENTER, cy = KNOB_CENTER, r = 18;
  const angleDeg = (position % ENCODER_VISIBLE_DETENTS) * (360 / ENCODER_VISIBLE_DETENTS);
  const rad = (angleDeg * Math.PI) / 180;
  const dotX = cx + r * 0.7 * Math.sin(rad);
  const dotY = cy - r * 0.7 * Math.cos(rad);
  return `<svg class="knob-svg" viewBox="0 0 ${KNOB_SVG_SIZE} ${KNOB_SVG_SIZE}" width="${KNOB_SVG_SIZE}" height="${KNOB_SVG_SIZE}">` +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#1e1e1e" stroke="#3c3c3c" stroke-width="1.5"/>` +
    `<line x1="${cx}" y1="${cy}" x2="${dotX.toFixed(2)}" y2="${dotY.toFixed(2)}" stroke="#dcdcaa" stroke-width="2" stroke-linecap="round"/>` +
    `<circle cx="${dotX.toFixed(2)}" cy="${dotY.toFixed(2)}" r="2.5" fill="#dcdcaa"/>` +
    '</svg>';
}

function buildConventionCard(ctrl: ConventionControl, pos: [number, number]): HTMLElement {
  const kindLabel = KIND_LABELS[ctrl.kind];
  const card = document.createElement('div');
  card.className = 'ctrl-card';
  card.dataset['kind'] = ctrl.kind;
  card.dataset['id'] = ctrl.id;
  card.style.minWidth = '90px';
  card.style.left = pos[0] + 'px';
  card.style.top = pos[1] + 'px';

  let bodyInnerHtml = '';
  let adcCh = 0;
  if (ctrl.kind === 'pot') {
    adcCh = adcChannelFromPin(ctrl.pin);
    bodyInnerHtml =
      '<div class="knob-wrap" data-channel="' + adcCh + '" data-value="0">' +
        buildKnobSvg(0) +
        '<span class="knob-value">0.000</span>' +
      '</div>';
  } else if (ctrl.kind === 'button') {
    bodyInnerHtml =
      '<button class="btn-ce" type="button" data-pin="' + ctrl.pin + '" aria-pressed="false"></button>';
  } else if (ctrl.kind === 'toggle') {
    bodyInnerHtml =
      '<button class="tgl-ce" type="button" data-pin="' + ctrl.pin + '" data-pos="0">0</button>';
  } else if (ctrl.kind === 'rgbled') {
    // Keyed by the primary (first/red-channel) pin — matches the IPC
    // rgbLed message's gpioPin, which is the shim's r_pin_ (FR-DEV-8).
    bodyInnerHtml =
      '<span class="vrgb-dot" data-pin="' + ctrl.pin + '"></span>';
  } else if (ctrl.kind === 'encoder') {
    bodyInnerHtml =
      '<div class="enc-wrap" data-pos="0">' +
        buildEncoderSvg(0) +
        '<span class="enc-value">0</span>' +
      '</div>';
  } else {
    bodyInnerHtml =
      '<span class="vled-dot" data-pin="' + ctrl.pin + '"></span>';
  }

  card.innerHTML =
    '<div class="ctrl-handle" title="' + escJ(kindLabel + ' \xb7 pin ' + ctrl.pin) + '">' +
      '<span class="handle-glyph">&#x283F;</span>' +
      '<span class="card-id-label" title="' + escJ(ctrl.id) + '">' + escJ(truncId(ctrl.id)) + '</span>' +
    '</div>' +
    '<div class="ctrl-body' + (ceEmulatorRunning ? '' : ' body-disabled') + '">' +
      bodyInnerHtml +
    '</div>';

  if (ctrl.kind === 'pot') {
    const knobWrap = card.querySelector('.knob-wrap') as HTMLElement;
    let kDrag = false, kStartY = 0, kStartVal = 0;
    knobWrap.addEventListener('mousedown', e => {
      kDrag = true;
      kStartY = (e as MouseEvent).clientY;
      kStartVal = parseFloat(knobWrap.dataset['value'] || '0');
      e.preventDefault();
    });
    // Raw mousemove can fire well above the display refresh rate; coalescing
    // to one update per animation frame keeps the DOM write + IPC postMessage
    // at a smooth, bounded rate instead of one of each per native event
    // (FR-UX-5). The extension-host side (PotStore) separately debounces its
    // own workspaceState persistence — this only bounds the webview's work.
    const flushKnobMove = createRafCoalescer<number>((targetValue) => {
      const newVal = updateKnobPaths(knobWrap, targetValue);
      knobWrap.dataset['value'] = String(newVal);
      vscode.postMessage({ command: 'pot', channel: adcCh, value: newVal });
    }, (cb) => requestAnimationFrame(cb));
    const onKnobMove = (e: Event): void => {
      if (!kDrag) return;
      const delta = (kStartY - (e as MouseEvent).clientY) / 100;
      flushKnobMove(kStartVal + delta);
    };
    const onKnobUp = (): void => { kDrag = false; };
    _addDocListener('mousemove', onKnobMove);
    _addDocListener('mouseup', onKnobUp);
  } else if (ctrl.kind === 'button') {
    const btn = card.querySelector('.btn-ce') as HTMLButtonElement;
    const gpioPin = ctrl.pin;
    const btnMode = (_yamlCfg.buttons.find(b => b.id === ctrl.id))?.mode || 'momentary';
    if (btnMode === 'toggle') {
      let latch = false;
      btn.addEventListener('mousedown', () => {
        latch = !latch;
        btn.setAttribute('aria-pressed', String(latch));
        vscode.postMessage({ command: 'button', gpioPin, pressed: true });
      });
      btn.addEventListener('mouseup', () => {
        vscode.postMessage({ command: 'button', gpioPin, pressed: false });
      });
    } else {
      const press   = (): void => { btn.setAttribute('aria-pressed', 'true');  vscode.postMessage({ command: 'button', gpioPin, pressed: true }); };
      const release = (): void => { btn.setAttribute('aria-pressed', 'false'); vscode.postMessage({ command: 'button', gpioPin, pressed: false }); };
      btn.addEventListener('mousedown', press);
      btn.addEventListener('mouseup',   release);
      btn.addEventListener('mouseleave', () => { if (btn.getAttribute('aria-pressed') === 'true') release(); });
    }
  } else if (ctrl.kind === 'toggle') {
    // Cycles 0 -> 1 -> 2 -> 0 on each click (FR-DEV-7) — the multi-position
    // primitive's minimal interaction; no drag state to track, unlike pot's knob.
    const tgl = card.querySelector('.tgl-ce') as HTMLButtonElement;
    const gpioPin = ctrl.pin;
    tgl.addEventListener('click', () => {
      const next = (parseInt(tgl.dataset['pos'] || '0', 10) + 1) % TOGGLE_POSITIONS;
      tgl.dataset['pos'] = String(next);
      tgl.textContent = String(next);
      vscode.postMessage({ command: 'toggle', gpioPin, position: next });
    });
  } else if (ctrl.kind === 'encoder') {
    // Vertical drag in ENCODER_PX_PER_DETENT-px steps (the "detents") —
    // unlike pot's continuous knob, only whole-detent movement posts a
    // message, and rotation is endless (wraps via wrapEncoderPosition)
    // rather than clamped to [0,1] (FR-DEV-9).
    const encWrap = card.querySelector('.enc-wrap') as HTMLElement;
    const gpioPin = ctrl.pin;
    let eDrag = false, eStartY = 0, eStartPos = 0, eLastSentPos = 0;
    encWrap.addEventListener('mousedown', e => {
      eDrag = true;
      eStartY = (e as MouseEvent).clientY;
      eStartPos = parseInt(encWrap.dataset['pos'] || '0', 10);
      eLastSentPos = eStartPos;
      e.preventDefault();
    });
    const flushEncoderMove = createRafCoalescer<number>((targetPos) => {
      const wrapped = wrapEncoderPosition(targetPos);
      encWrap.dataset['pos'] = String(wrapped);
      encWrap.innerHTML = buildEncoderSvg(wrapped) + '<span class="enc-value">' + wrapped + '</span>';
      if (wrapped !== eLastSentPos) {
        eLastSentPos = wrapped;
        vscode.postMessage({ command: 'encoder', gpioPin, position: wrapped });
      }
    }, (cb) => requestAnimationFrame(cb));
    const onEncoderMove = (e: Event): void => {
      if (!eDrag) return;
      const pxDelta = eStartY - (e as MouseEvent).clientY;
      const detents = Math.round(pxDelta / ENCODER_PX_PER_DETENT);
      flushEncoderMove(eStartPos + detents);
    };
    const onEncoderUp = (): void => { eDrag = false; };
    _addDocListener('mousemove', onEncoderMove);
    _addDocListener('mouseup', onEncoderUp);
  }

  makeDraggable(card, { pos: [pos[0], pos[1]] });
  return card;
}

function buildNotInCodeCard(pl: ControlsPlacement): HTMLElement {
  const card = document.createElement('div');
  card.className = 'ctrl-card not-in-code-card';
  card.dataset['id'] = pl.id;
  card.style.left = pl.pos[0] + 'px';
  card.style.top = pl.pos[1] + 'px';
  card.style.opacity = '0.4';
  card.innerHTML =
    '<div class="card-header"><span class="card-kind" style="color:#f48771">not in code</span></div>' +
    '<div class="card-body"><div class="card-field"><label>id</label><span class="card-val">' + escJ(pl.id) + '</span></div></div>';
  return card;
}

function adcChannelFromPin(pin: number): number {
  if (pin >= 15 && pin <= 25) return pin - 15;
  if (pin === 28) return 11;
  return 0;
}

function makeDraggable(card: HTMLElement, ctrl: { pos: [number, number] }): void {
  const header = (card.querySelector('.ctrl-handle') || card.querySelector('.card-header')) as HTMLElement | null;
  if (!header) return;
  let drag = false, sx = 0, sy = 0, sl = 0, st = 0;
  header.addEventListener('mousedown', e => {
    const me = e as MouseEvent;
    if ((me.target as HTMLElement).closest('.card-del')) return;
    drag = true; sx = me.clientX; sy = me.clientY;
    sl = parseInt(card.style.left, 10) || 0; st = parseInt(card.style.top, 10) || 0;
    e.preventDefault();
  });
  _addDocListener('mousemove', e => {
    if (!drag) return;
    const me = e as MouseEvent;
    const nx = Math.max(0, sl + me.clientX - sx);
    const ny = Math.max(0, st + me.clientY - sy);
    card.style.left = nx + 'px'; card.style.top = ny + 'px';
    ctrl.pos = [nx, ny];
  });
  _addDocListener('mouseup', () => { drag = false; });
}

// ── Legacy YAML editor (missingBlock mode) ───────────────────────────────
function editorLoad(cfg: Partial<ControllerConfig>): void {
  _yamlCfg = {
    pots: cfg.pots || [], buttons: cfg.buttons || [], leds: cfg.leds || [],
    encoders: cfg.encoders || [], toggles: cfg.toggles || [], rgbleds: cfg.rgbleds || [],
    errors: [],
  };
  editorControls = [];
  let ax = 20, ay = 20;
  function nextPos(): [number, number] { const p: [number, number] = [ax, ay]; ax += 190; if (ax > 580) { ax = 20; ay += 170; } return p; }
  for (const p of (cfg.pots || [])) editorControls.push({ kind: 'pot', id: p.id, label: p.label, adcChannel: p.adcChannel, range: p.range || [0, 1], taper: p.taper || 'linear', def: p.default ?? 0.5, gpioPin: null, mode: null, activeLevel: null, pos: p.pos || nextPos() });
  for (const b of (cfg.buttons || [])) editorControls.push({ kind: 'button', id: b.id, label: b.label, adcChannel: null, range: null, taper: null, def: null, gpioPin: b.gpioPin ?? 0, mode: b.mode || 'momentary', activeLevel: b.activeLevel || 'low', pos: b.pos || nextPos() });
  for (const l of (cfg.leds || [])) editorControls.push({ kind: 'led', id: l.id, label: l.label, adcChannel: null, range: null, taper: null, def: null, gpioPin: l.gpioPin ?? 0, mode: null, activeLevel: null, pos: l.pos || nextPos() });
  nextCtrlIdx = Math.max(editorControls.length, nextCtrlIdx);
  // Canvas rendering is owned by applyControlsConfig() (driven by the
  // 'controlsConfig' message's authoritative missingBlock flag), not here —
  // editorLoad()'s job is only to refresh _yamlCfg/editorControls. Every
  // real call site sends 'editorLoad' immediately followed by
  // 'controlsConfig' (loadEditor() then postControlsConfig(), or _flush()'s
  // same order), so rendering unconditionally here used to momentarily (or,
  // after FR-CE-1's fix started firing this pair right after a layout save,
  // visibly) stomp a convention-mode canvas with the legacy YAML-editor's
  // card set before the very next message corrected it (FR-CE-1 follow-up).
}

function renderCanvas(): void {
  clearDocListeners();
  const area = el<HTMLElement>('canvas-area');
  const hint = document.getElementById('canvas-hint');
  area.innerHTML = '';
  if (hint) area.appendChild(hint);
  if (hint) hint.style.display = editorControls.length ? 'none' : 'flex';
  for (const ctrl of editorControls) area.appendChild(buildCard(ctrl));
}

function buildCard(ctrl: EditorControl): HTMLElement {
  const kindLabel = ctrl.kind === 'pot' ? 'Pot' : ctrl.kind === 'button' ? 'Button' : 'LED';
  const pinOpts = [...Array(32).keys()].map(i => '<option value="' + i + '"' + (ctrl.gpioPin === i ? ' selected' : '') + '>pin ' + i + '</option>').join('');
  const chOpts  = [...Array(12).keys()].map(i => '<option value="' + i + '"' + (ctrl.adcChannel === i ? ' selected' : '') + '>ch ' + i + '</option>').join('');
  const taperOpts = (['linear', 'log', 'antilog'] as const).map(t => '<option value="' + t + '"' + (ctrl.taper === t ? ' selected' : '') + '>' + t + '</option>').join('');
  const modeOpts  = (['momentary', 'toggle'] as const).map(m => '<option value="' + m + '"' + (ctrl.mode === m ? ' selected' : '') + '>' + m + '</option>').join('');

  const card = document.createElement('div');
  card.className = 'ctrl-card';
  card.dataset['kind'] = ctrl.kind;
  card.style.left = ctrl.pos[0] + 'px';
  card.style.top  = ctrl.pos[1] + 'px';
  card.innerHTML =
    '<div class="card-header">' +
      '<span class="card-kind">' + kindLabel + '</span>' +
      '<button class="card-del" title="Remove">\xD7</button>' +
    '</div>' +
    '<div class="card-body">' +
      '<div class="card-field"><label>ID</label><input class="card-inp card-id" value="' + escJ(ctrl.id) + '"/></div>' +
      '<div class="card-field"><label>Label</label><input class="card-inp card-lbl" value="' + escJ(ctrl.label) + '"/></div>' +
      (ctrl.kind === 'pot'
        ? '<div class="card-field"><label>ADC ch</label><select class="card-sel card-ch">' + chOpts + '</select></div>' +
          '<div class="card-field"><label>Taper</label><select class="card-sel card-taper">' + taperOpts + '</select></div>' +
          '<div class="card-field"><label>Default</label><input class="card-inp card-def" type="number" min="0" max="1" step="0.01" value="' + ctrl.def + '"/></div>'
        : '<div class="card-field"><label>GPIO pin</label><select class="card-sel card-pin">' + pinOpts + '</select></div>' +
          (ctrl.kind === 'button' ? '<div class="card-field"><label>Mode</label><select class="card-sel card-mode">' + modeOpts + '</select></div>' : '')) +
    '</div>';

  (card.querySelector('.card-del') as HTMLElement).addEventListener('click', () => {
    editorControls = editorControls.filter(c => c !== ctrl);
    card.remove();
    const hint = document.getElementById('canvas-hint');
    if (hint) hint.style.display = editorControls.length ? 'none' : 'flex';
  });
  (card.querySelector('.card-id') as HTMLInputElement).addEventListener('input', e => { ctrl.id = (e.target as HTMLInputElement).value; });
  (card.querySelector('.card-lbl') as HTMLInputElement).addEventListener('input', e => { ctrl.label = (e.target as HTMLInputElement).value; });
  if (ctrl.kind === 'pot') {
    (card.querySelector('.card-ch') as HTMLSelectElement).addEventListener('change', e => { ctrl.adcChannel = parseInt((e.target as HTMLSelectElement).value, 10); });
    (card.querySelector('.card-taper') as HTMLSelectElement).addEventListener('change', e => { ctrl.taper = (e.target as HTMLSelectElement).value as Taper; });
    (card.querySelector('.card-def') as HTMLInputElement).addEventListener('change', e => { ctrl.def = parseFloat((e.target as HTMLInputElement).value); });
  } else {
    (card.querySelector('.card-pin') as HTMLSelectElement).addEventListener('change', e => { ctrl.gpioPin = parseInt((e.target as HTMLSelectElement).value, 10); });
    if (ctrl.kind === 'button') (card.querySelector('.card-mode') as HTMLSelectElement).addEventListener('change', e => { ctrl.mode = (e.target as HTMLSelectElement).value as ButtonMode; });
  }
  makeDraggable(card, ctrl);
  return card;
}

// ── Palette drop ─────────────────────────────────────────────────────────
document.querySelectorAll('.palette-item').forEach(item => {
  item.addEventListener('dragstart', e => {
    const de = e as DragEvent;
    de.dataTransfer?.setData('text/plain', (item as HTMLElement).dataset['kind'] || '');
  });
});
const canvasArea = el<HTMLElement>('canvas-area');
canvasArea.addEventListener('dragover', e => e.preventDefault());
canvasArea.addEventListener('drop', e => {
  const de = e as DragEvent;
  de.preventDefault();
  const kind = de.dataTransfer?.getData('text/plain');
  if (kind !== 'pot' && kind !== 'button' && kind !== 'led') return;
  const rect = canvasArea.getBoundingClientRect();
  const x = Math.max(0, de.clientX - rect.left);
  const y = Math.max(0, de.clientY - rect.top);
  nextCtrlIdx++;
  const ctrl: EditorControl = {
    kind, pos: [x, y],
    id: kind + '_' + nextCtrlIdx,
    label: (kind === 'pot' ? 'Pot' : kind === 'button' ? 'Button' : 'LED') + ' ' + nextCtrlIdx,
    adcChannel: kind === 'pot' ? 0 : null, range: kind === 'pot' ? [0, 1] : null,
    taper: kind === 'pot' ? 'linear' : null, def: kind === 'pot' ? 0.5 : null,
    gpioPin: kind !== 'pot' ? 0 : null, mode: kind === 'button' ? 'momentary' : null,
    activeLevel: kind === 'button' ? 'low' : null,
  };
  editorControls.push(ctrl);
  canvasArea.appendChild(buildCard(ctrl));
  const hint = document.getElementById('canvas-hint');
  if (hint) hint.style.display = 'none';
});

// ── Save ─────────────────────────────────────────────────────────────────
el<HTMLElement>('save-btn').addEventListener('click', () => {
  let cfg: ControllerConfig;
  if (!conventionMissing) {
    const domPos: Record<string, [number, number]> = {};
    document.querySelectorAll('#canvas-area .ctrl-card[data-id]').forEach(c => {
      const id = (c as HTMLElement).dataset['id'] || '';
      domPos[id] = [parseInt((c as HTMLElement).style.left, 10) || 0, parseInt((c as HTMLElement).style.top, 10) || 0];
    });
    const yamlPotMap    = Object.fromEntries(_yamlCfg.pots.map(p => [p.id, p]));
    const yamlBtnMap    = Object.fromEntries(_yamlCfg.buttons.map(b => [b.id, b]));
    const yamlLedMap    = Object.fromEntries(_yamlCfg.leds.map(l => [l.id, l]));
    // FR-CE-3: encoder/toggle/rgbled have no other YAML-configurable fields
    // (pin/behavior comes from the code annotation), so their "existing
    // entry" lookup only ever needs to carry forward `pos` — there's nothing
    // else on a PosOnlyDef to spread the way pot/button/led do above.
    const yamlEncoderMap = Object.fromEntries(_yamlCfg.encoders.map(e => [e.id, e]));
    const yamlToggleMap  = Object.fromEntries(_yamlCfg.toggles.map(t => [t.id, t]));
    const yamlRgbLedMap  = Object.fromEntries(_yamlCfg.rgbleds.map(r => [r.id, r]));
    const updatedPots    = conventionControls.filter(c => c.kind === 'pot').map(c => {
      const ex = yamlPotMap[c.id];
      const pos = domPos[c.id] || (ex && ex.pos) || [20, 20];
      return ex ? { ...ex, pos } : { id: c.id, label: c.id, adcChannel: adcChannelFromPin(c.pin), range: [0, 1] as [number, number], taper: 'linear' as Taper, default: 0.5, errors: [], pos };
    });
    const updatedButtons = conventionControls.filter(c => c.kind === 'button').map(c => {
      const ex = yamlBtnMap[c.id];
      const pos = domPos[c.id] || (ex && ex.pos) || [20, 20];
      return ex ? { ...ex, pos } : { id: c.id, label: c.id, gpioPin: c.pin, mode: 'momentary' as ButtonMode, activeLevel: 'low' as ActiveLevel, pos };
    });
    const updatedLeds    = conventionControls.filter(c => c.kind === 'led').map(c => {
      const ex = yamlLedMap[c.id];
      const pos = domPos[c.id] || (ex && ex.pos) || [20, 20];
      return ex ? { ...ex, pos } : { id: c.id, label: c.id, gpioPin: c.pin, pos };
    });
    const updatedEncoders = conventionControls.filter(c => c.kind === 'encoder').map(c => {
      const ex = yamlEncoderMap[c.id];
      const pos = domPos[c.id] || (ex && ex.pos) || [20, 20];
      return { id: c.id, pos };
    });
    const updatedToggles = conventionControls.filter(c => c.kind === 'toggle').map(c => {
      const ex = yamlToggleMap[c.id];
      const pos = domPos[c.id] || (ex && ex.pos) || [20, 20];
      return { id: c.id, pos };
    });
    const updatedRgbLeds = conventionControls.filter(c => c.kind === 'rgbled').map(c => {
      const ex = yamlRgbLedMap[c.id];
      const pos = domPos[c.id] || (ex && ex.pos) || [20, 20];
      return { id: c.id, pos };
    });
    cfg = {
      pots: updatedPots, buttons: updatedButtons, leds: updatedLeds,
      encoders: updatedEncoders, toggles: updatedToggles, rgbleds: updatedRgbLeds,
      errors: [],
    };
  } else {
    const pots    = editorControls.filter(c => c.kind === 'pot').map(c => ({ id: c.id, label: c.label, adcChannel: c.adcChannel ?? 0, range: c.range || [0, 1] as [number, number], taper: c.taper || 'linear' as Taper, default: c.def ?? 0.5, errors: [] as string[], pos: c.pos }));
    const buttons = editorControls.filter(c => c.kind === 'button').map(c => ({ id: c.id, label: c.label, gpioPin: c.gpioPin ?? 0, mode: c.mode || 'momentary' as ButtonMode, activeLevel: c.activeLevel || 'low' as ActiveLevel, pos: c.pos }));
    const leds    = editorControls.filter(c => c.kind === 'led').map(c => ({ id: c.id, label: c.label, gpioPin: c.gpioPin ?? 0, pos: c.pos }));
    // The legacy YAML-editor canvas (missingBlock mode) has no encoder/
    // toggle/rgbled palette items (FR-DEV-9/7/8 are convention-only devices)
    // — carry the last-loaded values through unchanged rather than dropping
    // them, so a stray save while missingBlock can't silently wipe positions
    // saved earlier in convention mode.
    cfg = { pots, buttons, leds, encoders: _yamlCfg.encoders, toggles: _yamlCfg.toggles, rgbleds: _yamlCfg.rgbleds, errors: [] };
  }
  vscode.postMessage({ command: 'editorSave', cfg });
  const st = el<HTMLElement>('save-status');
  st.textContent = 'Saved ✓';
  setTimeout(() => { st.textContent = ''; }, 2000);
});

// ── SD card content viewer (FR-SD-1) ────────────────────────────────────
let sdEnabled = false;
let sdEntries: SdEntry[] = [];
let sdExpandedName: string | null = null;
const sdPreviews: Record<string, string | null> = {};

function applySdCardEnabled(enabled: boolean): void {
  sdEnabled = enabled;
  const section = document.getElementById('sdcard-contents');
  if (section) section.style.display = enabled ? 'flex' : 'none';
  if (!enabled) {
    sdExpandedName = null;
  }
}

function applySdContents(entries: SdEntry[]): void {
  sdEntries = entries;
  // Stale preview state for a file that's no longer listed (or whose
  // content may have changed) is dropped on every fresh listing.
  for (const name of Object.keys(sdPreviews)) {
    if (!entries.some(e => e.name === name)) delete sdPreviews[name];
  }
  if (sdExpandedName && !entries.some(e => e.name === sdExpandedName)) sdExpandedName = null;
  renderSdSection();
}

function applySdPreview(name: string, content: string | null): void {
  sdPreviews[name] = content;
  if (sdExpandedName === name) renderSdSection();
}

function renderSdSection(): void {
  const countEl = document.getElementById('sd-count');
  if (countEl) countEl.textContent = sdEntries.length ? `${sdEntries.length} file${sdEntries.length === 1 ? '' : 's'}` : '';

  const list = document.getElementById('sd-list');
  if (!list) return;
  if (!sdEntries.length) {
    list.innerHTML = '<div class="sd-empty-state">SD card is empty</div>';
    return;
  }
  list.innerHTML = sdEntries.map(e => {
    const isTxt = isTxtEntryName(e.name);
    const expanded = sdExpandedName === e.name;
    let previewHtml = '';
    if (expanded) {
      if (!isTxt) {
        previewHtml = '<div class="sd-preview unavailable">preview not available</div>';
      } else if (!(e.name in sdPreviews)) {
        previewHtml = '<div class="sd-preview unavailable">loading…</div>';
      } else if (sdPreviews[e.name] === null) {
        previewHtml = '<div class="sd-preview unavailable">preview not available</div>';
      } else {
        previewHtml = '<div class="sd-preview">' + escJ(sdPreviews[e.name] || '') + '</div>';
      }
    }
    return (
      '<div class="sd-row" data-name="' + escJ(e.name) + '">' +
        '<span class="name" title="' + escJ(e.name) + '">' + escJ(e.name) + '</span>' +
        '<span class="size">' + formatSdSize(e.size) + '</span>' +
      '</div>' + previewHtml
    );
  }).join('');
  list.querySelectorAll('.sd-row').forEach(row => {
    row.addEventListener('click', () => {
      const name = (row as HTMLElement).dataset['name'] || '';
      if (sdExpandedName === name) {
        sdExpandedName = null;
      } else {
        sdExpandedName = name;
        if (isTxtEntryName(name) && !(name in sdPreviews)) {
          vscode.postMessage({ command: 'sdPreview', name });
        }
      }
      renderSdSection();
    });
  });
}

document.getElementById('sd-refresh-btn')?.addEventListener('click', () => {
  vscode.postMessage({ command: 'sdRefresh' });
});

// ── OLED live preview strip (FR-CE-2) ───────────────────────────────────
const OLED_STRIP_WIDTH = 128;
const OLED_STRIP_HEIGHT = 64;
const OLED_STRIP_MAX_TIMESTAMPS = 120;
let oledBus: string | null = null;
const oledFrameTimestamps: number[] = [];

function updateOledStripFoot(): void {
  const footEl = document.getElementById('oled-strip-foot');
  if (!footEl) return;
  const fps = computeFrameRate(oledFrameTimestamps, 1000);
  footEl.textContent = 'SSD1306 \xb7 ' + OLED_STRIP_WIDTH + '\xd7' + OLED_STRIP_HEIGHT + ' \xb7 ' + (oledBus ?? '—') + ' \xb7 ' + fps.toFixed(0) + ' fps';
}

// SSD1306 GDDRAM layout — mirrors oled-webview.ts's drawFrame (one byte per
// 8 vertically-stacked pixels, height/8 pages of width bytes each). Kept
// local rather than shared so the docked strip doesn't pull the standalone
// OLED panel's bundle in as a dependency.
function drawOledStripFrame(bytes: Uint8Array): void {
  const canvas = document.getElementById('oled-strip-canvas') as HTMLCanvasElement | null;
  const ctx = canvas?.getContext('2d');
  if (!ctx) return;
  const imageData = ctx.createImageData(OLED_STRIP_WIDTH, OLED_STRIP_HEIGHT);
  const pages = OLED_STRIP_HEIGHT / 8;
  for (let page = 0; page < pages; page++) {
    for (let x = 0; x < OLED_STRIP_WIDTH; x++) {
      const byte = bytes[page * OLED_STRIP_WIDTH + x] ?? 0;
      for (let bit = 0; bit < 8; bit++) {
        const on = (byte & (1 << bit)) !== 0;
        const y = page * 8 + bit;
        const idx = (y * OLED_STRIP_WIDTH + x) * 4;
        const v = on ? 255 : 0;
        imageData.data[idx] = v;
        imageData.data[idx + 1] = v;
        imageData.data[idx + 2] = v;
        imageData.data[idx + 3] = 255;
      }
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

function applyOledEnabled(enabled: boolean, bus: string | null): void {
  oledBus = bus;
  const strip = document.getElementById('oled-strip');
  if (strip) strip.classList.toggle('enabled', enabled);
  updateOledStripFoot();
}

function applyOledFrame(data: string): void {
  const bytes = decodeOledFrame(data);
  if (bytes === null) {
    const footEl = document.getElementById('oled-strip-foot');
    if (footEl) footEl.textContent = 'SSD1306 \xb7 frame decode error';
    return;
  }
  drawOledStripFrame(bytes);
  oledFrameTimestamps.push(performance.now());
  if (oledFrameTimestamps.length > OLED_STRIP_MAX_TIMESTAMPS) oledFrameTimestamps.shift();
  updateOledStripFoot();
}

document.getElementById('oled-popout-btn')?.addEventListener('click', () => {
  vscode.postMessage({ command: 'oledPopOut' });
});

// ── LED state from emulator ───────────────────────────────────────────────
function applyLed(gpioPin: number, lit: boolean): void {
  document.querySelectorAll('.vled-dot[data-pin="' + gpioPin + '"]').forEach(dot => {
    dot.classList.toggle('vled-lit', !!lit);
  });
}

// ── RGB LED state from emulator (FR-DEV-8) ────────────────────────────────
function applyRgbLed(gpioPin: number, r: number, g: number, b: number): void {
  const clamp255 = (v: number): number => Math.max(0, Math.min(255, Math.round(v * 255)));
  const color = 'rgb(' + clamp255(r) + ',' + clamp255(g) + ',' + clamp255(b) + ')';
  document.querySelectorAll('.vrgb-dot[data-pin="' + gpioPin + '"]').forEach(dot => {
    (dot as HTMLElement).style.backgroundColor = color;
  });
}

// ── Message handler ───────────────────────────────────────────────────────
const CONTROLS_HOST_COMMANDS = new Set<ControlsHostMessage['command']>([
  'controlsConfig', 'status', 'editorLoad', 'led', 'rgbLed',
  'sdCardEnabled', 'sdContents', 'sdPreview', 'oledEnabled', 'oledFrame',
]);

window.addEventListener('message', (e: MessageEvent<unknown>) => {
  if (!hasKnownCommand(e.data, CONTROLS_HOST_COMMANDS)) return;
  const msg = e.data as ControlsHostMessage;
  if (msg.command === 'controlsConfig') {
    applyControlsConfig(msg);
  } else if (msg.command === 'status') {
    updateCeEmulatorState(!!msg.running);
  } else if (msg.command === 'editorLoad') {
    editorLoad(msg.cfg || {});
  } else if (msg.command === 'led') {
    applyLed(msg.gpioPin, msg.lit);
  } else if (msg.command === 'rgbLed') {
    applyRgbLed(msg.gpioPin, msg.r, msg.g, msg.b);
  } else if (msg.command === 'sdCardEnabled') {
    applySdCardEnabled(msg.enabled);
  } else if (msg.command === 'sdContents') {
    applySdContents(msg.entries);
  } else if (msg.command === 'sdPreview') {
    applySdPreview(msg.name, msg.content);
  } else if (msg.command === 'oledEnabled') {
    applyOledEnabled(msg.enabled, msg.bus);
  } else if (msg.command === 'oledFrame') {
    applyOledFrame(msg.data);
  }
});

vscode.postMessage({ command: 'webviewReady' });
