/// <reference lib="dom" />
import type { WiringHostMessage, WiringWebviewMessage } from './messages';
import type { PinDef, WiredPin, DeviceType, PeripheralDisplayState } from '../wiring/wiring-panel';
import { computePinDisplayStates } from '../wiring/wired-pin-state';
import { defaultId, validateId } from '../wiring/id-validation';
import { REGISTRY, wiredControlIds } from '../devices/registry';
import { computeBusBrackets } from '../wiring/bus-bracket';
import { computePinOverlayStates } from '../wiring/pin-overlay-state';
import { isPinEligible } from '../wiring/pin-eligibility';
import { describePlacedDevice, peripheralOwningPin, type PopoverTarget } from '../wiring/device-popover';
import { hasKnownCommand } from './message-guard';
import { el } from './dom-lookup';
import { readDataIsland, showDataIslandError } from './data-island';

// FR-DEV-2: one popup button id per pin-attached registry entry —
// generalizes what used to be a hardcoded ['btn-pot', 'btn-button', 'btn-led']
// literal so a new device needs no edit here (matches wiring-panel.ts's
// popupDeviceButtonsHtml). Bus-attached peripherals (FR-DEV-10) are excluded
// — they have no per-pin popup button to wire a click listener to.
function deviceButtonIds(): string[] {
  return wiredControlIds().map(id => `btn-${id}`);
}

function kindFromButtonId(btnId: string): DeviceType {
  return btnId.slice('btn-'.length) as DeviceType;
}

interface VsCodeApiForWiring {
  postMessage(msg: WiringWebviewMessage): void;
}

const vscode      = acquireVsCodeApi() as unknown as VsCodeApiForWiring;
const svg         = el<HTMLElement & SVGSVGElement>('pinout');
const popup       = el<HTMLElement>('popup');
const tooltip     = el<HTMLElement>('tooltip');
const devicePopover = el<HTMLElement>('device-popover');

function isPinDefArray(v: unknown): v is PinDef[] {
  return Array.isArray(v) && v.every(x =>
    typeof x === 'object' && x !== null &&
    typeof (x as Record<string, unknown>)['row'] === 'number' &&
    typeof (x as Record<string, unknown>)['label'] === 'string',
  );
}

function isWiredPinArray(v: unknown): v is WiredPin[] {
  return Array.isArray(v) && v.every(x =>
    typeof x === 'object' && x !== null &&
    typeof (x as Record<string, unknown>)['pinNumber'] === 'number' &&
    typeof (x as Record<string, unknown>)['deviceType'] === 'string' &&
    typeof (x as Record<string, unknown>)['id'] === 'string',
  );
}

function isPeripheralDisplayStateArray(v: unknown): v is PeripheralDisplayState[] {
  return Array.isArray(v) && v.every(x =>
    typeof x === 'object' && x !== null &&
    typeof (x as Record<string, unknown>)['id'] === 'string' &&
    typeof (x as Record<string, unknown>)['label'] === 'string' &&
    typeof (x as Record<string, unknown>)['enabled'] === 'boolean' &&
    Array.isArray((x as Record<string, unknown>)['pins']),
  );
}

// ── Pin definitions (loaded from data island) ─────────────────────────────
const pinDefsResult = readDataIsland<PinDef[]>(el<HTMLElement>('pin-defs').textContent ?? '[]', isPinDefArray, []);
if (pinDefsResult.error) showDataIslandError('pin-defs', pinDefsResult.error);
const PIN_DEFS: PinDef[] = pinDefsResult.value;

// ── State ─────────────────────────────────────────────────────────────────
const initDataResult = readDataIsland<WiredPin[]>(el<HTMLElement>('init-data').textContent ?? '[]', isWiredPinArray, []);
if (initDataResult.error) showDataIslandError('init-data', initDataResult.error);
let wiredPins: WiredPin[] = initDataResult.value;

const peripheralsResult = readDataIsland<PeripheralDisplayState[]>(
  el<HTMLElement>('peripherals-data').textContent ?? '[]',
  isPeripheralDisplayStateArray,
  [],
);
if (peripheralsResult.error) showDataIslandError('peripherals-data', peripheralsResult.error);
let peripherals: PeripheralDisplayState[] = peripheralsResult.value;
// The free pin the assign popup is open for.
let popupPin: { pinNumber: number } | null = null;
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
    // A bus peripheral's pin carries a live "pin · signal · owner" tooltip
    // (FR-DEV-12) — g.dataset['tip'] is set/cleared by applyPeripheralPins()
    // as peripherals are enabled/disabled, so this listener is attached once
    // here and reads whatever tip is current at hover time.
    g.addEventListener('mousemove', (e) => {
      const tip = g.dataset['tip'];
      if (!tip) return;
      showTooltip(tip, e as MouseEvent);
    });
    g.addEventListener('mouseleave', hideTooltip);
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
    g.classList.remove(...wiredControlIds().map(id => `pin-${id}`), 'pin-unassigned', 'pin-adc');
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

// ── Micro USB port indicator (FR-DEV-17) ──────────────────────────────────
// A connector-attached peripheral in its zero-pin mode (midiUsb's INTERNAL)
// has no resolved pin to mark the way a bus peripheral's pins already are —
// the board's static USB port graphic is the only thing on the SVG that can
// represent "connected here" for it. Listener attached once; reads whatever
// tip is current at hover time, same convention as a pin dot's tooltip.
const usbPortGroup = document.getElementById('usb-port-group');
usbPortGroup?.addEventListener('mousemove', (e) => {
  const tip = usbPortGroup.dataset['tip'];
  if (!tip) return;
  showTooltip(tip, e as MouseEvent);
});
usbPortGroup?.addEventListener('mouseleave', hideTooltip);
usbPortGroup?.addEventListener('click', (e) => {
  const owner = peripherals.find(p => p.enabled && p.bus === 'INTERNAL');
  if (!owner) return;
  e.stopPropagation();
  openDevicePopover({ kind: 'peripheral', id: owner.id }, e as MouseEvent);
});

function updateUsbPortIndicator(): void {
  if (!usbPortGroup) return;
  const owner = peripherals.find(p => p.enabled && p.bus === 'INTERNAL');
  usbPortGroup.classList.toggle('active', !!owner);
  if (owner) usbPortGroup.dataset['tip'] = `${owner.label} · micro USB connector (INTERNAL)`;
  else delete usbPortGroup.dataset['tip'];
}

// ── Peripherals section (FR-DEV-11/12) ────────────────────────────────────

// Marks each enabled peripheral's resolved pins with the generic `pin-bus`
// class and a hover tooltip ("pin · signal · owner") — a hand-wired control
// on the same pin still wins visually (should never legitimately happen
// once FR-DEV-13's reject-with-remedy lands, but a loaded-from-disk
// conflict is possible today). Recomputes and re-applies every assignable
// pin's *full* desired class on every call via the pure
// computePinOverlayStates — a pin whose peripheral was just disabled
// correctly reverts to pin-unassigned/pin-adc rather than staying pin-bus
// forever (regression: the previous add-only version never restored it).
function applyPeripheralPins(): void {
  for (const state of computePinOverlayStates(PIN_DEFS, wiredPins, peripherals)) {
    const g = document.getElementById('pin-' + state.pin);
    if (!g) continue;
    g.classList.remove(...wiredControlIds().map(id => `pin-${id}`), 'pin-unassigned', 'pin-adc', 'pin-bus');
    g.classList.add(state.className);
    if (state.tip) g.dataset['tip'] = state.tip;
    else delete g.dataset['tip'];
  }
}

function renderPeripherals(): void {
  const host = el<HTMLElement>('periph-list');
  host.innerHTML = '';
  for (const p of peripherals) {
    const row = document.createElement('div');
    row.className = 'periph ' + (p.enabled ? 'on' : 'off');

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = p.enabled;
    box.addEventListener('change', () => {
      vscode.postMessage({ command: 'setPeripheralEnabled', peripheralId: p.id, enabled: box.checked });
    });

    const name = document.createElement('span');
    name.className = 'periph-name';
    name.textContent = p.label;

    const pins = document.createElement('span');
    pins.className = 'periph-pins';
    // FR-DEV-17: a zero-pin bus (midiUsb's INTERNAL mode — the micro USB
    // connector, modeled without a resolved pin footprint) would otherwise
    // render as a blank cell with nothing indicating it's connected at all.
    // Fall back to the bus/mode label itself, same as oled's row already
    // implicitly relies on pins to communicate its bus.
    pins.textContent = p.pins.length
      ? p.pins.map(rp => 'D' + rp.pin).join(', ')
      : (p.bus ?? '');

    row.append(box, name, pins);

    // FR-DEV-15/18: any peripheral with a live view (oled, midiTrs, midiUsb)
    // gets a "View" button, gated on REGISTRY's hasLiveView flag rather than
    // a hardcoded id now that more than one consumer exists. Shown only once
    // enabled — nothing to view otherwise.
    if (REGISTRY[p.id]?.hasLiveView && p.enabled) {
      const viewBtn = document.createElement('button');
      viewBtn.type = 'button';
      viewBtn.className = 'periph-view-btn';
      viewBtn.textContent = 'View';
      viewBtn.addEventListener('click', () => {
        vscode.postMessage({ command: 'viewPeripheral', peripheralId: p.id });
      });
      row.append(viewBtn);
    }

    host.appendChild(row);
  }
  applyPeripheralPins();
  renderBusBrackets();
  updateUsbPortIndicator();
}

// ── Bus bracket tooltip and popover (FR-DEV-12) ───────────────────────────

function showTooltip(text: string, e: MouseEvent): void {
  tooltip.textContent = text;
  tooltip.style.display = 'block';
  tooltip.style.left = (e.clientX + 14) + 'px';
  tooltip.style.top = (e.clientY + 14) + 'px';
}

function hideTooltip(): void {
  tooltip.style.display = 'none';
}

// ── Device popover (FR-UDM-3) ─────────────────────────────────────────────
// One popover for every placed device — a control's pin, a peripheral's
// bracket or pin, or the micro-USB port. Content comes from the pure
// describePlacedDevice(); this only renders it and wires the actions.

let devicePopoverOpen = false;

function hideDevicePopover(): void {
  devicePopover.style.display = 'none';
  devicePopoverOpen = false;
}

function openDevicePopover(target: PopoverTarget, e: MouseEvent): void {
  closePopup();
  hideTooltip();
  const m = describePlacedDevice(target, wiredPins, peripherals);
  if (!m) { hideDevicePopover(); return; }

  devicePopover.innerHTML = '';

  const hdr = document.createElement('div');
  hdr.className = 'dp-hdr';
  const dot = document.createElement('div');
  dot.className = 'dp-dot';
  dot.style.background = m.accentColor;
  const title = document.createElement('div');
  title.className = 'dp-title';
  title.textContent = m.label;
  hdr.append(dot, title);
  if (m.subtitle !== null) {
    const sub = document.createElement('div');
    sub.className = 'dp-sub';
    sub.textContent = m.subtitle;
    hdr.append(sub);
  }

  const body = document.createElement('div');
  body.className = 'dp-body';
  const row = document.createElement('div');
  row.className = 'dp-row';
  const key = document.createElement('span');
  key.className = 'dp-key';
  key.textContent = m.rowKey;
  const val = document.createElement('span');
  val.textContent = m.rowValue;
  row.append(key, val);
  body.append(row);

  const actions = document.createElement('div');
  actions.className = 'dp-actions';
  if (m.showPanel) {
    const showBtn = document.createElement('button');
    showBtn.type = 'button';
    showBtn.className = 'dp-primary';
    showBtn.id = 'dp-show-panel';
    showBtn.textContent = '▣ Show panel';
    showBtn.addEventListener('click', () => {
      vscode.postMessage({ command: 'viewPeripheral', peripheralId: target.id });
      hideDevicePopover();
    });
    actions.append(showBtn);
  }
  const revealBtn = document.createElement('button');
  revealBtn.type = 'button';
  revealBtn.id = 'dp-reveal';
  revealBtn.textContent = 'Reveal in code';
  revealBtn.addEventListener('click', () => {
    // A control is found by its instance id; a peripheral by its registry id.
    vscode.postMessage({ command: 'revealInCode', id: m.subtitle ?? target.id });
    hideDevicePopover();
  });
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'dp-danger';
  removeBtn.id = 'dp-remove';
  removeBtn.textContent = 'Remove';
  removeBtn.addEventListener('click', () => {
    vscode.postMessage(m.remove);
    hideDevicePopover();
  });
  actions.append(revealBtn, removeBtn);

  devicePopover.append(hdr, body, actions);
  devicePopover.style.display = 'block';
  devicePopoverOpen = true;
  devicePopover.style.left = Math.min(e.clientX + 12, window.innerWidth - 280) + 'px';
  devicePopover.style.top  = Math.max(10, Math.min(e.clientY + 12, window.innerHeight - 180)) + 'px';
}

// Redraws every enabled peripheral's collapsed bracket (FR-DEV-12) — one
// bracket per peripheral, spanning its topmost-to-bottommost pin row, never
// one label per pin.
function renderBusBrackets(): void {
  svg.querySelectorAll('.bus-grp').forEach(node => node.remove());

  for (const b of computeBusBrackets(peripherals, PIN_DEFS)) {
    const y0 = pinY(b.minRow) - 10;
    const y1 = pinY(b.maxRow) + 10;

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.classList.add('bus-grp');

    const hit = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    hit.classList.add('bracket-hit');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.classList.add('bus-bracket');
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.classList.add('bus-bracket-label');
    label.textContent = b.label;
    label.setAttribute('y', String((y0 + y1) / 2 + 3));

    if (b.side === 'L') {
      hit.setAttribute('x', '150');
      hit.setAttribute('width', '40');
      path.setAttribute('d', `M172 ${y0} L160 ${y0} L160 ${y1} L172 ${y1}`);
      label.setAttribute('x', '156');
      label.setAttribute('text-anchor', 'end');
    } else {
      hit.setAttribute('x', '380');
      hit.setAttribute('width', '40');
      path.setAttribute('d', `M388 ${y0} L400 ${y0} L400 ${y1} L388 ${y1}`);
      label.setAttribute('x', '404');
      label.setAttribute('text-anchor', 'start');
    }
    hit.setAttribute('y', String(y0 - 4));
    hit.setAttribute('height', String(y1 - y0 + 8));

    g.append(hit, path, label);
    g.addEventListener('click', (e) => {
      e.stopPropagation();
      openDevicePopover({ kind: 'peripheral', id: b.id }, e as MouseEvent);
    });
    svg.appendChild(g);
  }
}

document.addEventListener('click', e => {
  if (devicePopoverOpen && !devicePopover.contains(e.target as Node)) hideDevicePopover();
});

renderPeripherals();

// ── Pin click handler ─────────────────────────────────────────────────────
function onPinClick(e: Event): void {
  e.stopPropagation();
  const g         = e.currentTarget as HTMLElement;
  const pinNumber = parseInt(g.dataset['pin'] || '', 10);
  const existing  = wiredPins.find(wp => wp.pinNumber === pinNumber);
  const periphId  = existing ? null : peripheralOwningPin(pinNumber, peripherals);

  if (existing) {
    openDevicePopover({ kind: 'control', id: existing.id }, e as MouseEvent);
  } else if (periphId !== null) {
    openDevicePopover({ kind: 'peripheral', id: periphId }, e as MouseEvent);
  } else {
    showAssignPopup(pinNumber, e as MouseEvent);
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
  el<HTMLInputElement>('id-input').value = '';
  el<HTMLElement>('id-error').textContent = '';
  el<HTMLButtonElement>('popup-confirm').disabled = true;
  deviceButtonIds().forEach(id => {
    el<HTMLElement>(id).classList.remove('selected');
  });
}

function showAssignPopup(pinNumber: number, e: MouseEvent): void {
  hideDevicePopover();
  popupPin = { pinNumber };
  el<HTMLElement>('popup-title').textContent = 'Assign pin D' + pinNumber;
  const pinDef = PIN_DEFS.find(d => d.pin === pinNumber);
  for (const id of wiredControlIds()) {
    const badge = document.getElementById('warn-' + id);
    if (badge) badge.style.display = pinDef && !isPinEligible(pinDef, id) ? 'inline' : 'none';
  }
  selectedKind = null;
  el<HTMLInputElement>('id-input').value = '';
  el<HTMLElement>('id-error').textContent = '';
  el<HTMLButtonElement>('popup-confirm').disabled = true;
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

// Close popup on outside click
document.addEventListener('click', e => {
  if (popup.style.display === 'block' && !popup.contains(e.target as Node)) closePopup();
});

// Extension → webview messages
const WIRING_HOST_COMMANDS = new Set<WiringHostMessage['command']>(['wiredPins', 'peripherals']);

window.addEventListener('message', (e: MessageEvent<unknown>) => {
  if (!hasKnownCommand(e.data, WIRING_HOST_COMMANDS)) return;
  const msg = e.data as WiringHostMessage;
  if (msg.command === 'wiredPins') {
    applyWiredPins(msg.pins || []);
    applyPeripheralPins();
    if (devicePopoverOpen) hideDevicePopover();
  } else if (msg.command === 'peripherals') {
    peripherals = msg.peripherals || [];
    renderPeripherals();
    // An externally-driven change (another view, a reload) can update the
    // very device this webview's popover is open for — closing it rather
    // than leaving stale content on screen is simplest.
    if (devicePopoverOpen) hideDevicePopover();
  }
});
