import { randomBytes } from 'node:crypto';
import { PIN_DEFS } from '../devices/pin-table.gen';
import type { PinDef } from '../devices/pin-table.gen';
import { REGISTRY, registryIds } from '../devices/registry';
import type { DeviceType } from '../devices/registry';

export type { DeviceType };

export interface WiredPin {
  pinNumber: number;
  deviceType: DeviceType;
  id: string;
}

export type WirePinHandler   = (pin: WiredPin) => Promise<void>;
export type UnwirePinHandler = (pinNumber: number, id: string) => Promise<void>;

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
  return registryIds()
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
  return registryIds()
    .map(id => {
      const d = REGISTRY[id]!;
      const warnBadge = id === 'pot'
        ? '<span class="warn-badge" id="pot-warn" style="display:none">⚠ non-ADC pin</span>'
        : '';
      return `      <button class="popup-btn" id="btn-${id}">${d.label}${warnBadge}</button>`;
    })
    .join('\n');
}

export function buildHtml(wiredPins: WiredPin[], nonce: string, scriptUri: string): string {
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

  <script id="pin-defs" type="application/json" nonce="${nonce}">${safeJson(PIN_DEFS)}</script>
  <script id="init-data" type="application/json" nonce="${nonce}">${safeJson(wiredPins)}</script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
