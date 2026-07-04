/// <reference lib="dom" />
import type { ControlsHostMessage, ControlsWebviewMessage } from './messages';
import type { ConventionControl } from '../controllers/controls-convention-parser';
import type { ControlsPlacement } from './scope-panel';
import type { ControllerConfig, Taper, ButtonMode, ActiveLevel } from '../controllers/controller-config';
import type { DeviceType } from '../wiring/wiring-panel';
import { computeKnobGeometry } from './knob-math';

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
  pots: _yamlInit.pots || [], buttons: _yamlInit.buttons || [], leds: _yamlInit.leds || [], errors: [],
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
  return '<svg class="knob-svg" viewBox="0 0 52 52" width="52" height="52">' +
    '<circle cx="26" cy="26" r="18" fill="#1e1e1e" stroke="#3c3c3c" stroke-width="1.5"/>' +
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

function buildConventionCard(ctrl: ConventionControl, pos: [number, number]): HTMLElement {
  const kindLabel = ctrl.kind === 'pot' ? 'Pot' : ctrl.kind === 'button' ? 'Button' : 'LED';
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
    const onKnobMove = (e: Event): void => {
      if (!kDrag) return;
      const delta = (kStartY - (e as MouseEvent).clientY) / 100;
      const newVal = updateKnobPaths(knobWrap, kStartVal + delta);
      knobWrap.dataset['value'] = String(newVal);
      vscode.postMessage({ command: 'pot', channel: adcCh, value: newVal });
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
  _yamlCfg = { pots: cfg.pots || [], buttons: cfg.buttons || [], leds: cfg.leds || [], errors: [] };
  editorControls = [];
  let ax = 20, ay = 20;
  function nextPos(): [number, number] { const p: [number, number] = [ax, ay]; ax += 190; if (ax > 580) { ax = 20; ay += 170; } return p; }
  for (const p of (cfg.pots || [])) editorControls.push({ kind: 'pot', id: p.id, label: p.label, adcChannel: p.adcChannel, range: p.range || [0, 1], taper: p.taper || 'linear', def: p.default ?? 0.5, gpioPin: null, mode: null, activeLevel: null, pos: p.pos || nextPos() });
  for (const b of (cfg.buttons || [])) editorControls.push({ kind: 'button', id: b.id, label: b.label, adcChannel: null, range: null, taper: null, def: null, gpioPin: b.gpioPin ?? 0, mode: b.mode || 'momentary', activeLevel: b.activeLevel || 'low', pos: b.pos || nextPos() });
  for (const l of (cfg.leds || [])) editorControls.push({ kind: 'led', id: l.id, label: l.label, adcChannel: null, range: null, taper: null, def: null, gpioPin: l.gpioPin ?? 0, mode: null, activeLevel: null, pos: l.pos || nextPos() });
  nextCtrlIdx = Math.max(editorControls.length, nextCtrlIdx);
  renderCanvas();
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
    cfg = { pots: updatedPots, buttons: updatedButtons, leds: updatedLeds, errors: [] };
  } else {
    const pots    = editorControls.filter(c => c.kind === 'pot').map(c => ({ id: c.id, label: c.label, adcChannel: c.adcChannel ?? 0, range: c.range || [0, 1] as [number, number], taper: c.taper || 'linear' as Taper, default: c.def ?? 0.5, errors: [] as string[], pos: c.pos }));
    const buttons = editorControls.filter(c => c.kind === 'button').map(c => ({ id: c.id, label: c.label, gpioPin: c.gpioPin ?? 0, mode: c.mode || 'momentary' as ButtonMode, activeLevel: c.activeLevel || 'low' as ActiveLevel, pos: c.pos }));
    const leds    = editorControls.filter(c => c.kind === 'led').map(c => ({ id: c.id, label: c.label, gpioPin: c.gpioPin ?? 0, pos: c.pos }));
    cfg = { pots, buttons, leds, errors: [] };
  }
  vscode.postMessage({ command: 'editorSave', cfg });
  const st = el<HTMLElement>('save-status');
  st.textContent = 'Saved ✓';
  setTimeout(() => { st.textContent = ''; }, 2000);
});

// ── LED state from emulator ───────────────────────────────────────────────
function applyLed(gpioPin: number, lit: boolean): void {
  document.querySelectorAll('.vled-dot[data-pin="' + gpioPin + '"]').forEach(dot => {
    dot.classList.toggle('vled-lit', !!lit);
  });
}

// ── Message handler ───────────────────────────────────────────────────────
window.addEventListener('message', (e: MessageEvent<ControlsHostMessage>) => {
  const msg = e.data;
  if (msg.command === 'controlsConfig') {
    applyControlsConfig(msg);
  } else if (msg.command === 'status') {
    updateCeEmulatorState(!!msg.running);
  } else if (msg.command === 'editorLoad') {
    editorLoad(msg.cfg || {});
  } else if (msg.command === 'led') {
    applyLed(msg.gpioPin, msg.lit);
  }
});

vscode.postMessage({ command: 'webviewReady' });
