export type DeviceKind = 'pot' | 'button' | 'led';

const BEGIN = '// ds-ide:controls:begin';
const END   = '// ds-ide:controls:end';
const INIT_BEGIN = '// ds-ide:controls:init:begin';
const INIT_END   = '// ds-ide:controls:init:end';

const ADC_INIT_PREFIX = '  hardware.adc.Init(';

const TYPE_NAMES: Record<DeviceKind, string> = {
  pot:    'AdcChannelConfig',
  button: 'Switch',
  led:    'Led',
};

export function declarationLine(id: string, kind: DeviceKind, pin: number): string {
  return `${TYPE_NAMES[kind]} ${id}; // ds-ide: id=${id}, kind=${kind}, pin=${pin}`;
}

// Pure: insert declaration into source text. Returns modified text.
export function insertIntoSource(source: string, id: string, kind: DeviceKind, pin: number): string {
  const decl  = declarationLine(id, kind, pin);
  const lines  = source.split('\n');
  const endIdx = lines.findIndex(l => l.replace(/\r$/, '') === END);
  const begIdx = lines.findIndex(l => l.replace(/\r$/, '') === BEGIN);

  if (begIdx === -1 || endIdx === -1 || endIdx <= begIdx) {
    // Block absent — append to end of file
    const trimmed = source.replace(/\n+$/, '');
    return `${trimmed}\n${BEGIN}\n${decl}\n${END}\n`;
  }

  const result = [...lines];
  result.splice(endIdx, 0, decl);
  return result.join('\n');
}

// Pure: remove declaration with the given id. Returns modified text.
export function removeFromSource(source: string, id: string): string {
  const ANNOTATION = /\/\/ ds-ide:\s*id=(\S+),\s*kind=(pot|button|led),\s*pin=(\d+)/;
  return source
    .split('\n')
    .filter(line => {
      const m = ANNOTATION.exec(line);
      return !(m && m[1] === id);
    })
    .join('\n');
}

// ── Init block ────────────────────────────────────────────────────────────────

// Analog pin index: D15=A0, D16=A1, ..., D26=A11.
function analogIndex(pin: number): number {
  return pin - 15;
}

function initCallLine(id: string, kind: DeviceKind, pin: number): string {
  if (kind === 'pot') {
    return `  ${id}.InitSingle(daisy::seed::A${analogIndex(pin)});`;
  } else if (kind === 'button') {
    return `  ${id}.Init(daisy::seed::D${pin}, hardware.AudioCallbackRate());`;
  } else {
    return `  ${id}.Init(daisy::seed::D${pin}, false);`;
  }
}

function adcInitLine(pots: Array<{ id: string }>): string {
  const args = pots.map(p => p.id).join(', ');
  return `  hardware.adc.Init(${args}, ${pots.length});`;
}

// Rebuild the body lines for the init block given the current full set of
// init lines (excluding the adc.Init aggregate) and the current pots list.
function rebuildInitBody(
  nonAdcLines: string[],
  pots: Array<{ id: string }>,
): string[] {
  const body = [...nonAdcLines];
  if (pots.length > 0) body.push(adcInitLine(pots));
  return body;
}

// Pure: insert init call into source text. allPots is the full list of pots
// after the new control was added (used to regenerate hardware.adc.Init).
export function insertInitIntoSource(
  source: string,
  id: string,
  kind: DeviceKind,
  pin: number,
  allPots: Array<{ id: string }>,
): string {
  const newLine = initCallLine(id, kind, pin);
  const lines = source.split('\n');

  const initBegIdx = lines.findIndex(l => l.replace(/\r$/, '') === INIT_BEGIN);
  const initEndIdx = lines.findIndex(l => l.replace(/\r$/, '') === INIT_END);

  if (initBegIdx === -1 || initEndIdx === -1 || initEndIdx <= initBegIdx) {
    // Init block absent — insert after END marker (or append)
    const endIdx = lines.findIndex(l => l.replace(/\r$/, '') === END);
    const body = rebuildInitBody([newLine], allPots);
    const blockLines = [INIT_BEGIN, ...body, INIT_END];
    const result = [...lines];
    if (endIdx !== -1) {
      result.splice(endIdx + 1, 0, ...blockLines);
    } else {
      // No declaration block either — append at end
      const trimmedLen = result.join('\n').replace(/\n+$/, '').split('\n').length;
      result.splice(trimmedLen, 0, ...blockLines, '');
    }
    return result.join('\n');
  }

  // Init block present — collect existing non-adc lines, add new line, regenerate adc.Init
  const existing: string[] = [];
  for (let i = initBegIdx + 1; i < initEndIdx; i++) {
    const l = lines[i]!.replace(/\r$/, '');
    if (!l.startsWith(ADC_INIT_PREFIX)) existing.push(l);
  }
  existing.push(newLine);
  const body = rebuildInitBody(existing, allPots);

  const result = [...lines];
  result.splice(initBegIdx + 1, initEndIdx - initBegIdx - 1, ...body);
  return result.join('\n');
}

// Pure: remove init call for given id. allPots is the remaining pots after
// the control was removed (used to regenerate hardware.adc.Init).
export function removeInitFromSource(
  source: string,
  id: string,
  allPots: Array<{ id: string }>,
): string {
  const lines = source.split('\n');

  const initBegIdx = lines.findIndex(l => l.replace(/\r$/, '') === INIT_BEGIN);
  const initEndIdx = lines.findIndex(l => l.replace(/\r$/, '') === INIT_END);

  if (initBegIdx === -1 || initEndIdx === -1 || initEndIdx <= initBegIdx) {
    return source; // no init block — nothing to do
  }

  const remaining: string[] = [];
  for (let i = initBegIdx + 1; i < initEndIdx; i++) {
    const l = lines[i]!.replace(/\r$/, '');
    if (l.startsWith(ADC_INIT_PREFIX)) continue; // will be regenerated
    if (l.includes(`${id}.Init`) || l.includes(`${id}.InitSingle`)) continue;
    remaining.push(l);
  }
  const body = rebuildInitBody(remaining, allPots);

  const result = [...lines];
  result.splice(initBegIdx + 1, initEndIdx - initBegIdx - 1, ...body);
  return result.join('\n');
}
