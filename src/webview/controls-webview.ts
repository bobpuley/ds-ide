// @ts-nocheck
/// <reference lib="dom" />

const vscode = acquireVsCodeApi();
const TRUNC_MAX_LEN = 15;
const TRUNC_SUFFIX = '…';
function truncId(id) { return id.length > TRUNC_MAX_LEN ? id.slice(0, TRUNC_MAX_LEN - 1) + TRUNC_SUFFIX : id; }

const _docListeners = [];
function _addDocListener(event, fn) {
  document.addEventListener(event, fn);
  _docListeners.push({ event, fn });
}
function clearDocListeners() {
  for (const { event, fn } of _docListeners) document.removeEventListener(event, fn);
  _docListeners.length = 0;
}

const _yamlInitEl = document.getElementById('yaml-init');
const _yamlInit = JSON.parse(_yamlInitEl ? _yamlInitEl.textContent || '{}' : '{}');
let _yamlCfg = { pots: _yamlInit.pots || [], buttons: _yamlInit.buttons || [], leds: _yamlInit.leds || [], errors: [] };

let conventionControls = [];
let conventionPlacements = [];
let conventionMissing = true;
let ceEmulatorRunning = false;
let editorControls = [];
let nextCtrlIdx = 0;

function escJ(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function applyControlsConfig(msg) {
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

function updateCeEmulatorState(running) {
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

function renderConventionCanvas() {
  clearDocListeners();
  const area = document.getElementById('canvas-area');
  const hint = document.getElementById('canvas-hint');
  if (!area) return;
  area.querySelectorAll('.ctrl-card').forEach(c => c.remove());
  const placementMap = {};
  for (const p of conventionPlacements) placementMap[p.id] = p.pos;
  const conventionIds = new Set(conventionControls.map(c => c.id));
  let ax = 20, ay = 20;
  function nextPos() { const p = [ax, ay]; ax += 190; if (ax > 580) { ax = 20; ay += 170; } return p; }
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

function buildKnobSvg(value) {
  const sz = 52, cx = 26, cy = 26, trackR = 20, dotR2 = 14;
  const startDeg = -225, rangeDeg = 270;
  const toRad = d => d * Math.PI / 180;
  const cv = Math.max(0, Math.min(1, value));
  const fmt = n => n.toFixed(2);
  const svgAng = toRad(startDeg + cv * rangeDeg);
  const x0 = cx + trackR * Math.cos(toRad(startDeg));
  const y0 = cy + trackR * Math.sin(toRad(startDeg));
  const x1 = cx + trackR * Math.cos(toRad(startDeg + rangeDeg));
  const y1 = cy + trackR * Math.sin(toRad(startDeg + rangeDeg));
  const xa = cx + trackR * Math.cos(svgAng);
  const ya = cy + trackR * Math.sin(svgAng);
  const dx = cx + dotR2 * Math.cos(svgAng);
  const dy = cy + dotR2 * Math.sin(svgAng);
  const span = cv * rangeDeg;
  const la = span > 180 ? 1 : 0;
  const trackPath = 'M ' + fmt(x0) + ' ' + fmt(y0) + ' A ' + trackR + ' ' + trackR + ' 0 1 1 ' + fmt(x1) + ' ' + fmt(y1);
  const valPath = span > 0.1 ? 'M ' + fmt(x0) + ' ' + fmt(y0) + ' A ' + trackR + ' ' + trackR + ' 0 ' + la + ' 1 ' + fmt(xa) + ' ' + fmt(ya) : 'M 0 0';
  return '<svg class="knob-svg" viewBox="0 0 ' + sz + ' ' + sz + '" width="' + sz + '" height="' + sz + '">' +
    '<circle cx="' + cx + '" cy="' + cy + '" r="18" fill="#1e1e1e" stroke="#3c3c3c" stroke-width="1.5"/>' +
    '<path d="' + trackPath + '" fill="none" stroke="#3c3c3c" stroke-width="3" stroke-linecap="round"/>' +
    '<path class="knob-value-path" d="' + valPath + '" fill="none" stroke="#4ec9b0" stroke-width="3" stroke-linecap="round"' + (span <= 0.1 ? ' style="display:none"' : '') + '/>' +
    '<circle class="knob-dot" cx="' + fmt(dx) + '" cy="' + fmt(dy) + '" r="2.5" fill="#4ec9b0"/>' +
    '</svg>';
}

function updateKnobPaths(knobWrap, value) {
  const cv = Math.max(0, Math.min(1, value));
  const cx = 26, cy = 26, trackR = 20, dotR2 = 14;
  const startDeg = -225, rangeDeg = 270;
  const toRad = d => d * Math.PI / 180;
  const svgAng = toRad(startDeg + cv * rangeDeg);
  const x0 = cx + trackR * Math.cos(toRad(startDeg));
  const y0 = cy + trackR * Math.sin(toRad(startDeg));
  const xa = cx + trackR * Math.cos(svgAng);
  const ya = cy + trackR * Math.sin(svgAng);
  const dx = cx + dotR2 * Math.cos(svgAng);
  const dy = cy + dotR2 * Math.sin(svgAng);
  const span = cv * rangeDeg;
  const la = span > 180 ? 1 : 0;
  const fmt = n => n.toFixed(2);
  const vp = knobWrap.querySelector('.knob-value-path');
  if (vp) {
    if (span > 0.1) {
      vp.setAttribute('d', 'M ' + fmt(x0) + ' ' + fmt(y0) + ' A ' + trackR + ' ' + trackR + ' 0 ' + la + ' 1 ' + fmt(xa) + ' ' + fmt(ya));
      vp.style.display = '';
    } else {
      vp.style.display = 'none';
    }
  }
  const dot = knobWrap.querySelector('.knob-dot');
  if (dot) { dot.setAttribute('cx', fmt(dx)); dot.setAttribute('cy', fmt(dy)); }
  const valEl = knobWrap.querySelector('.knob-value');
  if (valEl) valEl.textContent = cv.toFixed(3);
  return cv;
}

function buildConventionCard(ctrl, pos) {
  const kindLabel = ctrl.kind === 'pot' ? 'Pot' : ctrl.kind === 'button' ? 'Button' : 'LED';
  const card = document.createElement('div');
  card.className = 'ctrl-card';
  card.dataset.kind = ctrl.kind;
  card.dataset.id = ctrl.id;
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
    const knobWrap = card.querySelector('.knob-wrap');
    let kDrag = false, kStartY = 0, kStartVal = 0;
    knobWrap.addEventListener('mousedown', e => {
      kDrag = true;
      kStartY = e.clientY;
      kStartVal = parseFloat(knobWrap.dataset.value || '0');
      e.preventDefault();
    });
    const onKnobMove = e => {
      if (!kDrag) return;
      const delta = (kStartY - e.clientY) / 100;
      const newVal = updateKnobPaths(knobWrap, kStartVal + delta);
      knobWrap.dataset.value = String(newVal);
      vscode.postMessage({ command: 'pot', channel: adcCh, value: newVal });
    };
    const onKnobUp = () => { kDrag = false; };
    _addDocListener('mousemove', onKnobMove);
    _addDocListener('mouseup', onKnobUp);
  } else if (ctrl.kind === 'button') {
    const btn = card.querySelector('.btn-ce');
    const gpioPin = ctrl.pin;
    const btnMode = (_yamlCfg.buttons.find(b => b.id === ctrl.id) || {}).mode || 'momentary';
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
      const press   = () => { btn.setAttribute('aria-pressed', 'true');  vscode.postMessage({ command: 'button', gpioPin, pressed: true }); };
      const release = () => { btn.setAttribute('aria-pressed', 'false'); vscode.postMessage({ command: 'button', gpioPin, pressed: false }); };
      btn.addEventListener('mousedown', press);
      btn.addEventListener('mouseup',   release);
      btn.addEventListener('mouseleave', () => { if (btn.getAttribute('aria-pressed') === 'true') release(); });
    }
  }

  makeDraggable(card, { pos: [pos[0], pos[1]] });
  return card;
}

function buildNotInCodeCard(pl) {
  const card = document.createElement('div');
  card.className = 'ctrl-card not-in-code-card';
  card.dataset.id = pl.id;
  card.style.left = pl.pos[0] + 'px';
  card.style.top = pl.pos[1] + 'px';
  card.style.opacity = '0.4';
  card.innerHTML =
    '<div class="card-header"><span class="card-kind" style="color:#f48771">not in code</span></div>' +
    '<div class="card-body"><div class="card-field"><label>id</label><span class="card-val">' + escJ(pl.id) + '</span></div></div>';
  return card;
}

function adcChannelFromPin(pin) {
  if (pin >= 15 && pin <= 25) return pin - 15;
  if (pin === 28) return 11;
  return 0;
}

function makeDraggable(card, ctrl) {
  const header = card.querySelector('.ctrl-handle') || card.querySelector('.card-header');
  if (!header) return;
  let drag = false, sx, sy, sl, st;
  header.addEventListener('mousedown', e => {
    if (e.target.closest('.card-del')) return;
    drag = true; sx = e.clientX; sy = e.clientY;
    sl = parseInt(card.style.left,10)||0; st = parseInt(card.style.top,10)||0;
    e.preventDefault();
  });
  _addDocListener('mousemove', e => {
    if (!drag) return;
    const nx = Math.max(0, sl + e.clientX - sx);
    const ny = Math.max(0, st + e.clientY - sy);
    card.style.left = nx + 'px'; card.style.top = ny + 'px';
    ctrl.pos = [nx, ny];
  });
  _addDocListener('mouseup', () => { drag = false; });
}

// ── Legacy YAML editor (missingBlock mode) ───────────────────────────────
function editorLoad(cfg) {
  _yamlCfg = { pots: cfg.pots || [], buttons: cfg.buttons || [], leds: cfg.leds || [], errors: [] };
  editorControls = [];
  let ax = 20, ay = 20;
  function nextPos() { const p = [ax, ay]; ax += 190; if (ax > 580) { ax = 20; ay += 170; } return p; }
  for (const p of (cfg.pots   || [])) editorControls.push({ kind:'pot',    id:p.id, label:p.label, adcChannel:p.adcChannel, range:p.range||[0,1], taper:p.taper||'linear', def:p.default??0.5, gpioPin:null, mode:null, activeLevel:null, pos:p.pos||nextPos() });
  for (const b of (cfg.buttons|| [])) editorControls.push({ kind:'button', id:b.id, label:b.label, adcChannel:null, range:null, taper:null, def:null, gpioPin:b.gpioPin??0, mode:b.mode||'momentary', activeLevel:b.activeLevel||'low', pos:b.pos||nextPos() });
  for (const l of (cfg.leds   || [])) editorControls.push({ kind:'led',    id:l.id, label:l.label, adcChannel:null, range:null, taper:null, def:null, gpioPin:l.gpioPin??0, mode:null, activeLevel:null, pos:l.pos||nextPos() });
  nextCtrlIdx = Math.max(editorControls.length, nextCtrlIdx);
  renderCanvas();
}

function renderCanvas() {
  clearDocListeners();
  const area = document.getElementById('canvas-area');
  const hint = document.getElementById('canvas-hint');
  area.innerHTML = '';
  if (hint) area.appendChild(hint);
  hint && (hint.style.display = editorControls.length ? 'none' : 'flex');
  for (const ctrl of editorControls) area.appendChild(buildCard(ctrl));
}

function buildCard(ctrl) {
  const kindLabel = ctrl.kind === 'pot' ? 'Pot' : ctrl.kind === 'button' ? 'Button' : 'LED';
  const pinOpts = [...Array(32).keys()].map(i => '<option value="'+i+'"'+(ctrl.gpioPin===i?' selected':'')+'>pin '+i+'</option>').join('');
  const chOpts  = [...Array(12).keys()].map(i => '<option value="'+i+'"'+(ctrl.adcChannel===i?' selected':'')+'>ch '+i+'</option>').join('');
  const taperOpts = ['linear','log','antilog'].map(t => '<option value="'+t+'"'+(ctrl.taper===t?' selected':'')+'>'+t+'</option>').join('');
  const modeOpts  = ['momentary','toggle'].map(m => '<option value="'+m+'"'+(ctrl.mode===m?' selected':'')+'>'+m+'</option>').join('');

  const card = document.createElement('div');
  card.className = 'ctrl-card';
  card.dataset.kind = ctrl.kind;
  card.style.left = ctrl.pos[0] + 'px';
  card.style.top  = ctrl.pos[1] + 'px';
  card.innerHTML =
    '<div class="card-header">' +
      '<span class="card-kind">'+kindLabel+'</span>' +
      '<button class="card-del" title="Remove">\xD7</button>' +
    '</div>' +
    '<div class="card-body">' +
      '<div class="card-field"><label>ID</label><input class="card-inp card-id" value="'+escJ(ctrl.id)+'"/></div>' +
      '<div class="card-field"><label>Label</label><input class="card-inp card-lbl" value="'+escJ(ctrl.label)+'"/></div>' +
      (ctrl.kind === 'pot'
        ? '<div class="card-field"><label>ADC ch</label><select class="card-sel card-ch">'+chOpts+'</select></div>' +
          '<div class="card-field"><label>Taper</label><select class="card-sel card-taper">'+taperOpts+'</select></div>' +
          '<div class="card-field"><label>Default</label><input class="card-inp card-def" type="number" min="0" max="1" step="0.01" value="'+ctrl.def+'"/></div>'
        : '<div class="card-field"><label>GPIO pin</label><select class="card-sel card-pin">'+pinOpts+'</select></div>' +
          (ctrl.kind === 'button' ? '<div class="card-field"><label>Mode</label><select class="card-sel card-mode">'+modeOpts+'</select></div>' : '')) +
    '</div>';

  card.querySelector('.card-del').addEventListener('click', () => {
    editorControls = editorControls.filter(c => c !== ctrl);
    card.remove();
    const hint = document.getElementById('canvas-hint');
    if (hint) hint.style.display = editorControls.length ? 'none' : 'flex';
  });
  card.querySelector('.card-id').addEventListener('input',  e => { ctrl.id    = e.target.value; });
  card.querySelector('.card-lbl').addEventListener('input', e => { ctrl.label = e.target.value; });
  if (ctrl.kind === 'pot') {
    card.querySelector('.card-ch').addEventListener('change',    e => { ctrl.adcChannel = parseInt(e.target.value, 10); });
    card.querySelector('.card-taper').addEventListener('change', e => { ctrl.taper = e.target.value; });
    card.querySelector('.card-def').addEventListener('change',   e => { ctrl.def = parseFloat(e.target.value); });
  } else {
    card.querySelector('.card-pin').addEventListener('change', e => { ctrl.gpioPin = parseInt(e.target.value, 10); });
    if (ctrl.kind === 'button') card.querySelector('.card-mode').addEventListener('change', e => { ctrl.mode = e.target.value; });
  }
  makeDraggable(card, ctrl);
  return card;
}

// ── Palette drop ─────────────────────────────────────────────────────────
document.querySelectorAll('.palette-item').forEach(item => {
  item.addEventListener('dragstart', e => e.dataTransfer.setData('text/plain', item.dataset.kind));
});
const canvasArea = document.getElementById('canvas-area');
canvasArea.addEventListener('dragover', e => e.preventDefault());
canvasArea.addEventListener('drop', e => {
  e.preventDefault();
  const kind = e.dataTransfer.getData('text/plain');
  if (!['pot','button','led'].includes(kind)) return;
  const rect = canvasArea.getBoundingClientRect();
  const x = Math.max(0, e.clientX - rect.left);
  const y = Math.max(0, e.clientY - rect.top);
  nextCtrlIdx++;
  const ctrl = {
    kind, pos: [x, y],
    id: kind + '_' + nextCtrlIdx,
    label: (kind==='pot'?'Pot':kind==='button'?'Button':'LED') + ' ' + nextCtrlIdx,
    adcChannel: kind==='pot'?0:null, range:kind==='pot'?[0,1]:null,
    taper:kind==='pot'?'linear':null, def:kind==='pot'?0.5:null,
    gpioPin:kind!=='pot'?0:null, mode:kind==='button'?'momentary':null,
    activeLevel:kind==='button'?'low':null,
  };
  editorControls.push(ctrl);
  canvasArea.appendChild(buildCard(ctrl));
  const hint = document.getElementById('canvas-hint');
  if (hint) hint.style.display = 'none';
});

// ── Save ─────────────────────────────────────────────────────────────────
document.getElementById('save-btn').addEventListener('click', () => {
  let cfg;
  if (!conventionMissing) {
    const domPos = {};
    document.querySelectorAll('#canvas-area .ctrl-card[data-id]').forEach(c => {
      domPos[c.dataset.id] = [parseInt(c.style.left,10)||0, parseInt(c.style.top,10)||0];
    });
    const yamlPotMap    = Object.fromEntries(_yamlCfg.pots.map(p => [p.id, p]));
    const yamlBtnMap    = Object.fromEntries(_yamlCfg.buttons.map(b => [b.id, b]));
    const yamlLedMap    = Object.fromEntries(_yamlCfg.leds.map(l => [l.id, l]));
    const updatedPots    = conventionControls.filter(c => c.kind === 'pot').map(c => {
      const ex = yamlPotMap[c.id];
      const pos = domPos[c.id] || (ex && ex.pos) || [20, 20];
      return ex ? { ...ex, pos } : { id: c.id, label: c.id, adcChannel: adcChannelFromPin(c.pin), range: [0, 1], taper: 'linear', default: 0.5, errors: [], pos };
    });
    const updatedButtons = conventionControls.filter(c => c.kind === 'button').map(c => {
      const ex = yamlBtnMap[c.id];
      const pos = domPos[c.id] || (ex && ex.pos) || [20, 20];
      return ex ? { ...ex, pos } : { id: c.id, label: c.id, gpioPin: c.pin, mode: 'momentary', activeLevel: 'low', pos };
    });
    const updatedLeds    = conventionControls.filter(c => c.kind === 'led').map(c => {
      const ex = yamlLedMap[c.id];
      const pos = domPos[c.id] || (ex && ex.pos) || [20, 20];
      return ex ? { ...ex, pos } : { id: c.id, label: c.id, gpioPin: c.pin, pos };
    });
    cfg = { pots: updatedPots, buttons: updatedButtons, leds: updatedLeds, errors: [] };
  } else {
    const pots    = editorControls.filter(c=>c.kind==='pot').map(c=>({ id:c.id, label:c.label, adcChannel:c.adcChannel??0, range:c.range||[0,1], taper:c.taper||'linear', default:c.def??0.5, errors:[], pos:c.pos }));
    const buttons = editorControls.filter(c=>c.kind==='button').map(c=>({ id:c.id, label:c.label, gpioPin:c.gpioPin??0, mode:c.mode||'momentary', activeLevel:c.activeLevel||'low', pos:c.pos }));
    const leds    = editorControls.filter(c=>c.kind==='led').map(c=>({ id:c.id, label:c.label, gpioPin:c.gpioPin??0, pos:c.pos }));
    cfg = { pots, buttons, leds, errors: [] };
  }
  vscode.postMessage({ command: 'editorSave', cfg });
  const st = document.getElementById('save-status');
  st.textContent = 'Saved ✓';
  setTimeout(() => { st.textContent = ''; }, 2000);
});

// ── LED state from emulator ───────────────────────────────────────────────
function applyLed(gpioPin, lit) {
  document.querySelectorAll('.vled-dot[data-pin="' + gpioPin + '"]').forEach(dot => {
    dot.classList.toggle('vled-lit', !!lit);
  });
}

// ── Message handler ───────────────────────────────────────────────────────
window.addEventListener('message', e => {
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
