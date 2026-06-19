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
}

const BEGIN_MARKER = /^\/\/ ds-ide:controls:begin\s*$/;
const END_MARKER = /^\/\/ ds-ide:controls:end\s*$/;
const ANNOTATION = /\/\/ ds-ide:\s*id=(\S+),\s*kind=(pot|button|led),\s*pin=(\d+)/;

export function parseControlsConvention(source: string): ConventionParseResult {
  const lines = source.split('\n');

  let beginLine = -1;
  let endLine = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.replace(/\r$/, '');
    if (BEGIN_MARKER.test(line)) beginLine = i;
    if (END_MARKER.test(line)) endLine = i;
  }

  if (beginLine === -1 || endLine === -1 || endLine <= beginLine) {
    return { controls: [], missingBlock: true, errors: [] };
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

  return { controls, missingBlock: false, errors };
}
