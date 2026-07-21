import { DeviceType, registryIds } from '../devices/registry';

export type ControlKind = DeviceType;

export interface ConventionControl {
  id: string;
  kind: ControlKind;
  /** Primary pin — the first entry of `pins` for a multi-pin device (FR-DEV-8), the only pin otherwise. */
  pin: number;
  /** Present only for a 'pins'-attachment device (e.g. rgbled's r/g/b channels); absent for a single-pin device. */
  pins?: number[];
}

export interface ConventionParseResult {
  controls: ConventionControl[];
  missingBlock: boolean;
  errors: string[];
  initLines: string[];
  missingInitBlock: boolean;
}

const BEGIN_MARKER = /^\/\/ ds-ide:controls:begin\s*$/;
const END_MARKER = /^\/\/ ds-ide:controls:end\s*$/;
const INIT_BEGIN_MARKER = /^\/\/ ds-ide:controls:init:begin\s*$/;
const INIT_END_MARKER = /^\/\/ ds-ide:controls:init:end\s*$/;
// Built fresh per call (not a module-level constant) so it always reflects
// the registry's current contents rather than a snapshot from module load
// (FR-DEV-2).
// FR-DEV-8: an optional trailing `, pins=p0,p1,p2` (a multi-pin device's full
// pin list, e.g. rgbled's r/g/b channels) alongside the always-present
// `pin=` (that device's primary/first pin — kept so every single-pin
// consumer of ConventionControl.pin needs no change).
function annotationPattern(): RegExp {
  return new RegExp(
    `// ds-ide:\\s*id=(\\S+),\\s*kind=(${registryIds().join('|')}),\\s*pin=(\\d+)(?:,\\s*pins=([\\d,]+))?`,
  );
}
// Shared AdcChannelConfig array declaration generated for wired pots
// (FR-CODEGEN-1, see wiring/controls-writer.ts) — infrastructure, not itself
// a control, so it must not be flagged as an unrecognised annotation.
const ADC_ARRAY_DECL = /^\s*AdcChannelConfig\s+ds_ide_adc_cfg\[\d+\]\s*;\s*$/;

export function parseControlsConvention(source: string): ConventionParseResult {
  const lines = source.split('\n');

  let beginLine = -1;
  let endLine = -1;
  let initBeginLine = -1;
  let initEndLine = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.replace(/\r$/, '');
    if (BEGIN_MARKER.test(line)) beginLine = i;
    if (END_MARKER.test(line)) endLine = i;
    if (INIT_BEGIN_MARKER.test(line)) initBeginLine = i;
    if (INIT_END_MARKER.test(line)) initEndLine = i;
  }

  const missingBlock = beginLine === -1 || endLine === -1 || endLine <= beginLine;
  const missingInitBlock = initBeginLine === -1 || initEndLine === -1 || initEndLine <= initBeginLine;

  if (missingBlock) {
    return { controls: [], missingBlock: true, errors: [], initLines: [], missingInitBlock };
  }

  const controls: ConventionControl[] = [];
  const errors: string[] = [];
  const annotation = annotationPattern();

  for (let i = beginLine + 1; i < endLine; i++) {
    const line = lines[i]!.replace(/\r$/, '');
    if (line.trim() === '' || BEGIN_MARKER.test(line)) continue;
    if (ADC_ARRAY_DECL.test(line)) continue;

    const m = annotation.exec(line);
    if (m) {
      const control: ConventionControl = { id: m[1]!, kind: m[2]! as ControlKind, pin: parseInt(m[3]!, 10) };
      if (m[4]) control.pins = m[4].split(',').map(p => parseInt(p, 10));
      controls.push(control);
    } else {
      errors.push(`unrecognised annotation on line ${i + 1}: ${line.trim()}`);
    }
  }

  const initLines: string[] = [];
  if (!missingInitBlock) {
    for (let i = initBeginLine + 1; i < initEndLine; i++) {
      initLines.push(lines[i]!.replace(/\r$/, ''));
    }
  }

  return { controls, missingBlock: false, errors, initLines, missingInitBlock };
}
