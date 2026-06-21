import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';

export type DeviceType = 'pot' | 'button' | 'led';

export interface WiredPin {
  pinNumber: number;
  deviceType: DeviceType;
  id: string;
}

export type WirePinHandler   = (pin: WiredPin) => Promise<void>;
export type UnwirePinHandler = (pinNumber: number, id: string) => Promise<void>;

const PANEL_ID    = 'daisy-wiring';
const PANEL_TITLE = 'Daisy Seed Wiring';

// Daisy Seed pin definitions for the schematic SVG.
// side: 'L' = left header, 'R' = right header.
// pin: D-number for digital GPIO pins; null for power/special (not assignable).
// adc: true for D15–D25 (A0–A10) and D28 (A11); D26/D27/D29/D30 have no ADC.
// label: primary display label.
// aLabel: analog alias (shown for ADC pins).
interface PinDef {
  row:    number;
  side:   'L' | 'R';
  pin:    number | null;
  label:  string;
  aLabel: string | null;
  adc:    boolean;
}

// Pin order matches Seed_pinout.csv:
//   Left  rows 0–19 = CSV rows  1–15  (D0–D14) + rows 16–20 (NC audio/AGND)
//   Right rows 0–19 = CSV rows 40–22  (GND, VIN, 3V3D, D30, D29, A11/D28 … A0/D15, +3V3A)
export const PIN_DEFS: PinDef[] = [
  // ── Left header (rows 0–19, USB end at top) ────────────────────────────
  { row:  0, side: 'L', pin:  0,  label: 'D0',    aLabel: null,  adc: false },
  { row:  1, side: 'L', pin:  1,  label: 'D1',    aLabel: null,  adc: false },
  { row:  2, side: 'L', pin:  2,  label: 'D2',    aLabel: null,  adc: false },
  { row:  3, side: 'L', pin:  3,  label: 'D3',    aLabel: null,  adc: false },
  { row:  4, side: 'L', pin:  4,  label: 'D4',    aLabel: null,  adc: false },
  { row:  5, side: 'L', pin:  5,  label: 'D5',    aLabel: null,  adc: false },
  { row:  6, side: 'L', pin:  6,  label: 'D6',    aLabel: null,  adc: false },
  { row:  7, side: 'L', pin:  7,  label: 'D7',    aLabel: null,  adc: false },
  { row:  8, side: 'L', pin:  8,  label: 'D8',    aLabel: null,  adc: false },
  { row:  9, side: 'L', pin:  9,  label: 'D9',    aLabel: null,  adc: false },
  { row: 10, side: 'L', pin: 10,  label: 'D10',   aLabel: null,  adc: false },
  { row: 11, side: 'L', pin: 11,  label: 'D11',   aLabel: null,  adc: false },
  { row: 12, side: 'L', pin: 12,  label: 'D12',   aLabel: null,  adc: false },
  { row: 13, side: 'L', pin: 13,  label: 'D13',   aLabel: null,  adc: false },
  { row: 14, side: 'L', pin: 14,  label: 'D14',   aLabel: null,  adc: false },
  { row: 15, side: 'L', pin: null, label: 'AIN L', aLabel: null,  adc: false },
  { row: 16, side: 'L', pin: null, label: 'AIN R', aLabel: null,  adc: false },
  { row: 17, side: 'L', pin: null, label: 'AOUT L', aLabel: null, adc: false },
  { row: 18, side: 'L', pin: null, label: 'AOUT R', aLabel: null, adc: false },
  { row: 19, side: 'L', pin: null, label: 'AGND',  aLabel: null,  adc: false },
  // ── Right header (rows 0–19, USB end at top; CSV rows 40→22) ──────────
  { row:  0, side: 'R', pin: null, label: 'GND',   aLabel: null,  adc: false },
  { row:  1, side: 'R', pin: null, label: 'VIN',   aLabel: null,  adc: false },
  { row:  2, side: 'R', pin: null, label: '3V3D',  aLabel: null,  adc: false },
  { row:  3, side: 'R', pin: 30,   label: 'D30',   aLabel: null,  adc: false },
  { row:  4, side: 'R', pin: 29,   label: 'D29',   aLabel: null,  adc: false },
  { row:  5, side: 'R', pin: 28,   label: 'D28',   aLabel: 'A11', adc: true  },
  { row:  6, side: 'R', pin: 27,   label: 'D27',   aLabel: null,  adc: false },
  { row:  7, side: 'R', pin: 26,   label: 'D26',   aLabel: null,  adc: false },
  { row:  8, side: 'R', pin: 25,   label: 'D25',   aLabel: 'A10', adc: true  },
  { row:  9, side: 'R', pin: 24,   label: 'D24',   aLabel: 'A9',  adc: true  },
  { row: 10, side: 'R', pin: 23,   label: 'D23',   aLabel: 'A8',  adc: true  },
  { row: 11, side: 'R', pin: 22,   label: 'D22',   aLabel: 'A7',  adc: true  },
  { row: 12, side: 'R', pin: 21,   label: 'D21',   aLabel: 'A6',  adc: true  },
  { row: 13, side: 'R', pin: 20,   label: 'D20',   aLabel: 'A5',  adc: true  },
  { row: 14, side: 'R', pin: 19,   label: 'D19',   aLabel: 'A4',  adc: true  },
  { row: 15, side: 'R', pin: 18,   label: 'D18',   aLabel: 'A3',  adc: true  },
  { row: 16, side: 'R', pin: 17,   label: 'D17',   aLabel: 'A2',  adc: true  },
  { row: 17, side: 'R', pin: 16,   label: 'D16',   aLabel: 'A1',  adc: true  },
  { row: 18, side: 'R', pin: 15,   label: 'D15',   aLabel: 'A0',  adc: true  },
  { row: 19, side: 'R', pin: null,  label: '+3V3A', aLabel: null,  adc: false },
];

export class WiringPanel {
  private panel:         vscode.WebviewPanel | null = null;
  private msgDisposable: vscode.Disposable   | null = null;
  private readonly nonce: string = randomBytes(16).toString('base64');

  constructor(
    private readonly onWirePin?:   WirePinHandler,
    private readonly onUnwirePin?: UnwirePinHandler,
  ) {}

  show(wiredPins: WiredPin[]): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Two);
      this.postWiredPins(wiredPins);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      PANEL_ID,
      PANEL_TITLE,
      vscode.ViewColumn.Two,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
    );
    this.panel.webview.html = buildHtml(wiredPins, this.nonce);

    this.msgDisposable = this.panel.webview.onDidReceiveMessage(async (msg: unknown) => {
      if (!msg || typeof msg !== 'object') return;
      const m = msg as Record<string, unknown>;
      if (m['command'] === 'wirePin') {
        await this.onWirePin?.({
          pinNumber:  m['pinNumber']  as number,
          deviceType: m['deviceType'] as DeviceType,
          id:         m['id']         as string,
        });
      }
      if (m['command'] === 'unwirePin') {
        await this.onUnwirePin?.(m['pinNumber'] as number, m['id'] as string);
      }
    });

    this.panel.onDidDispose(() => {
      this.msgDisposable?.dispose();
      this.msgDisposable = null;
      this.panel = null;
    });
  }

  postWiredPins(pins: WiredPin[]): void {
    this.panel?.webview.postMessage({ command: 'wiredPins', pins });
  }

  dispose(): void {
    this.msgDisposable?.dispose();
    this.msgDisposable = null;
    this.panel?.dispose();
    this.panel = null;
  }
}

// ── HTML builder ─────────────────────────────────────────────────────────────

function safeJson(obj: unknown): string {
  return JSON.stringify(obj).replace(/<\//g, '<\\/');
}

export function buildHtml(wiredPins: WiredPin[], nonce: string): string {
  return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Daisy Seed Wiring</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #1e1e1e; color: #d4d4d4; font-family: monospace; font-size: 12px;
           display: flex; flex-direction: column; height: 100vh; }
    h1 { padding: 8px 14px; font-size: 13px; color: #9cdcfe; background: #252526;
         border-bottom: 1px solid #3c3c3c; flex-shrink: 0; }
    #hint { padding: 4px 14px 6px; font-size: 11px; color: #6a6a6a; background: #252526;
            border-bottom: 1px solid #3c3c3c; flex-shrink: 0; }
    #svg-wrap { flex: 1; overflow: auto; padding: 16px; display: flex; justify-content: center; }
    svg { max-width: 560px; width: 100%; }
    /* Pin dots */
    .pin-dot { cursor: pointer; }
    .pin-dot:hover circle { stroke: #4ec9b0; stroke-width: 2; }
    .pin-unassigned circle { fill: #3c3c3c; stroke: #555; stroke-width: 1; }
    .pin-adc circle { fill: #2a3a2a; stroke: #4a7a4a; stroke-width: 1; }
    .pin-adc:hover circle { stroke: #4ec9b0; }
    .pin-pot    circle { fill: #1a4a4a; stroke: #4ec9b0; stroke-width: 2; }
    .pin-button circle { fill: #1a2a4a; stroke: #569cd6; stroke-width: 2; }
    .pin-led    circle { fill: #4a1a1a; stroke: #f04a4a; stroke-width: 2; }
    .pin-power  circle { fill: #2a2a2a; stroke: #444; stroke-width: 1; }
    /* Labels */
    .pin-label { font-size: 10px; fill: #d4d4d4; font-family: monospace; }
    .a-label   { font-size: 8px;  fill: #4ec9b0; font-family: monospace; }
    .pin-power-label { fill: #555; }
    .assigned-id { font-size: 9px; fill: #9cdcfe; font-family: monospace; }
    /* Board body */
    .board-body { fill: #252526; stroke: #555; stroke-width: 1; }
    .board-label { font-size: 11px; fill: #6a6a6a; font-family: monospace; text-anchor: middle; }
    /* USB port indicator */
    .usb-port  { fill: #3a3a3a; stroke: #777; stroke-width: 1; }
    .usb-inner { fill: #252526; stroke: #555; stroke-width: 1; }
    /* Popup */
    #popup { position: fixed; display: none; background: #252526; border: 1px solid #555;
             border-radius: 4px; padding: 12px; min-width: 200px; z-index: 100;
             box-shadow: 0 4px 16px rgba(0,0,0,0.5); }
    #popup h2 { font-size: 12px; color: #9cdcfe; margin-bottom: 10px; }
    .popup-btn { display: block; width: 100%; text-align: left; background: #3c3c3c;
                 color: #d4d4d4; border: 1px solid #555; border-radius: 3px; padding: 6px 10px;
                 margin-bottom: 6px; cursor: pointer; font-family: monospace; font-size: 12px; }
    .popup-btn:hover { background: #4a4a4a; }
    .popup-btn.selected { background: #0e639c; border-color: #1177bb; color: #fff; }
    .warn-badge { font-size: 10px; color: #f4c430; margin-left: 6px; }
    #id-row { margin-top: 8px; }
    #id-label { font-size: 10px; color: #9a9a9a; margin-bottom: 3px; }
    #id-input { background: #3c3c3c; color: #d4d4d4; border: 1px solid #555; padding: 4px 6px;
                font-family: monospace; font-size: 12px; width: 100%; border-radius: 2px; }
    #id-error { font-size: 10px; color: #f48771; margin-top: 3px; min-height: 14px; }
    .popup-actions { display: flex; gap: 8px; margin-top: 10px; }
    .popup-confirm { background: #0e639c; color: #fff; border: none; padding: 5px 12px;
                     border-radius: 2px; cursor: pointer; font-family: monospace; font-size: 12px; }
    .popup-confirm:hover { background: #1177bb; }
    .popup-confirm:disabled { opacity: 0.4; cursor: default; }
    .popup-cancel { background: #3c3c3c; color: #d4d4d4; border: 1px solid #555; padding: 5px 12px;
                    border-radius: 2px; cursor: pointer; font-family: monospace; font-size: 12px; }
    .popup-cancel:hover { background: #4a4a4a; }
    /* Assigned-pin popup */
    .assigned-info { font-size: 11px; color: #b5cea8; margin-bottom: 10px; }
    .popup-remove { background: #5a1a1a; color: #f48771; border: 1px solid #c94040;
                    padding: 5px 12px; border-radius: 2px; cursor: pointer;
                    font-family: monospace; font-size: 12px; }
    .popup-remove:hover { background: #7a1a1a; }
  </style>
</head>
<body>
  <h1>Daisy Seed Wiring Editor</h1>
  <div id="hint">Click a pin to assign a device · Click an assigned pin to remove it</div>
  <div id="svg-wrap">
    <svg id="pinout" viewBox="0 0 560 600" xmlns="http://www.w3.org/2000/svg">
      <!-- Board body -->
      <rect class="board-body" x="190" y="20" width="180" height="560" rx="6"/>
      <text class="board-label" x="280" y="300">DAISY</text>
      <text class="board-label" x="280" y="316">SEED</text>
      <!-- Micro USB port at board top -->
      <polygon class="usb-port" points="262,6 298,6 302,20 258,20"/>
      <polygon class="usb-inner" points="265,8 295,8 299,18 261,18"/>
      <!-- Pins generated by JS -->
    </svg>
  </div>

  <!-- Device-assignment popup -->
  <div id="popup">
    <h2 id="popup-title">Pin D?</h2>
    <!-- Unassigned view -->
    <div id="popup-assign">
      <button class="popup-btn" id="btn-pot">Pot<span class="warn-badge" id="pot-warn" style="display:none">⚠ non-ADC pin</span></button>
      <button class="popup-btn" id="btn-button">Button</button>
      <button class="popup-btn" id="btn-led">LED</button>
      <div id="id-row">
        <div id="id-label">id / varname</div>
        <input type="text" id="id-input" placeholder="e.g. pot1"/>
        <div id="id-error"></div>
      </div>
      <div class="popup-actions">
        <button class="popup-confirm" id="popup-confirm" disabled>Add</button>
        <button class="popup-cancel"  id="popup-cancel-assign">Cancel</button>
      </div>
    </div>
    <!-- Assigned view -->
    <div id="popup-assigned" style="display:none">
      <div class="assigned-info" id="assigned-info"></div>
      <div class="popup-actions">
        <button class="popup-remove" id="popup-remove">Remove</button>
        <button class="popup-cancel" id="popup-cancel-assigned">Cancel</button>
      </div>
    </div>
  </div>

  <script id="init-data" type="application/json" nonce="${nonce}">${safeJson(wiredPins)}</script>
  <script nonce="${nonce}">
    const vscode  = acquireVsCodeApi();
    const svg     = document.getElementById('pinout');
    const popup   = document.getElementById('popup');

    // ── Pin definitions (mirrored from TypeScript) ────────────────────────
    const PIN_DEFS = ${safeJson(PIN_DEFS)};

    // ── State ─────────────────────────────────────────────────────────────
    let wiredPins = JSON.parse(document.getElementById('init-data').textContent || '[]');
    let popupPin  = null;  // { pinNumber, adc } for unassigned; { pinNumber, id, deviceType } for assigned
    let selectedKind = null;

    // ── Build SVG pins ────────────────────────────────────────────────────
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

    // ── Apply wiredPins state to SVG ──────────────────────────────────────
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

    // ── Pin click handler ─────────────────────────────────────────────────
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

    // ── Popup helpers ─────────────────────────────────────────────────────
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
  </script>
</body>
</html>`;
}
