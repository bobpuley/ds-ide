// MIDI USB's codegen strategy (FR-DEV-17). Unlike OLED (FR-DEV-14), real
// libDaisy has exactly one MidiUsbHandler class — INTERNAL vs EXTERNAL is a
// Config field (`transport_config.periph`), not a template parameter — so
// the declared type is mode-invariant and the mode selection lives in the
// init line(s) instead. `bus` here carries the mode string ('INTERNAL' /
// 'USB_HS_D', matching registry.ts's busChoices) rather than a bus name;
// busOfDeclLine reads it back from whichever init line is present in
// source — peripheral-state.ts's currentBusOf scans every line, not only
// decl lines, so this "read the selection back from source" works the same
// as OLED's despite living in a different line.
import type { PeripheralCodegenStrategy } from './types';
import { makeSimplePeripheralCodegen } from './shared';

const HANDLE_NAME = 'ds_ide_midi_usb';
const CFG_NAME = `${HANDLE_NAME}_cfg`;

const CFG_DECL_PREFIX = `  MidiUsbHandler::Config ${CFG_NAME};`;
const PERIPH_PREFIX = `  ${CFG_NAME}.transport_config.periph = MidiUsbTransport::Config::`;
const INIT_PREFIX = `  ${HANDLE_NAME}.Init(`;

const PERIPH_RE = new RegExp(`^\\s*${CFG_NAME}\\.transport_config\\.periph\\s*=\\s*MidiUsbTransport::Config::(INTERNAL|EXTERNAL)\\s*;\\s*$`);

// registry.ts's busChoices values ('INTERNAL' / 'USB_HS_D') double as
// resolveBusFootprint inputs (FR-DEV-17's simplification) — real libDaisy's
// enum value is 'EXTERNAL', not 'USB_HS_D', so this maps between the two.
const MODE_TO_PERIPH: Record<string, string> = { INTERNAL: 'INTERNAL', USB_HS_D: 'EXTERNAL' };
const PERIPH_TO_MODE: Record<string, string> = { INTERNAL: 'INTERNAL', EXTERNAL: 'USB_HS_D' };

const DEFAULT_MODE = 'INTERNAL';

// FR-EXT-31: unrecognized mode is structurally impossible (only registry.ts's
// own busChoices should ever reach here) — throws instead of silently
// falling back to DEFAULT_MODE, matching oled.ts's driverFor() contract.
function initLines(bus: string = DEFAULT_MODE): string[] {
  const periph = MODE_TO_PERIPH[bus];
  if (!periph) throw new Error(`midiUsbCodegen: unknown mode '${bus}'`);
  return [
    CFG_DECL_PREFIX,
    `${PERIPH_PREFIX}${periph};`,
    `${INIT_PREFIX}${CFG_NAME});`,
  ];
}

function busOfDeclLine(line: string): string | null {
  const m = PERIPH_RE.exec(line);
  if (!m) return null;
  return PERIPH_TO_MODE[m[1]!] ?? null;
}

// FR-EXT-37: declLine()/isDeclLine are mode-invariant (unlike initLines()),
// so this half is built directly on the shared simple-peripheral helper;
// initLines/isInitLine/busOfDeclLine are overridden below for USB MIDI's
// mode-dependent, three-line init shape.
const base = makeSimplePeripheralCodegen({
  declLine: `  MidiUsbHandler ${HANDLE_NAME};`,
  initLinePrefixes: [INIT_PREFIX],
});

export const midiUsbCodegen: PeripheralCodegenStrategy = {
  ...base,
  initLines,
  isInitLine: (line) => line.startsWith(CFG_DECL_PREFIX) || line.startsWith(PERIPH_PREFIX) || line.startsWith(INIT_PREFIX),
  busOfDeclLine,
};
