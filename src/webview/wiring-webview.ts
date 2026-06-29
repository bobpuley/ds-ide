// @ts-nocheck
/// <reference lib="dom" />

const vscode  = acquireVsCodeApi();
const svg     = document.getElementById('pinout');
const popup   = document.getElementById('popup');

// ── Pin definitions (loaded from data island) ─────────────────────────────
const PIN_DEFS = JSON.parse(document.getElementById('pin-defs').textContent);

// ── State ─────────────────────────────────────────────────────────────────
let wiredPins = JSON.parse(document.getElementById('init-data').textContent || '[]');
let popupPin  = null;  // { pinNumber, adc } for unassigned; { pinNumber, id, deviceType } for assigned
let selectedKind = null;

// ── Build SVG pins ────────────────────────────────────────────────────────
const ROW_H = 28, TOP = 40;
// Left: circles at x=55, lines to x=190; Right: circles at x=505, lines from x=370
const L_CX = 55, R_CX = 505;
const BOARD_L = 190, BOARD_R = 370;

function pinY(row) { return TOP + row * ROW_H; }

PIN_DEFS.forEach(def => {
  const cx = def.side === 'L' ? L_CX : R_CX;
  const cy = pinY(def.row);
  const isAssignable = def.pin !== null;

  // Connector line
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', def.side === 'L' ? String(L_CX + 8) : String(BOARD_R));
  line.setAttribute('y1', String(cy));
  line.setAttribute('x2', def.side === 'L' ? String(BOARD_L) : String(R_CX - 8));
  line.setAttribute('y2', String(cy));
  line.setAttribute('stroke', isAssignable ? '#555' : '#333');
  line.setAttribute('stroke-width', '1');
  svg.appendChild(line);

  // Pin group
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.id = 'pin-' + (def.pin !== null ? def.pin : def.side + def.row);
  if (isAssignable) {
    g.classList.add('pin-dot');
    g.dataset.pin  = String(def.pin);
    g.dataset.adc  = def.adc ? 'true' : 'false';
    g.classList.add(def.adc ? 'pin-adc' : 'pin-unassigned');
    g.addEventListener('click', onPinClick);
  } else {
    g.classList.add('pin-power');
  }

  // Circle
  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circle.setAttribute('cx', String(cx));
  circle.setAttribute('cy', String(cy));
  circle.setAttribute('r', '8');
  g.appendChild(circle);

  // Primary label
  const lx = def.side === 'L' ? L_CX - 12 : R_CX + 12;
  const anchor = def.side === 'L' ? 'end' : 'start';
  const lbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  lbl.setAttribute('x', String(lx));
  lbl.setAttribute('y', String(cy + 4));
  lbl.setAttribute('text-anchor', anchor);
  lbl.classList.add('pin-label');
  if (!isAssignable) lbl.classList.add('pin-power-label');
  lbl.textContent = def.label;
  g.appendChild(lbl);

  // A-label (for ADC pins)
  if (def.aLabel) {
    const al = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    const alx = def.side === 'L' ? L_CX - 12 : R_CX + 12;
    al.setAttribute('x', String(alx));
    al.setAttribute('y', String(cy - 7));
    al.setAttribute('text-anchor', anchor);
    al.classList.add('a-label');
    al.textContent = def.aLabel;
    g.appendChild(al);
  }

  svg.appendChild(g);
});

// ── Apply wiredPins state to SVG ──────────────────────────────────────────
function applyWiredPins(pins) {
  wiredPins = pins;
  // Reset all assignable pins
  PIN_DEFS.filter(d => d.pin !== null).forEach(def => {
    const g = document.getElementById('pin-' + def.pin);
    if (!g) return;
    g.classList.remove('pin-pot', 'pin-button', 'pin-led', 'pin-unassigned', 'pin-adc');
    // Remove any previous assigned-id text
    g.querySelectorAll('.assigned-id').forEach(el => el.remove());
    g.classList.add(def.adc ? 'pin-adc' : 'pin-unassigned');
  });
  // Apply assignments
  pins.forEach(wp => {
    const g = document.getElementById('pin-' + wp.pinNumber);
    if (!g) return;
    g.classList.remove('pin-unassigned', 'pin-adc');
    g.classList.add('pin-' + wp.deviceType);
    // Show id label inside the pin circle
    const def = PIN_DEFS.find(d => d.pin === wp.pinNumber);
    if (!def) return;
    const idEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    const cy = pinY(def.row);
    const labelX = def.side === 'L' ? 126 : 434;
    idEl.setAttribute('x', String(labelX));
    idEl.setAttribute('y', String(cy - 7));
    idEl.setAttribute('text-anchor', 'middle');
    idEl.classList.add('assigned-id');
    idEl.textContent = wp.id;
    g.appendChild(idEl);
  });
}

applyWiredPins(wiredPins);

// ── Pin click handler ─────────────────────────────────────────────────────
function onPinClick(e) {
  e.stopPropagation();
  const g         = e.currentTarget;
  const pinNumber = parseInt(g.dataset.pin, 10);
  const adc       = g.dataset.adc === 'true';
  const existing  = wiredPins.find(wp => wp.pinNumber === pinNumber);

  if (existing) {
    showAssignedPopup(pinNumber, existing.deviceType, existing.id, e);
  } else {
    showAssignPopup(pinNumber, adc, e);
  }
}

// ── Popup helpers ─────────────────────────────────────────────────────────
function positionPopup(e) {
  const x = Math.min(e.clientX + 8, window.innerWidth  - 220);
  const y = Math.min(e.clientY + 8, window.innerHeight - 280);
  popup.style.left = x + 'px';
  popup.style.top  = y + 'px';
  popup.style.display = 'block';
}

function closePopup() {
  popup.style.display = 'none';
  popupPin   = null;
  selectedKind = null;
  document.getElementById('popup-assign').style.display = 'block';
  document.getElementById('popup-assigned').style.display = 'none';
  document.getElementById('id-input').value = '';
  document.getElementById('id-error').textContent = '';
  document.getElementById('popup-confirm').disabled = true;
  ['btn-pot','btn-button','btn-led'].forEach(id => {
    document.getElementById(id).classList.remove('selected');
  });
}

function defaultId(kind) {
  const used = new Set(wiredPins.filter(wp => wp.deviceType === kind).map(wp => wp.id));
  for (let n = 1; ; n++) {
    const candidate = kind + n;
    if (!used.has(candidate)) return candidate;
  }
}

function validateId(val) {
  if (!val || val.trim() === '') return 'id cannot be empty';
  const existing = wiredPins.find(wp => wp.id === val.trim());
  if (existing) return 'id already used by pin ' + existing.pinNumber;
  return null;
}

function showAssignPopup(pinNumber, adc, e) {
  popupPin = { pinNumber, adc };
  document.getElementById('popup-title').textContent = 'Assign pin D' + pinNumber;
  document.getElementById('pot-warn').style.display = (!adc) ? 'inline' : 'none';
  document.getElementById('popup-assign').style.display = 'block';
  document.getElementById('popup-assigned').style.display = 'none';
  selectedKind = null;
  document.getElementById('id-input').value = '';
  document.getElementById('id-error').textContent = '';
  document.getElementById('popup-confirm').disabled = true;
  positionPopup(e);
}

function showAssignedPopup(pinNumber, deviceType, id, e) {
  popupPin = { pinNumber, deviceType, id };
  document.getElementById('popup-title').textContent = 'Pin D' + pinNumber;
  const kindName = deviceType === 'pot' ? 'Pot' : deviceType === 'button' ? 'Button' : 'LED';
  document.getElementById('assigned-info').textContent = kindName + ' · id: ' + id;
  document.getElementById('popup-assign').style.display = 'none';
  document.getElementById('popup-assigned').style.display = 'block';
  positionPopup(e);
}

// Device type buttons
['btn-pot','btn-button','btn-led'].forEach(btnId => {
  document.getElementById(btnId).addEventListener('click', () => {
    ['btn-pot','btn-button','btn-led'].forEach(id => document.getElementById(id).classList.remove('selected'));
    document.getElementById(btnId).classList.add('selected');
    selectedKind = btnId === 'btn-pot' ? 'pot' : btnId === 'btn-button' ? 'button' : 'led';
    const proposed = defaultId(selectedKind);
    const idInput  = document.getElementById('id-input');
    if (!idInput.value || idInput.dataset.wasDefault === 'true') {
      idInput.value = proposed;
      idInput.dataset.wasDefault = 'true';
    }
    validateAndUpdate();
  });
});

document.getElementById('id-input').addEventListener('input', e => {
  e.target.dataset.wasDefault = 'false';
  validateAndUpdate();
});

function validateAndUpdate() {
  const val = document.getElementById('id-input').value.trim();
  const err = validateId(val);
  document.getElementById('id-error').textContent = err || '';
  document.getElementById('popup-confirm').disabled = !selectedKind || !!err;
}

document.getElementById('popup-confirm').addEventListener('click', () => {
  if (!popupPin || !selectedKind) return;
  const id = document.getElementById('id-input').value.trim();
  const err = validateId(id);
  if (err) { document.getElementById('id-error').textContent = err; return; }
  vscode.postMessage({ command: 'wirePin', pinNumber: popupPin.pinNumber, deviceType: selectedKind, id });
  closePopup();
});

document.getElementById('popup-cancel-assign').addEventListener('click', closePopup);
document.getElementById('popup-cancel-assigned').addEventListener('click', closePopup);

document.getElementById('popup-remove').addEventListener('click', () => {
  if (!popupPin) return;
  vscode.postMessage({ command: 'unwirePin', pinNumber: popupPin.pinNumber, id: popupPin.id });
  closePopup();
});

// Close popup on outside click
document.addEventListener('click', e => {
  if (popup.style.display === 'block' && !popup.contains(e.target)) closePopup();
});

// Extension → webview messages
window.addEventListener('message', e => {
  const msg = e.data;
  if (msg.command === 'wiredPins') applyWiredPins(msg.pins || []);
});
