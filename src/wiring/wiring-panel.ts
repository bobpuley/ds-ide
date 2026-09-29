import { randomBytes } from 'node:crypto';
import { PIN_DEFS } from '../devices/pin-table.gen';
import type { PinDef } from '../devices/pin-table.gen';
import { REGISTRY, wiredControlIds, accentVar } from '../devices/registry';
import { resolveBusFootprint } from '../devices/attachment';
import { peripheralIds } from './peripheral-state';
import { candidateBusesFor } from './conflict-remedy';
import { escapeHtml } from '../webview/html-safe';
import { deviceIconSvg } from './device-icons';
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
// FR-UDM-9: re-places a wired control from `pinNumber`, keeping its id.
export type MoveControlHandler = (id: string, pinNumber: number, replace?: string[]) => Promise<void>;
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


// FR-DEV-2: one CSS rule per pin-attached registry entry, so adding a device
// changes what's generated here without editing this file again.
function pinDeviceCssRules(): string {
  return wiredControlIds()
    .map(id => {
      const d = REGISTRY[id]!;
      return `    .pin-${id}    circle { fill: ${d.pinFill}; stroke: ${accentVar(id)}; stroke-width: 2; }`;
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

// An icon tile (docs/mockups/v22-unified-device-model_alt1.html): device
// icon, uppercase name, requirement, and the registry accent as underline /
// hover border. `data-tip` feeds the editor tooltip on the collapsed rail.
function paletteChipHtml(id: string): string {
  const d = REGISTRY[id]!;
  const label = escapeHtml(d.label);
  const req = escapeHtml(paletteRequirement(id));
  // Only a peripheral is ever "placed" as a whole (one instance per type);
  // wiring-webview.ts toggles `.placed` from the live peripheral state.
  const badge = d.attachmentKind === 'bus' || d.attachmentKind === 'connector'
    ? '<span class="badge">✓</span>'
    : '';
  return `        <div class="device-chip" data-device="${escapeHtml(id)}" style="--accent: ${escapeHtml(accentVar(id))}" data-tip="${label} — ${req}">`
    + `${deviceIconSvg(id, accentVar(id))}<div class="name">${label}</div><div class="meta">${req}</div>${badge}</div><!-- /chip -->`;
}

// FR-UDM-5: one palette for all devices, generated from REGISTRY and grouped
// Controls / Peripherals, so a new registry entry appears with no edit here.
function devicePaletteHtml(): string {
  return `  <div id="palette-col">
    <div id="palette-head"><span class="pal-title">Devices</span><button id="palette-toggle" type="button" title="Collapse palette">◀</button></div>
    <div id="palette">
      <div class="pal-grp">Controls</div>
      <div class="pal-grid">
${wiredControlIds().map(paletteChipHtml).join('\n')}
      </div>
      <div class="pal-sep"></div>
      <div class="pal-grp">Peripherals · one each</div>
      <div class="pal-grid">
${peripheralIds().map(paletteChipHtml).join('\n')}
      </div>
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
    /* Device palette (FR-UDM-5) — icon tiles per docs/mockups/v22-unified-device-model_alt1.html;
       collapsible to a rail of small, still-draggable icons */
    #palette-col { width: 176px; flex-shrink: 0; overflow: auto; padding: 8px; border-right: 1px solid #3c3c3c; background: #1b1b1b; }
    #palette-head { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
    .pal-title { font-size: 11px; color: #9cdcfe; }
    #palette-toggle { margin-left: auto; background: #3c3c3c; border: 1px solid #555; color: #d4d4d4; width: 20px; height: 20px;
                      border-radius: 2px; cursor: pointer; font-family: monospace; font-size: 10px; line-height: 1; }
    #palette-toggle:hover { background: #4a4a4a; }
    .pal-grp { font-size: 9px; color: #6a6a6a; margin: 10px 0 6px; letter-spacing: 1px; text-transform: uppercase; }
    .pal-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .pal-sep { display: none; border-top: 1px solid #3c3c3c; margin: 8px 2px; }
    .device-chip { position: relative; display: flex; flex-direction: column; align-items: center; gap: 4px;
                   padding: 8px 4px 7px; border-radius: 8px; border: 1px solid transparent; background: rgba(255,255,255,.03);
                   cursor: grab; user-select: none; touch-action: none;
                   transition: background .15s, border-color .15s, transform .15s, box-shadow .15s; }
    .device-chip::after { content: ''; position: absolute; left: 22%; right: 22%; bottom: 2px; height: 2px; border-radius: 2px;
                          background: var(--accent); opacity: .75; }
    .device-chip:hover { background: #2a2d2e; border-color: var(--accent); transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,.35); }
    .device-chip:active { transform: translateY(0); }
    .device-chip.dragging { opacity: .35; }
    .device-chip svg.icon { width: 40px; height: 40px; filter: drop-shadow(0 2px 4px rgba(0,0,0,.3)); pointer-events: none; }
    .device-chip .name { font-size: 9px; color: #a0a0b0; letter-spacing: 1px; text-transform: uppercase; white-space: nowrap; }
    .device-chip:hover .name { color: #e0e0e0; }
    .device-chip .meta { font-size: 8px; color: #6a6a6a; text-align: center; line-height: 1.2; }
    .device-chip .badge { display: none; position: absolute; top: 3px; right: 5px; font-size: 10px; color: #4ec9b0; }
    .device-chip.placed { opacity: .5; }
    .device-chip.placed .badge { display: block; }
    #palette-col.collapsed { width: 44px; padding: 8px 4px; }
    #palette-col.collapsed .pal-title,
    #palette-col.collapsed .pal-grp,
    #palette-col.collapsed .device-chip .name,
    #palette-col.collapsed .device-chip .meta { display: none; }
    #palette-col.collapsed #palette-toggle { margin: 0 auto; }
    #palette-col.collapsed .pal-grid { grid-template-columns: 1fr; gap: 4px; }
    #palette-col.collapsed .pal-sep { display: block; }
    #palette-col.collapsed .device-chip { padding: 5px 0 6px; }
    #palette-col.collapsed .device-chip svg.icon { width: 28px; height: 28px; }
    #palette-col.collapsed .device-chip .badge { top: 0; right: 1px; font-size: 9px; }
    #ghost .lbl { display: flex; align-items: center; gap: 6px; }
    #ghost .lbl svg { width: 20px; height: 20px; }
    svg { max-width: 560px; width: 100%; }
    /* Pin dots — free pins are grey and inert (FR-UDM-10); only a placed
       device's pins react to the pointer (click: popover, drag: move). */
    .pin-dot:not(.pin-unassigned) { cursor: pointer; }
    .pin-dot:not(.pin-unassigned):hover circle { stroke: #4ec9b0; stroke-width: 2; }
    .pin-unassigned circle { fill: #3c3c3c; stroke: #555; stroke-width: 1; }
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
    /* Placement popover: Add / Replace / Move beside Cancel, equal width (FR-UDM-7). */
    #device-popover .dp-pair button { flex: 1 1 0; }
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
  </style>
</head>
<body>
  <h1>Daisy Seed Wiring Editor</h1>
  <div id="hint">Drag a device from the palette onto the board · Click a placed device to inspect it · Drag it to move it</div>
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
