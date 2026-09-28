import { randomBytes } from 'node:crypto';
import { PIN_DEFS } from '../devices/pin-table.gen';
import type { PinDef } from '../devices/pin-table.gen';
import { REGISTRY, wiredControlIds } from '../devices/registry';
import { resolveBusFootprint } from '../devices/attachment';
import { peripheralIds } from './peripheral-state';
import { candidateBusesFor } from './conflict-remedy';
import { escapeHtml } from '../webview/html-safe';
import type { DeviceType } from '../devices/registry';
import type { PeripheralDisplayState } from './peripheral-state';
import { safeJson } from '../webview/html-safe';

export type { DeviceType };
export type { PeripheralDisplayState };

export interface WiredPin {
  pinNumber: number;
  deviceType: DeviceType;
  id: string;
}

export type WirePinHandler   = (pin: WiredPin, replace?: string[]) => Promise<void>;
export type UnwirePinHandler = (pinNumber: number, id: string) => Promise<void>;
export type SetPeripheralEnabledHandler = (
  peripheralId: string, enabled: boolean, bus?: string, replace?: string[],
) => Promise<void>;
// FR-DEV-15: opens or reveals a peripheral's live view (today: only oled has one).
export type ViewPeripheralHandler = (peripheralId: string) => void;
// FR-UDM-4: reveals a placed device's generated declaration in the effect source.
export type RevealInCodeHandler = (id: string) => Promise<void>;

// FR-UDM-6: lives in wired-pin-state.ts (pure, browser-safe) so
// drop-targets.ts can share it; re-exported here for existing importers.
export { expandToWiredPins } from './wired-pin-state';

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

// FR-UDM-5: the attachment requirement shown under a palette chip, derived
// from the registry alone — e.g. "ADC pin", "3 pins (R·G·B)", "SPI1 / I2C1".
// A zero-pin bus (midiUsb's INTERNAL) is the micro-USB connector.
export function paletteRequirement(id: string): string {
  const d = REGISTRY[id];
  if (!d) return '';
  if (d.attachmentKind === 'pin') return d.pinRequires ? `${d.pinRequires.toUpperCase()} pin` : 'any GPIO pin';
  if (d.attachmentKind === 'pins') {
    const slots = d.pinSlots ? ` (${d.pinSlots.join('·')})` : '';
    return `${d.pinCount ?? 1} pins${slots}`;
  }
  return candidateBusesFor(id)
    .map(bus => (resolveBusFootprint(bus).length === 0 ? 'USB port' : bus))
    .join(' / ');
}

function paletteChipHtml(id: string): string {
  const d = REGISTRY[id]!;
  const label = escapeHtml(d.label);
  const req = escapeHtml(paletteRequirement(id));
  // Only a peripheral is ever "placed" as a whole (one instance per type);
  // wiring-webview.ts toggles `.placed` from the live peripheral state.
  const badge = d.attachmentKind === 'bus' || d.attachmentKind === 'connector'
    ? '<div class="badge">✓ placed — drag to move</div>'
    : '';
  return `      <div class="device-chip" data-device="${escapeHtml(id)}" style="--accent: ${escapeHtml(d.accentColor)}" title="${label} — ${req}">`
    + `<span class="dot"></span><span class="chip-text"><span>${label}</span><div class="meta">${req}</div>${badge}</span>`
    + '<span class="grip">⠿</span></div>';
}

// FR-UDM-5: one palette for all devices, generated from REGISTRY and grouped
// Controls / Peripherals, so a new registry entry appears with no edit here.
function devicePaletteHtml(): string {
  return `  <div id="palette-col">
    <div id="palette-head"><span class="pal-title">Devices</span><button id="palette-toggle" type="button" title="Collapse palette">◀</button></div>
    <div id="palette">
      <div class="pal-grp">Controls</div>
${wiredControlIds().map(paletteChipHtml).join('\n')}
      <div class="pal-sep"></div>
      <div class="pal-grp">Peripherals</div>
${peripheralIds().map(paletteChipHtml).join('\n')}
    </div>
  </div><!-- /palette -->`;
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
    #main { flex: 1; display: flex; min-height: 0; }
    #svg-wrap { flex: 1; overflow: auto; padding: 16px; display: flex; justify-content: center; }
    /* Device palette (FR-UDM-5) — collapsible to a rail of draggable colour dots */
    #palette-col { width: 150px; flex-shrink: 0; overflow: auto; padding: 8px; border-right: 1px solid #3c3c3c; background: #1b1b1b; }
    #palette-head { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
    .pal-title { font-size: 11px; color: #9cdcfe; }
    #palette-toggle { margin-left: auto; background: #3c3c3c; border: 1px solid #555; color: #d4d4d4; width: 20px; height: 20px;
                      border-radius: 2px; cursor: pointer; font-family: monospace; font-size: 10px; line-height: 1; }
    #palette-toggle:hover { background: #4a4a4a; }
    .pal-grp { font-size: 9px; color: #6a6a6a; margin: 10px 0 5px; letter-spacing: .04em; text-transform: uppercase; }
    .pal-sep { display: none; border-top: 1px solid #3c3c3c; margin: 8px 2px; }
    .device-chip { display: flex; align-items: center; gap: 7px; background: #252526; border: 1px solid #555;
                   border-left: 4px solid var(--accent); border-radius: 3px; padding: 6px 8px; margin-bottom: 6px;
                   cursor: grab; font-size: 11px; user-select: none; touch-action: none; }
    .device-chip:hover { background: #2f2f2f; }
    .device-chip.dragging { opacity: .35; }
    .device-chip .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--accent); flex-shrink: 0; }
    .device-chip .meta { font-size: 8px; color: #6a6a6a; }
    .device-chip .badge { display: none; font-size: 8px; color: #4ec9b0; }
    .device-chip.placed { opacity: .6; }
    .device-chip.placed .badge { display: block; }
    .device-chip .grip { color: #555; font-size: 10px; margin-left: auto; }
    #palette-col.collapsed { width: 34px; padding: 8px 4px; }
    #palette-col.collapsed .pal-title,
    #palette-col.collapsed .pal-grp,
    #palette-col.collapsed .device-chip > :not(.dot) { display: none; }
    #palette-col.collapsed #palette-toggle { margin: 0 auto; }
    #palette-col.collapsed .pal-sep { display: block; }
    #palette-col.collapsed .device-chip { justify-content: center; padding: 8px 0; border-left-width: 1px; border-color: var(--accent); }
    #palette-col.collapsed .device-chip .dot { width: 12px; height: 12px; }
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
    #device-popover button:disabled { opacity: .4; cursor: default; }
    #device-popover input[type=text] { background: #3c3c3c; border: 1px solid #555; color: #d4d4d4; font-family: monospace;
                                       font-size: 11px; padding: 3px 6px; border-radius: 2px; width: 150px; }
    #device-popover .dp-conflict { background: #3a2a10; border: 1px solid #f4c430; color: #f4c430; padding: 6px 8px;
                                   border-radius: 3px; margin: 6px 0; font-size: 9.5px; line-height: 1.5; }
    #device-popover .dp-error { font-size: 10px; color: #f48771; min-height: 14px; line-height: 1.4; }
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
    /* Drag-time board states (FR-UDM-6): free targets pulse in the dragged
       device's accent (--accent on #pinout), occupied ones are amber-hatched,
       everything else dims. */
    svg * { transition: opacity .12s; }
    svg.dragging .bus-grp { display: none; }
    svg.dragging .ctx-ineligible { opacity: .18; }
    .ctx-free circle { stroke: var(--accent) !important; stroke-width: 2.5 !important; animation: dragPulse 1.3s ease-in-out infinite; }
    .ctx-occ circle { fill: url(#hatch) !important; stroke: #f4c430 !important; stroke-width: 2 !important; }
    .warn-mark { display: none; font-size: 9px; fill: #f4c430; pointer-events: none; }
    .ctx-occ .warn-mark { display: block; }
    .ctx-preview circle { stroke: var(--accent) !important; stroke-width: 3.5 !important; filter: drop-shadow(0 0 5px var(--accent)); animation: none; }
    .slot-no { display: none; font-size: 8px; fill: #fff; font-weight: bold; pointer-events: none; }
    .ctx-preview .slot-no { display: block; }
    .drop-lane { fill: var(--accent); fill-opacity: .06; stroke: var(--accent); stroke-width: 1.2; stroke-dasharray: 4 3; }
    .drop-lane.occ { stroke: #f4c430; fill: #f4c430; }
    .drop-lane.hot { fill-opacity: .18; stroke-width: 2; stroke-dasharray: none; }
    .drop-lane-lbl { font-size: 9px; fill: var(--accent); font-family: monospace; }
    .drop-lane-lbl.occ { fill: #f4c430; }
    #usb-port-group.ctx-free .usb-port { stroke: var(--accent); stroke-width: 2.5; animation: dragPulse 1.3s infinite; }
    #usb-port-group.ctx-occ .usb-port { stroke: #f4c430; stroke-width: 2.5; }
    #usb-port-group.ctx-preview .usb-port { stroke: var(--accent); stroke-width: 3.5; filter: drop-shadow(0 0 5px var(--accent)); }
    @keyframes dragPulse { 0%,100% { stroke-opacity: 1; } 50% { stroke-opacity: .35; } }
    body.drag-active, body.drag-active * { cursor: grabbing !important; }
    #ghost { position: fixed; pointer-events: none; z-index: 500; display: none; background: #252526;
             border: 1px solid var(--accent); border-left: 4px solid var(--accent); border-radius: 3px;
             padding: 5px 8px; font-size: 11px; box-shadow: 0 6px 18px rgba(0,0,0,.6); white-space: nowrap; }
    #ghost .tgt { font-size: 9px; color: #9a9a9a; margin-top: 2px; }
    #ghost.ok .tgt { color: #4ec9b0; } #ghost.warn .tgt { color: #f4c430; } #ghost.no .tgt { color: #f48771; }
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
  <div id="main">
${devicePaletteHtml()}
  <div id="svg-wrap">
    <svg id="pinout" viewBox="0 0 560 600" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="4" height="4" fill="#4a3a1a"/><rect width="2" height="4" fill="#6a4a10"/>
        </pattern>
      </defs>
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
      <!-- Drag-time bus drop lanes (FR-UDM-6), drawn under the pins -->
      <g id="lanes"></g>
      <!-- Pins generated by JS -->
    </svg>
  </div>
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

  <!-- Label that follows the cursor while dragging (FR-UDM-6) -->
  <div id="ghost"><div class="lbl"></div><div class="tgt"></div></div>
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
