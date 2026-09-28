/// <reference lib="dom" />
import type { WiringHostMessage, WiringWebviewMessage } from './messages';
import type { PinDef, WiredPin, PeripheralDisplayState } from '../wiring/wiring-panel';
import { computePinDisplayStates } from '../wiring/wired-pin-state';
import { validateId } from '../wiring/id-validation';
import { REGISTRY, wiredControlIds } from '../devices/registry';
import { computeBusBrackets } from '../wiring/bus-bracket';
import { computePinOverlayStates } from '../wiring/pin-overlay-state';
import {
  describePlacedDevice, peripheralOwningPin, describePlacement, placementMessage, type PopoverTarget,
} from '../wiring/device-popover';
import { computeDropTargets, type DropTarget } from '../wiring/drop-targets';
import { targetKey, pinDragStates, previewSlots, dragLabel } from '../wiring/drag-view';
import { hasKnownCommand } from './message-guard';
import { el } from './dom-lookup';
import { readDataIsland, showDataIslandError } from './data-island';

interface WiringViewState {
  paletteCollapsed?: boolean;
}

interface VsCodeApiForWiring {
  postMessage(msg: WiringWebviewMessage): void;
  getState(): WiringViewState | undefined;
  setState(state: WiringViewState): void;
}

const vscode      = acquireVsCodeApi() as unknown as VsCodeApiForWiring;
const svg         = el<HTMLElement & SVGSVGElement>('pinout');
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
    g.classList.add('pin-unassigned');
    g.addEventListener('click', onPinClick);
    g.addEventListener('pointerdown', onPinPointerDown);
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

  // Drag-time overlays (FR-UDM-6): an occupied target's ⚠ and a previewed
  // multi-pin footprint's slot name (R/G/B, A/B/SW). Hidden unless styled on.
  if (isAssignable) {
    const warn = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    warn.setAttribute('x', String(cx + (def.side === 'L' ? 7 : -12)));
    warn.setAttribute('y', String(cy - 6));
    warn.classList.add('warn-mark');
    warn.textContent = '⚠';
    const slot = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    slot.setAttribute('x', String(cx));
    slot.setAttribute('y', String(cy + 3));
    slot.setAttribute('text-anchor', 'middle');
    slot.classList.add('slot-no');
    g.append(warn, slot);
  }

  svg.appendChild(g);
});

// ── Apply wiredPins state to SVG ──────────────────────────────────────────
function applyWiredPins(pins: WiredPin[]): void {
  wiredPins = pins;
  for (const state of computePinDisplayStates(PIN_DEFS, pins)) {
    const g = document.getElementById('pin-' + state.pin);
    if (!g) continue;
    g.classList.remove(...wiredControlIds().map(id => `pin-${id}`), 'pin-unassigned');
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
// correctly reverts to pin-unassigned rather than staying pin-bus
// forever (regression: the previous add-only version never restored it).
function applyPeripheralPins(): void {
  for (const state of computePinOverlayStates(PIN_DEFS, wiredPins, peripherals)) {
    const g = document.getElementById('pin-' + state.pin);
    if (!g) continue;
    g.classList.remove(...wiredControlIds().map(id => `pin-${id}`), 'pin-unassigned', 'pin-bus');
    g.classList.add(state.className);
    if (state.tip) g.dataset['tip'] = state.tip;
    else delete g.dataset['tip'];
  }
}

// ── Device palette (FR-UDM-5) ─────────────────────────────────────────────
const paletteCol = el<HTMLElement>('palette-col');
const paletteToggle = el<HTMLButtonElement>('palette-toggle');

function setPaletteCollapsed(collapsed: boolean): void {
  paletteCol.classList.toggle('collapsed', collapsed);
  paletteToggle.textContent = collapsed ? '▶' : '◀';
  paletteToggle.title = collapsed ? 'Expand palette' : 'Collapse palette';
}

setPaletteCollapsed(vscode.getState()?.paletteCollapsed === true);
paletteToggle.addEventListener('click', () => {
  const collapsed = !paletteCol.classList.contains('collapsed');
  setPaletteCollapsed(collapsed);
  vscode.setState({ ...vscode.getState(), paletteCollapsed: collapsed });
});

// A placed peripheral's chip is marked; dragging it again moves it (FR-UDM-9).
function markPlacedChips(): void {
  paletteCol.querySelectorAll<HTMLElement>('.device-chip').forEach(chip => {
    const id = chip.dataset['device'];
    chip.classList.toggle('placed', peripherals.some(p => p.id === id && p.enabled));
  });
}

// FR-UDM-10: peripherals are shown on the board only — pins, bracket, USB
// port and the palette's placed marker. The footer list is gone.
function renderPeripherals(): void {
  markPlacedChips();
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

// ── Drag & drop (FR-UDM-6) ────────────────────────────────────────────────
// Pointer events (not HTML5 DnD) so SVG pins, lanes and the USB port are
// all hit-tested the same way via elementFromPoint + [data-target]. Targets
// come from the pure computeDropTargets(); this only paints them.

interface DragSession {
  deviceId: string;
  chip: HTMLElement | null;
  /** A moving control's id — its own pins count as free (FR-UDM-9). */
  exclude?: string;
  /** True when a placed device is being moved rather than added (FR-UDM-9). */
  moving: boolean;
  targets: Map<string, DropTarget>;
  hover: DropTarget | null;
  started: boolean;
  x0: number;
  y0: number;
}

const DRAG_THRESHOLD_PX = 4;
const ghost = el<HTMLElement>('ghost');
const lanesLayer = el<HTMLElement & SVGGElement>('lanes');
const hintEl = el<HTMLElement>('hint');
const idleHint = hintEl.textContent ?? '';
let drag: DragSession | null = null;

function startDrag(e: PointerEvent, deviceId: string, chip: HTMLElement | null, exclude?: string): void {
  if (e.button !== 0 || drag) return;
  e.preventDefault();
  const list = computeDropTargets(deviceId, PIN_DEFS, { wiredPins, peripherals }, exclude);
  // A placed peripheral is one-per-type, so dragging its chip again moves it.
  const moving = exclude !== undefined || peripherals.some(p => p.id === deviceId && p.enabled);
  drag = {
    deviceId, chip, exclude, moving,
    targets: new Map(list.map(t => [targetKey(t), t])),
    hover: null, started: false, x0: e.clientX, y0: e.clientY,
  };
  document.addEventListener('pointermove', onDragMove);
  document.addEventListener('pointerup', onDragUp);
  document.addEventListener('pointercancel', cancelDrag);
  window.addEventListener('blur', cancelDrag);
}

function onDragMove(e: PointerEvent): void {
  if (!drag) return;
  if (!drag.started) {
    if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < DRAG_THRESHOLD_PX) return;
    drag.started = true;
      hideDevicePopover();
    hideTooltip();
    drag.chip?.classList.add('dragging');
    document.body.classList.add('drag-active');
    const d = REGISTRY[drag.deviceId];
    ghost.style.setProperty('--accent', d?.accentColor ?? '#4ec9b0');
    ghost.querySelector('.lbl')!.textContent = drag.exclude ? `${drag.exclude} (${d?.label ?? drag.deviceId})` : d?.label ?? drag.deviceId;
    ghost.style.display = 'block';
    const n = drag.targets.size;
    const verb = drag.moving ? 'Moving' : 'Dragging';
    const what = drag.exclude ?? d?.label ?? drag.deviceId;
    hintEl.textContent = `${verb} ${what} — ${n} valid target${n === 1 ? '' : 's'}. Release off-target or press Esc to cancel.`;
    paintDrag();
  }
  ghost.style.left = (e.clientX + 14) + 'px';
  ghost.style.top = (e.clientY + 10) + 'px';

  const under = document.elementFromPoint(e.clientX, e.clientY);
  const key = under?.closest<HTMLElement | SVGElement>('[data-target]')?.dataset['target'] ?? null;
  const hover = key ? drag.targets.get(key) ?? null : null;
  if (hover !== drag.hover) {
    drag.hover = hover;
    paintDrag();
  }
  const label = dragLabel(hover, !!under?.closest('#pinout'));
  ghost.classList.remove('ok', 'warn', 'no');
  if (label.tone !== 'none') ghost.classList.add(label.tone);
  ghost.querySelector('.tgt')!.textContent = label.text;
}

function endDrag(): DragSession | null {
  const d = drag;
  drag = null;
  document.removeEventListener('pointermove', onDragMove);
  document.removeEventListener('pointerup', onDragUp);
  document.removeEventListener('pointercancel', cancelDrag);
  window.removeEventListener('blur', cancelDrag);
  ghost.style.display = 'none';
  document.body.classList.remove('drag-active');
  d?.chip?.classList.remove('dragging');
  hintEl.textContent = idleHint;
  paintDrag();
  return d;
}

// Release off-target / Esc / pointercancel: nothing changes.
function cancelDrag(): void {
  if (drag) endDrag();
}

function onDragUp(e: PointerEvent): void {
  const d = endDrag();
  if (!d || !d.started) return;
  // The browser follows this pointerup with a click on the common ancestor
  // of the chip and the drop point — swallow it, or the outside-click
  // handlers would close the popover the drop is about to open.
  suppressNextClick = true;
  setTimeout(() => { suppressNextClick = false; }, 0);
  if (d.hover) onDrop(d, d.hover, e);
}

let suppressNextClick = false;
document.addEventListener('click', e => {
  if (!suppressNextClick) return;
  suppressNextClick = false;
  e.stopPropagation();
}, true);

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && drag) cancelDrag();
});

// FR-UDM-9: dragging a placed control off one of its pins lifts it. A plain
// click (no movement past the threshold) still opens its device popover.
function onPinPointerDown(e: PointerEvent): void {
  const pin = parseInt((e.currentTarget as HTMLElement).dataset['pin'] ?? '', 10);
  const wired = wiredPins.find(wp => wp.pinNumber === pin);
  if (wired) startDrag(e, wired.deviceType, null, wired.id);
}

paletteCol.querySelectorAll<HTMLElement>('.device-chip').forEach(chip => {
  // Collapsed to a rail, a chip is just a dot — name it on hover (FR-UDM-5).
  chip.addEventListener('mousemove', e => {
    const tip = chip.dataset['tip'];
    if (tip && !drag && paletteCol.classList.contains('collapsed')) showTooltip(tip, e);
  });
  chip.addEventListener('mouseleave', hideTooltip);
  chip.addEventListener('pointerdown', e => {
    const id = chip.dataset['device'];
    if (id && REGISTRY[id]) startDrag(e, id, chip);
  });
});

// Repaints every pin, lane and the USB port for the current drag (or clears
// all drag-time state when none is in progress).
function paintDrag(): void {
  const d = drag?.started ? drag : null;
  svg.classList.toggle('dragging', !!d);
  if (d) svg.style.setProperty('--accent', REGISTRY[d.deviceId]?.accentColor ?? '#4ec9b0');
  const states = pinDragStates(d ? [...d.targets.values()] : []);
  const preview = d?.hover ? previewSlots(d.deviceId, d.hover) : new Map<number, string>();

  for (const def of PIN_DEFS) {
    const g = document.getElementById('pin-' + (def.pin !== null ? def.pin : def.side + def.row));
    if (!g) continue;
    g.classList.remove('ctx-free', 'ctx-occ', 'ctx-ineligible', 'ctx-preview');
    delete g.dataset['target'];
    const slot = g.querySelector('.slot-no');
    if (slot) slot.textContent = '';
    if (!d) continue;
    if (def.pin === null) { g.classList.add('ctx-ineligible'); continue; }
    const st = states.get(def.pin);
    if (st) {
      g.dataset['target'] = st.key;
      if (st.state === 'free') g.classList.add('ctx-free');
      else if (st.state === 'occ') g.classList.add('ctx-occ');
    }
    const slotName = preview.get(def.pin);
    if (slotName !== undefined) {
      g.classList.add('ctx-preview');
      if (slot) slot.textContent = slotName;
    } else if (!st) {
      g.classList.add('ctx-ineligible');
    }
  }

  lanesLayer.innerHTML = '';
  if (d) {
    for (const [key, t] of d.targets) {
      if (t.kind !== 'lane') continue;
      const defs = t.pins.map(p => PIN_DEFS.find(pd => pd.pin === p)).filter((x): x is PinDef => !!x);
      const first = defs[0];
      if (!first) continue;
      const rows = defs.map(pd => pd.row);
      const y0 = pinY(Math.min(...rows)) - 13;
      const y1 = pinY(Math.max(...rows)) + 13;
      const left = first.side === 'L';
      const occ = t.conflicts.length > 0;
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', left ? '14' : '380');
      rect.setAttribute('y', String(y0));
      rect.setAttribute('width', '166');
      rect.setAttribute('height', String(y1 - y0));
      rect.setAttribute('rx', '6');
      rect.classList.add('drop-lane');
      if (occ) rect.classList.add('occ');
      if (d.hover === t) rect.classList.add('hot');
      rect.dataset['target'] = key;
      const lbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      lbl.setAttribute('x', left ? '150' : '410');
      lbl.setAttribute('y', String((y0 + y1) / 2 + 3));
      lbl.setAttribute('text-anchor', 'middle');
      lbl.classList.add('drop-lane-lbl');
      if (occ) lbl.classList.add('occ');
      lbl.textContent = (occ ? '⚠ ' : '') + (t.bus ?? '');
      lbl.dataset['target'] = key;
      lanesLayer.append(rect, lbl);
    }
  }

  if (usbPortGroup) {
    usbPortGroup.classList.remove('ctx-free', 'ctx-occ', 'ctx-ineligible', 'ctx-preview');
    delete usbPortGroup.dataset['target'];
    const usb = d?.targets.get('usb');
    if (d && usb) {
      usbPortGroup.dataset['target'] = 'usb';
      usbPortGroup.classList.add(usb.conflicts.length ? 'ctx-occ' : 'ctx-free');
      if (d.hover === usb) usbPortGroup.classList.add('ctx-preview');
    } else if (d) {
      usbPortGroup.classList.add('ctx-ineligible');
    }
  }
}

// FR-UDM-7: a drop opens the placement popover — pins (slot names) or the
// dropped-on bus, an id field for controls, and Add / Cancel. Cancel (or
// clicking away) changes nothing.
function onDrop(session: DragSession, target: DropTarget, e: PointerEvent): void {
  openPlacementPopover(session.deviceId, target, e, session.moving, session.exclude);
}

function popoverHeader(label: string, accent: string, sub: string | null): HTMLElement {
  const hdr = document.createElement('div');
  hdr.className = 'dp-hdr';
  const dot = document.createElement('div');
  dot.className = 'dp-dot';
  dot.style.background = accent;
  const title = document.createElement('div');
  title.className = 'dp-title';
  title.textContent = label;
  hdr.append(dot, title);
  if (sub !== null) {
    const s = document.createElement('div');
    s.className = 'dp-sub';
    s.textContent = sub;
    hdr.append(s);
  }
  return hdr;
}

function popoverRow(key: string, value: string | HTMLElement): HTMLElement {
  const row = document.createElement('div');
  row.className = 'dp-row';
  const k = document.createElement('span');
  k.className = 'dp-key';
  k.textContent = key;
  row.append(k);
  if (typeof value === 'string') {
    const v = document.createElement('span');
    v.textContent = value;
    row.append(v);
  } else {
    row.append(value);
  }
  return row;
}

function showPopoverAt(e: MouseEvent): void {
  devicePopover.style.display = 'block';
  devicePopoverOpen = true;
  devicePopover.style.left = Math.min(e.clientX + 12, window.innerWidth - 280) + 'px';
  devicePopover.style.top  = Math.max(10, Math.min(e.clientY + 12, window.innerHeight - devicePopover.offsetHeight - 10)) + 'px';
}

// `moveId` is the id of a control being moved (FR-UDM-9); Cancel leaves it
// exactly where it was, since nothing is sent until Move / Replace.
function openPlacementPopover(
  deviceId: string, target: DropTarget, e: MouseEvent, moving = false, moveId?: string,
): void {
  hideTooltip();
  const m = describePlacement(deviceId, target, wiredPins, moving);
  devicePopover.innerHTML = '';

  const body = document.createElement('div');
  body.className = 'dp-body';
  body.append(popoverRow(m.rowKey, m.rowValue));

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'dp-primary';
  addBtn.id = 'dp-add';
  // FR-UDM-8: conflict mode — Replace / Cancel, naming what goes. No Relocate.
  const conflict = m.conflicts.length > 0;
  addBtn.textContent = m.action;
  if (conflict) {
    addBtn.classList.add('dp-danger');
    const note = document.createElement('div');
    note.className = 'dp-conflict';
    note.textContent = `⚠ Replaces ${m.conflicts.join(', ')} — ${m.conflicts.length === 1 ? 'it' : 'they'} will be removed.`;
    body.append(note);
  }

  let idInput: HTMLInputElement | null = null;
  let idError: HTMLElement | null = null;
  if (m.needsId) {
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'dp-id';
    input.value = m.defaultId ?? '';
    input.spellcheck = false;
    const err = document.createElement('div');
    err.className = 'dp-error';
    const validate = (): void => {
      const msg = validateId(input.value.trim(), m.idPool);
      err.textContent = msg ?? '';
      addBtn.disabled = !!msg;
    };
    input.addEventListener('input', validate);
    input.addEventListener('keydown', ev => { if (ev.key === 'Enter' && !addBtn.disabled) addBtn.click(); });
    body.append(popoverRow('id', input), err);
    idInput = input;
    idError = err;
    validate();
  }

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.id = 'dp-cancel';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', hideDevicePopover);

  addBtn.addEventListener('click', () => {
    const id = idInput ? idInput.value.trim() : null;
    if (id !== null) {
      const msg = validateId(id, m.idPool);
      if (msg) { if (idError) idError.textContent = msg; return; }
    }
    vscode.postMessage(placementMessage(deviceId, target, id, moveId));
    hideDevicePopover();
  });

  const actions = document.createElement('div');
  actions.className = 'dp-actions';
  actions.append(addBtn, cancelBtn);

  devicePopover.append(popoverHeader(m.label, m.accentColor, moveId ?? null), body, actions);
  showPopoverAt(e);
  idInput?.focus();
  idInput?.select();
}

// ── Pin click handler ─────────────────────────────────────────────────────
function onPinClick(e: Event): void {
  const g         = e.currentTarget as HTMLElement;
  const pinNumber = parseInt(g.dataset['pin'] || '', 10);
  const existing  = wiredPins.find(wp => wp.pinNumber === pinNumber);
  const periphId  = existing ? null : peripheralOwningPin(pinNumber, peripherals);
  const target: PopoverTarget | null = existing
    ? { kind: 'control', id: existing.id }
    : periphId !== null ? { kind: 'peripheral', id: periphId } : null;
  // A free pin is inert (FR-UDM-10): devices are added by dragging from the
  // palette, and its click falls through like any click on empty board.
  if (!target) return;
  e.stopPropagation();
  openDevicePopover(target, e as MouseEvent);
}

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
