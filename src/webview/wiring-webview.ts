/// <reference lib="dom" />
import type { WiringHostMessage, WiringWebviewMessage } from './messages';
import type { PinDef, WiredPin, DeviceType } from '../wiring/wiring-panel';
import { computePinDisplayStates } from '../wiring/wired-pin-state';
import { defaultId, validateId } from '../wiring/id-validation';
import { REGISTRY, registryIds } from '../devices/registry';

// FR-DEV-2: one popup button id per registry entry — generalizes what used
// to be a hardcoded ['btn-pot', 'btn-button', 'btn-led'] literal so a new
// device needs no edit here (matches wiring-panel.ts's popupDeviceButtonsHtml).
function deviceButtonIds(): string[] {
  return registryIds().map(id => `btn-${id}`);
}

function kindFromButtonId(btnId: string): DeviceType {
  return btnId.slice('btn-'.length) as DeviceType;
}

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

interface VsCodeApiForWiring {
  postMessage(msg: WiringWebviewMessage): void;
}

const vscode  = acquireVsCodeApi() as unknown as VsCodeApiForWiring;
const svg     = el<HTMLElement & SVGSVGElement>('pinout');
const popup   = el<HTMLElement>('popup');

// ── Pin definitions (loaded from data island) ─────────────────────────────
const PIN_DEFS: PinDef[] = JSON.parse(el<HTMLElement>('pin-defs').textContent || '[]');

// ── State ─────────────────────────────────────────────────────────────────
let wiredPins: WiredPin[] = JSON.parse(el<HTMLElement>('init-data').textContent || '[]');
// { pinNumber, adc } for unassigned; { pinNumber, id, deviceType } for assigned.
let popupPin: { pinNumber: number; adc?: boolean; deviceType?: DeviceType; id?: string } | null = null;
let selectedKind: DeviceType | null = null;

// ── Build SVG pins ────────────────────────────────────────────────────────
const ROW_H = 28, TOP = 40;
// Left: circles at x=55, lines to x=190; Right: circles at x=505, lines from x=370
const L_CX = 55, R_CX = 505;
const BOARD_L = 190, BOARD_R = 370;

function pinY(row: number): number { return TOP + row * ROW_H; }

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
    g.dataset['pin']  = String(def.pin);
    g.dataset['adc']  = def.adc ? 'true' : 'false';
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
function applyWiredPins(pins: WiredPin[]): void {
  wiredPins = pins;
  for (const state of computePinDisplayStates(PIN_DEFS, pins)) {
    const g = document.getElementById('pin-' + state.pin);
    if (!g) continue;
    g.classList.remove(...registryIds().map(id => `pin-${id}`), 'pin-unassigned', 'pin-adc');
    g.querySelectorAll('.assigned-id').forEach(node => node.remove());
    g.classList.add(state.className);
    if (state.assignedId === null) continue;
    const def = PIN_DEFS.find(d => d.pin === state.pin);
    if (!def) continue;
    const idEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    const cy = pinY(def.row);
    const labelX = def.side === 'L' ? 126 : 434;
    idEl.setAttribute('x', String(labelX));
    idEl.setAttribute('y', String(cy - 7));
    idEl.setAttribute('text-anchor', 'middle');
    idEl.classList.add('assigned-id');
    idEl.textContent = state.assignedId;
    g.appendChild(idEl);
  }
}

applyWiredPins(wiredPins);

// ── Pin click handler ─────────────────────────────────────────────────────
function onPinClick(e: Event): void {
  e.stopPropagation();
  const g         = e.currentTarget as HTMLElement;
  const pinNumber = parseInt(g.dataset['pin'] || '', 10);
  const adc       = g.dataset['adc'] === 'true';
  const existing  = wiredPins.find(wp => wp.pinNumber === pinNumber);

  if (existing) {
    showAssignedPopup(pinNumber, existing.deviceType, existing.id, e as MouseEvent);
  } else {
    showAssignPopup(pinNumber, adc, e as MouseEvent);
  }
}

// ── Popup helpers ─────────────────────────────────────────────────────────
function positionPopup(e: MouseEvent): void {
  const x = Math.min(e.clientX + 8, window.innerWidth  - 220);
  const y = Math.min(e.clientY + 8, window.innerHeight - 280);
  popup.style.left = x + 'px';
  popup.style.top  = y + 'px';
  popup.style.display = 'block';
}

function closePopup(): void {
  popup.style.display = 'none';
  popupPin   = null;
  selectedKind = null;
  el<HTMLElement>('popup-assign').style.display = 'block';
  el<HTMLElement>('popup-assigned').style.display = 'none';
  el<HTMLInputElement>('id-input').value = '';
  el<HTMLElement>('id-error').textContent = '';
  el<HTMLButtonElement>('popup-confirm').disabled = true;
  deviceButtonIds().forEach(id => {
    el<HTMLElement>(id).classList.remove('selected');
  });
}

function showAssignPopup(pinNumber: number, adc: boolean, e: MouseEvent): void {
  popupPin = { pinNumber, adc };
  el<HTMLElement>('popup-title').textContent = 'Assign pin D' + pinNumber;
  el<HTMLElement>('pot-warn').style.display = (!adc) ? 'inline' : 'none';
  el<HTMLElement>('popup-assign').style.display = 'block';
  el<HTMLElement>('popup-assigned').style.display = 'none';
  selectedKind = null;
  el<HTMLInputElement>('id-input').value = '';
  el<HTMLElement>('id-error').textContent = '';
  el<HTMLButtonElement>('popup-confirm').disabled = true;
  positionPopup(e);
}

function showAssignedPopup(pinNumber: number, deviceType: DeviceType, id: string, e: MouseEvent): void {
  popupPin = { pinNumber, deviceType, id };
  el<HTMLElement>('popup-title').textContent = 'Pin D' + pinNumber;
  el<HTMLElement>('assigned-info').textContent = REGISTRY[deviceType]!.label + ' · id: ' + id;
  el<HTMLElement>('popup-assign').style.display = 'none';
  el<HTMLElement>('popup-assigned').style.display = 'block';
  positionPopup(e);
}

// Device type buttons
deviceButtonIds().forEach(btnId => {
  el<HTMLElement>(btnId).addEventListener('click', () => {
    deviceButtonIds().forEach(id => el<HTMLElement>(id).classList.remove('selected'));
    el<HTMLElement>(btnId).classList.add('selected');
    selectedKind = kindFromButtonId(btnId);
    const proposed = defaultId(selectedKind, wiredPins);
    const idInput  = el<HTMLInputElement>('id-input');
    if (!idInput.value || idInput.dataset['wasDefault'] === 'true') {
      idInput.value = proposed;
      idInput.dataset['wasDefault'] = 'true';
    }
    validateAndUpdate();
  });
});

el<HTMLInputElement>('id-input').addEventListener('input', e => {
  (e.target as HTMLInputElement).dataset['wasDefault'] = 'false';
  validateAndUpdate();
});

function validateAndUpdate(): void {
  const val = el<HTMLInputElement>('id-input').value.trim();
  const err = validateId(val, wiredPins);
  el<HTMLElement>('id-error').textContent = err || '';
  el<HTMLButtonElement>('popup-confirm').disabled = !selectedKind || !!err;
}

el<HTMLButtonElement>('popup-confirm').addEventListener('click', () => {
  if (!popupPin || !selectedKind) return;
  const id = el<HTMLInputElement>('id-input').value.trim();
  const err = validateId(id, wiredPins);
  if (err) { el<HTMLElement>('id-error').textContent = err; return; }
  vscode.postMessage({ command: 'wirePin', pinNumber: popupPin.pinNumber, deviceType: selectedKind, id });
  closePopup();
});

el<HTMLElement>('popup-cancel-assign').addEventListener('click', closePopup);
el<HTMLElement>('popup-cancel-assigned').addEventListener('click', closePopup);

el<HTMLElement>('popup-remove').addEventListener('click', () => {
  if (!popupPin || popupPin.id === undefined) return;
  vscode.postMessage({ command: 'unwirePin', pinNumber: popupPin.pinNumber, id: popupPin.id });
  closePopup();
});

// Close popup on outside click
document.addEventListener('click', e => {
  if (popup.style.display === 'block' && !popup.contains(e.target as Node)) closePopup();
});

// Extension → webview messages
window.addEventListener('message', (e: MessageEvent<WiringHostMessage>) => {
  const msg = e.data;
  if (msg.command === 'wiredPins') applyWiredPins(msg.pins || []);
});
