// MIDI TRS's codegen strategy (FR-DEV-16) — a bus-attached, non-instanced
// peripheral like sdcard: enabled or not, at most one declaration and one
// Init call, never keyed by an id or pin. Fixed to USART1 (D13-D14, the
// canonical assignment attachment.ts's pin table already reserves for this)
// — no busChoices, since v14 scopes "or an alternative UART" down to the one
// UART the board actually wires this way (02_assumptions-and-risks.md).
import type { PeripheralCodegenStrategy } from './types';

const HANDLE_NAME = 'ds_ide_midi_trs';
const DECL_RE = new RegExp(`^\\s*MidiUartHandler\\s+${HANDLE_NAME}\\s*;\\s*$`);
const INIT_PREFIX = `  ${HANDLE_NAME}.Init(`;

function declLine(): string {
  return `  MidiUartHandler ${HANDLE_NAME};`;
}

function initLines(): string[] {
  return [`${INIT_PREFIX});`];
}

export const midiTrsCodegen: PeripheralCodegenStrategy = {
  declLine,
  isDeclLine: (line) => DECL_RE.test(line),
  initLines,
  isInitLine: (line) => line.startsWith(INIT_PREFIX),
};
