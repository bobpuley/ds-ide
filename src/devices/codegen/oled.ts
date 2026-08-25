// OledDisplay's codegen strategy (FR-DEV-14) — the first bus-attached
// peripheral with more than one candidate bus. Unlike sdcard's bus-invariant
// declLine(), the declared C++ type is itself bus-specific: real libDaisy's
// OledDisplay is templated on a transport driver (SPI vs I2C), so switching
// bus changes what gets declared, not just what gets resolved on the board.
// The currently-selected bus is read back from source by inspecting which
// declLine() variant is present (busOfDeclLine) — the same "source text is
// the source of truth" convention every other peripheral/control state uses
// (peripheral-state.ts), rather than a separate workspaceState entry.
//
// Pixel primitives only (Fill/DrawPixel/Update) — no WriteString/font
// support. See 02_assumptions-and-risks.md (confirmed scope, 2026-07-22):
// real libDaisy's WriteString/SetCursor depend on font bitmap tables this
// project has no vendored copy of, and porting them is its own task.
import type { PeripheralCodegenStrategy } from './types';
import { makeSimplePeripheralCodegen } from './shared';

const OLED_NAME = 'ds_ide_oled';

// ⚠️ ASSUMPTION: 'SSD130x4WireSpi128x64Driver' is confirmed against the one
// real corpus example (daisy-seed-knowledge/examples/OLED/OLED.cpp). The I2C
// driver type name follows the same libDaisy naming convention but is NOT
// confirmed against a real libDaisy header — this project's corpus has no
// dev/oled_ssd130x.h to check against. Verify this name before a hardware
// build with I2C-mode OLED is attempted; it does not affect emulator
// behavior (the shim defines its own type regardless of which name is
// declared), only real-hardware compilation.
const DRIVER_BY_BUS: Record<string, string> = {
  SPI1: 'SSD130x4WireSpi128x64Driver',
  I2C1: 'SSD130xI2c128x64Driver',
};

const DEFAULT_BUS = 'SPI1';

// FR-EXT-31: unrecognized bus is structurally impossible (only registry.ts's
// own busChoices should ever reach here) — throws instead of silently
// falling back to DEFAULT_BUS, the shared codegen error contract every
// codegen/*.ts strategy now follows (see midi-usb.ts's initLines()).
function driverFor(bus: string): string {
  const driver = DRIVER_BY_BUS[bus];
  if (!driver) throw new Error(`oledCodegen: unknown bus '${bus}'`);
  return driver;
}

const DECL_RE = new RegExp(`^\\s*OledDisplay<(\\w+)>\\s+${OLED_NAME}\\s*;\\s*$`);
const INIT_PREFIX = `  ${OLED_NAME}.Init(`;

function declLine(bus: string = DEFAULT_BUS): string {
  return `  OledDisplay<${driverFor(bus)}> ${OLED_NAME};`;
}

function isDeclLine(line: string): boolean {
  return DECL_RE.test(line);
}

function busOfDeclLine(line: string): string | null {
  const m = DECL_RE.exec(line);
  if (!m) return null;
  const driver = m[1];
  const entry = Object.entries(DRIVER_BY_BUS).find(([, d]) => d === driver);
  return entry ? entry[0] : null;
}

// FR-EXT-37: initLines()/isInitLine are bus-invariant (unlike declLine()),
// so this half is built directly on the shared simple-peripheral helper;
// declLine/isDeclLine/busOfDeclLine are overridden below for OLED's
// bus-specific declared type.
const base = makeSimplePeripheralCodegen({
  declLine: `  OledDisplay<${DRIVER_BY_BUS[DEFAULT_BUS]}> ${OLED_NAME};`,
  initLinePrefixes: [INIT_PREFIX],
});

export const oledCodegen: PeripheralCodegenStrategy = {
  ...base,
  declLine,
  isDeclLine,
  busOfDeclLine,
};
