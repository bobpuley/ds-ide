export type ControlKind = 'pot' | 'button' | 'led';

export interface ConventionControl {
  id: string;
  kind: ControlKind;
  pin: number;
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
const ANNOTATION = /\/\/ ds-ide:\s*id=(\S+),\s*kind=(pot|button|led),\s*pin=(\d+)/;

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

  for (let i = beginLine + 1; i < endLine; i++) {
    const line = lines[i]!.replace(/\r$/, '');
    if (line.trim() === '' || BEGIN_MARKER.test(line)) continue;

    const m = ANNOTATION.exec(line);
    if (m) {
      controls.push({ id: m[1]!, kind: m[2]! as ControlKind, pin: parseInt(m[3]!, 10) });
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
