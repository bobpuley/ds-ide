import { randomBytes } from 'node:crypto';
import { PIN_DEFS } from '../devices/pin-table.gen';
import type { PinDef } from '../devices/pin-table.gen';
import { REGISTRY, wiredControlIds } from '../devices/registry';
import type { DeviceType } from '../devices/registry';
import type { ConventionControl } from '../controllers/controls-convention-parser';
import type { PeripheralDisplayState } from './peripheral-state';

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

function safeJson(obj: unknown): string {
  return JSON.stringify(obj)
    .replace(/&/g, '\\u0026')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');
}

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

// The pot button carries an extra non-ADC-pin warning badge — pin-suitability
// warnings aren't part of the registry descriptor (only pot has one today),
// so this stays a small special case rather than a registry field.
function popupDeviceButtonsHtml(): string {
  return wiredControlIds()
    .map(id => {
      const d = REGISTRY[id]!;
      const warnBadge = id === 'pot'
        ? '<span class="warn-badge" id="pot-warn" style="display:none">⚠ non-ADC pin</span>'
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
    /* Bus bracket, tooltip and popover (FR-DEV-12) */
    .bus-grp { cursor: pointer; }
    .bus-bracket { stroke: #f4c430; stroke-width: 1.5; fill: none; }
    .bus-grp:hover .bus-bracket { stroke-width: 2.5; }
    .bus-bracket-label { font-size: 9px; fill: #f4c430; font-family: monospace; }
    .bracket-hit { fill: transparent; }
    #tooltip { position: fixed; display: none; background: #1e1e1e; border: 1px solid #666;
               border-radius: 3px; padding: 4px 8px; font-size: 11px; color: #d4d4d4;
               pointer-events: none; z-index: 400; white-space: nowrap; font-family: monospace; }
    #bus-popover { position: fixed; display: none; background: #252526; border: 1px solid #555;
                   border-radius: 4px; width: 220px; z-index: 300; box-shadow: 0 4px 16px rgba(0,0,0,.6);
                   font-family: monospace; }
    #bus-popover h3 { font-size: 12px; color: #9cdcfe; padding: 8px 10px; border-bottom: 1px solid #3c3c3c;
                      font-weight: normal; margin: 0; }
    #bus-popover table { width: 100%; border-collapse: collapse; }
    #bus-popover td { padding: 2px 10px; font-size: 11px; color: #d4d4d4; }
    .bus-popover-actions { display: flex; gap: 6px; padding: 8px 10px; }
    .bus-popover-actions button { flex: 1; background: #3c3c3c; border: 1px solid #555; color: #d4d4d4;
                                   padding: 5px; border-radius: 2px; cursor: pointer;
                                   font-family: monospace; font-size: 11px; }
    .bus-popover-disable { background: #5a1a1a !important; color: #f48771 !important; border-color: #c94040 !important; }
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
    /* Peripherals section (FR-DEV-11) */
    #peripherals { flex-shrink: 0; max-height: 160px; overflow: auto; border-top: 1px solid #3c3c3c; }
    .section-hdr { padding: 6px 14px; font-size: 11px; color: #9cdcfe; background: #252526;
                   border-bottom: 1px solid #3c3c3c; }
    .periph { display: flex; align-items: center; gap: 8px; padding: 6px 14px;
              border-bottom: 1px solid #2a2a2a; font-size: 11px; }
    .periph.off .periph-name { color: #6a6a6a; }
    .periph-pins { color: #f4c430; margin-left: auto; }
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
    <!-- Assigned view -->
    <div id="popup-assigned" style="display:none">
      <div class="assigned-info" id="assigned-info"></div>
      <div class="popup-actions">
        <button class="popup-remove" id="popup-remove">Remove</button>
        <button class="popup-cancel" id="popup-cancel-assigned">Cancel</button>
      </div>
    </div>
  </div>

  <!-- Bus bracket tooltip and popover (FR-DEV-12) -->
  <div id="tooltip"></div>
  <div id="bus-popover"></div>

  <script id="pin-defs" type="application/json" nonce="${nonce}">${safeJson(PIN_DEFS)}</script>
  <script id="init-data" type="application/json" nonce="${nonce}">${safeJson(wiredPins)}</script>
  <script id="peripherals-data" type="application/json" nonce="${nonce}">${safeJson(peripherals)}</script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
