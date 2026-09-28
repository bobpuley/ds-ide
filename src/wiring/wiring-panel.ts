import { randomBytes } from 'node:crypto';
import { PIN_DEFS } from '../devices/pin-table.gen';
import type { PinDef } from '../devices/pin-table.gen';
import { REGISTRY, wiredControlIds } from '../devices/registry';
import type { DeviceType } from '../devices/registry';
import type { ConventionControl } from '../controllers/controls-convention-parser';
import type { PeripheralDisplayState } from './peripheral-state';
import { safeJson } from '../webview/html-safe';

export type { DeviceType };
export type { PeripheralDisplayState };

export interface WiredPin {
  pinNumber: number;
  deviceType: DeviceType;
  id: string;
}

export type WirePinHandler   = (pin: WiredPin) => Promise<void>;
export type UnwirePinHandler = (pinNumber: number, id: string) => Promise<void>;
export type SetPeripheralEnabledHandler = (peripheralId: string, enabled: boolean) => Promise<void>;
// FR-DEV-15: opens or reveals a peripheral's live view (today: only oled has one).
export type ViewPeripheralHandler = (peripheralId: string) => void;
// FR-UDM-4: reveals a placed device's generated declaration in the effect source.
export type RevealInCodeHandler = (id: string) => Promise<void>;

// Expands parsed controls into one WiredPin per physical pin — a
// 'pins'-attachment device (rgbled, encoder — FR-DEV-8/9) occupies more than
// one, all sharing its id, so a single-pin `{pinNumber: c.pin, ...}` mapping
// silently drops its other pins. The single shared implementation here
// replaces three independent inline copies in extension.ts that drifted out
// of sync (one kept using the old single-pin form after the multi-pin
// devices landed, clobbering the Wiring Editor's display back down to one
// highlighted pin on the very next save).
export function expandToWiredPins(controls: ConventionControl[]): WiredPin[] {
  return controls.flatMap(c =>
    (c.pins ?? [c.pin]).map(p => ({ pinNumber: p, deviceType: c.kind as DeviceType, id: c.id })),
  );
}

// Daisy Seed pin definitions for the schematic SVG — generated from
// resources/Daisy_Seed_Rev4_Pinout.csv, see src/devices/pin-table.gen.ts.
export { PIN_DEFS };
export type { PinDef };

// ── HTML builder ─────────────────────────────────────────────────────────────


// FR-DEV-2: one CSS rule and one popup button per registry entry, so adding
// a device changes what's generated here without editing this file again.
function pinDeviceCssRules(): string {
  return wiredControlIds()
    .map(id => {
      const d = REGISTRY[id]!;
      return `    .pin-${id}    circle { fill: ${d.pinFill}; stroke: ${d.accentColor}; stroke-width: 2; }`;
    })
    .join('\n');
}

// FR-UDM-1: a device declaring `pinRequires` gets a hidden warning badge;
// wiring-webview.ts shows it when isPinEligible() says the clicked pin
// doesn't satisfy that requirement. No device id is special-cased here.
function popupDeviceButtonsHtml(): string {
  return wiredControlIds()
    .map(id => {
      const d = REGISTRY[id]!;
      const warnBadge = d.pinRequires
        ? `<span class="warn-badge" id="warn-${id}" style="display:none">⚠ non-${d.pinRequires.toUpperCase()} pin</span>`
        : '';
      return `      <button class="popup-btn" id="btn-${id}">${d.label}${warnBadge}</button>`;
    })
    .join('\n');
}

export function buildHtml(
  wiredPins: WiredPin[],
  peripherals: PeripheralDisplayState[],
  nonce: string,
  scriptUri: string,
): string {
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
${pinDeviceCssRules()}
    .pin-power  circle { fill: #2a2a2a; stroke: #444; stroke-width: 1; }
    /* A bus peripheral's occupied pins (FR-DEV-11/12). */
    .pin-bus circle { fill: #4a3a1a; stroke: #f4c430; stroke-width: 2; }
    /* Bus bracket and tooltip (FR-DEV-12) */
    .bus-grp { cursor: pointer; }
    .bus-bracket { stroke: #f4c430; stroke-width: 1.5; fill: none; }
    .bus-grp:hover .bus-bracket { stroke-width: 2.5; }
    .bus-bracket-label { font-size: 9px; fill: #f4c430; font-family: monospace; }
    .bracket-hit { fill: transparent; }
    #tooltip { position: fixed; display: none; background: #1e1e1e; border: 1px solid #666;
               border-radius: 3px; padding: 4px 8px; font-size: 11px; color: #d4d4d4;
               pointer-events: none; z-index: 400; white-space: nowrap; font-family: monospace; }
    /* One popover for every placed device (FR-UDM-3) */
    #device-popover { position: fixed; display: none; width: 260px; background: #252526; border: 1px solid #555;
                      border-radius: 4px; z-index: 300; box-shadow: 0 4px 16px rgba(0,0,0,.6); font-family: monospace; }
    #device-popover .dp-hdr { display: flex; align-items: center; gap: 8px; padding: 9px 12px; border-bottom: 1px solid #3c3c3c; }
    #device-popover .dp-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
    #device-popover .dp-title { font-size: 12px; color: #9cdcfe; }
    #device-popover .dp-sub { font-size: 9px; color: #6a6a6a; margin-left: auto; }
    #device-popover .dp-body { padding: 8px 12px; font-size: 10px; line-height: 2; }
    #device-popover .dp-row { display: flex; justify-content: space-between; gap: 8px; }
    #device-popover .dp-key { color: #6a6a6a; }
    #device-popover .dp-actions { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 12px 10px; border-top: 1px solid #3c3c3c; }
    #device-popover button { background: #3c3c3c; border: 1px solid #555; color: #d4d4d4; padding: 5px 9px; border-radius: 2px;
                             cursor: pointer; font-family: monospace; font-size: 11px; }
    #device-popover button:hover { background: #4a4a4a; }
    #device-popover button.dp-primary { background: #0e639c; border-color: #1177bb; color: #fff; flex-basis: 100%; }
    #device-popover button.dp-danger { background: #5a1a1a; border-color: #c94040; color: #f48771; }
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
    /* FR-DEV-17: highlighted when a connector-attached peripheral (midiUsb's
       INTERNAL mode) is enabled — the zero-pin equivalent of a bus
       peripheral's pin highlight, since there's no pin to mark instead. */
    #usb-port-group.active .usb-port { stroke: #569cd6; stroke-width: 2; }
    /* FR-UDM-3: clicking it opens that peripheral's device popover. */
    #usb-port-group.active { cursor: pointer; }
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
    /* Peripherals section (FR-DEV-11) */
    #peripherals { flex-shrink: 0; max-height: 160px; overflow: auto; border-top: 1px solid #3c3c3c; }
    .section-hdr { padding: 6px 14px; font-size: 11px; color: #9cdcfe; background: #252526;
                   border-bottom: 1px solid #3c3c3c; }
    .periph { display: flex; align-items: center; gap: 8px; padding: 6px 14px;
              border-bottom: 1px solid #2a2a2a; font-size: 11px; }
    .periph.off .periph-name { color: #6a6a6a; }
    .periph-pins { color: #f4c430; margin-left: auto; }
    .periph-view-btn { background: #0e639c; color: #fff; border: none; padding: 2px 8px;
                        font-family: monospace; font-size: 11px; cursor: pointer; border-radius: 2px; }
    .periph-view-btn:hover { background: #1177bb; }
  </style>
</head>
<body>
  <h1>Daisy Seed Wiring Editor</h1>
  <div id="hint">Click a free pin to assign a device · Click a placed device to inspect it</div>
  <div id="svg-wrap">
    <svg id="pinout" viewBox="0 0 560 600" xmlns="http://www.w3.org/2000/svg">
      <!-- Board body -->
      <rect class="board-body" x="190" y="20" width="180" height="560" rx="6"/>
      <text class="board-label" x="280" y="300">DAISY</text>
      <text class="board-label" x="280" y="316">SEED</text>
      <!-- Micro USB port at board top. Grouped with an id (FR-DEV-17) so a
           connector-attached peripheral in its zero-pin mode (midiUsb's
           INTERNAL) can highlight it the same way a bus peripheral highlights
           its resolved pins — a zero-pin footprint has nothing else on the
           board to draw a marker on. -->
      <g id="usb-port-group">
        <polygon class="usb-port" points="262,6 298,6 302,20 258,20"/>
        <polygon class="usb-inner" points="265,8 295,8 299,18 261,18"/>
      </g>
      <!-- Pins generated by JS -->
    </svg>
  </div>

  <!-- Peripherals section (FR-DEV-11) — populated by JS from peripherals-data -->
  <div id="peripherals">
    <div class="section-hdr">Peripherals</div>
    <div id="periph-list"></div>
  </div>

  <!-- Device-assignment popup -->
  <div id="popup">
    <h2 id="popup-title">Pin D?</h2>
    <!-- Unassigned view -->
    <div id="popup-assign">
${popupDeviceButtonsHtml()}
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
  </div>

  <!-- Bus bracket tooltip (FR-DEV-12) -->
  <div id="tooltip"></div>
  <!-- One popover for every placed device (FR-UDM-3) — filled by JS -->
  <div id="device-popover"></div>

  <script id="pin-defs" type="application/json" nonce="${nonce}">${safeJson(PIN_DEFS)}</script>
  <script id="init-data" type="application/json" nonce="${nonce}">${safeJson(wiredPins)}</script>
  <script id="peripherals-data" type="application/json" nonce="${nonce}">${safeJson(peripherals)}</script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
