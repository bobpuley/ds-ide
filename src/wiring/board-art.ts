// The Daisy Seed board drawing keeps fixed colours in every theme (FR-THM-4):
// it depicts hardware, not UI. The surrounding frame (#board-frame) is the
// themed part. Kept in its own module so the hardcoded-colour guard can
// allow-list exactly this art and nothing else in the Wiring Editor.
export const BOARD_ART_CSS = `    .board-body { fill: #252526; stroke: #555; stroke-width: 1; }
    .board-label { font-size: 11px; fill: #6a6a6a; font-family: monospace; text-anchor: middle; }
    .usb-port  { fill: #3a3a3a; stroke: #777; stroke-width: 1; }
    .usb-inner { fill: #252526; stroke: #555; stroke-width: 1; }`;
