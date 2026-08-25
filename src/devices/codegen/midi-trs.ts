// MIDI TRS's codegen strategy (FR-DEV-16) — a bus-attached, non-instanced
// peripheral like sdcard: enabled or not, at most one declaration and one
// Init call, never keyed by an id or pin. Fixed to USART1 (D13-D14, the
// canonical assignment attachment.ts's pin table already reserves for this)
// — no busChoices, since v14 scopes "or an alternative UART" down to the one
// UART the board actually wires this way (02_assumptions-and-risks.md).
import { makeSimplePeripheralCodegen } from './shared';

const HANDLE_NAME = 'ds_ide_midi_trs';

export const midiTrsCodegen = makeSimplePeripheralCodegen({
  declLine: `  MidiUartHandler ${HANDLE_NAME};`,
  initLinePrefixes: [`  ${HANDLE_NAME}.Init(`],
});
