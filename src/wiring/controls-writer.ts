import { parseControlsConvention } from '../controllers/controls-convention-parser';

export type DeviceKind = 'pot' | 'button' | 'led';

const BEGIN = '// ds-ide:controls:begin';
const END   = '// ds-ide:controls:end';
const INIT_BEGIN = '// ds-ide:controls:init:begin';
const INIT_END   = '// ds-ide:controls:init:end';

const ADC_INIT_PREFIX = '  hardware.adc.Init(';

// Real libDaisy's AdcHandle::Init(AdcChannelConfig* cfg, size_t num_channels)
// takes a pointer to one contiguous array, not a list of separately-named
// configs (FR-CODEGEN-1). All wired pots share this single generated array;
// pinToAdcChannel(pin) still gives InitSingle's *pin* argument, but the
// channel each pot occupies in the array is its position in `allPots`, which
// is also the argument later code must pass to hardware.adc.GetFloat().
const ADC_ARRAY_NAME = 'ds_ide_adc_cfg';
const ADC_ARRAY_DECL_RE = /^\s*AdcChannelConfig\s+ds_ide_adc_cfg\[\d+\]\s*;\s*$/;
const ADC_ARRAY_INIT_RE = /^\s*ds_ide_adc_cfg\[\d+\]\.InitSingle\(/;

const TYPE_NAMES: Record<Exclude<DeviceKind, 'pot'>, string> = {
  button: 'Switch',
  led:    'Led',
};

function adcArrayDeclLine(count: number): string {
  return `  AdcChannelConfig ${ADC_ARRAY_NAME}[${count}];`;
}

// Pots share one regenerated array declaration (see adcArrayDeclLine) instead
// of a per-pot named variable, so a pot's "declaration" is a marker comment
// only — it still carries id/kind/pin for parseControlsConvention and for
// insertFromSource/removeFromSource to find and edit it (FR-CODEGEN-1).
export function declarationLine(id: string, kind: DeviceKind, pin: number): string {
  if (kind === 'pot') {
    return `// ds-ide: id=${id}, kind=${kind}, pin=${pin}`;
  }
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
    const body = kind === 'pot' ? [adcArrayDeclLine(1), decl] : [decl];
    return `${trimmed}\n${BEGIN}\n${body.join('\n')}\n${END}\n`;
  }

  const result = [...lines];

  if (kind === 'pot') {
    // Regenerate (or insert) the shared array declaration sized for the new
    // pot count — real libDaisy needs one contiguous array, not a separate
    // AdcChannelConfig per pot (FR-CODEGEN-1).
    const { controls: existing } = parseControlsConvention(source);
    const newPotCount = existing.filter(c => c.kind === 'pot').length + 1;
    const arrayIdx = result.findIndex(
      (l, i) => i > begIdx && i < endIdx && ADC_ARRAY_DECL_RE.test(l.replace(/\r$/, '')),
    );
    if (arrayIdx === -1) {
      result.splice(begIdx + 1, 0, adcArrayDeclLine(newPotCount));
    } else {
      result[arrayIdx] = adcArrayDeclLine(newPotCount);
    }
  }

  const newEndIdx = result.findIndex(l => l.replace(/\r$/, '') === END);
  result.splice(newEndIdx, 0, decl);
  return result.join('\n');
}

// Pure: remove declaration with the given id. Returns modified text.
export function removeFromSource(source: string, id: string): string {
  const ANNOTATION = /\/\/ ds-ide:\s*id=(\S+),\s*kind=(pot|button|led),\s*pin=(\d+)/;
  const { controls: existing } = parseControlsConvention(source);
  const removedKinds = existing.filter(c => c.id === id).map(c => c.kind);

  const lines = source.split('\n').filter(line => {
    const m = ANNOTATION.exec(line);
    return !(m && m[1] === id);
  });

  if (removedKinds.includes('pot')) {
    const newPotCount = existing.filter(c => c.kind === 'pot' && c.id !== id).length;
    const begIdx = lines.findIndex(l => l.replace(/\r$/, '') === BEGIN);
    const endIdx = lines.findIndex(l => l.replace(/\r$/, '') === END);
    const arrayIdx = lines.findIndex(
      (l, i) => begIdx !== -1 && endIdx !== -1 && i > begIdx && i < endIdx
        && ADC_ARRAY_DECL_RE.test(l.replace(/\r$/, '')),
    );
    if (arrayIdx !== -1) {
      if (newPotCount > 0) lines[arrayIdx] = adcArrayDeclLine(newPotCount);
      else lines.splice(arrayIdx, 1);
    }
  }

  return lines.join('\n');
}

// ── Init block ────────────────────────────────────────────────────────────────

// ADC channel mapping: D15–D25 → A0–A10 (pin - 15), D28 → A11.
export function pinToAdcChannel(pin: number): number {
  if (pin >= 15 && pin <= 25) return pin - 15;
  if (pin === 28) return 11;
  return 0;
}

function initCallLine(id: string, kind: Exclude<DeviceKind, 'pot'>, pin: number): string {
  if (kind === 'button') {
    return `  ${id}.Init(daisy::seed::D${pin}, hardware.AudioCallbackRate());`;
  }
  return `  ${id}.Init(daisy::seed::D${pin}, false);`;
}

// Per-pot InitSingle lines, indexed by position in `pots` (the array index
// each pot occupies in ds_ide_adc_cfg[] and the channel argument later code
// must pass to hardware.adc.GetFloat()) — matches real libDaisy's documented
// pattern (FR-CODEGEN-1).
function potInitLines(pots: Array<{ pin: number }>): string[] {
  return pots.map((p, i) => `  ${ADC_ARRAY_NAME}[${i}].InitSingle(daisy::seed::A${pinToAdcChannel(p.pin)});`);
}

function adcInitLine(count: number): string {
  return `${ADC_INIT_PREFIX}${ADC_ARRAY_NAME}, ${count});`;
}

// Rebuild the init-block body: non-pot (button/led) lines as given, followed
// by the fully regenerated pot InitSingle lines and the single
// hardware.adc.Init(array, count) call. Pot lines are always regenerated in
// full (not patched) because removing/adding a pot can shift every other
// pot's array index.
function rebuildInitBody(
  nonPotLines: string[],
  pots: Array<{ pin: number }>,
): string[] {
  const body = [...nonPotLines];
  if (pots.length > 0) {
    body.push(...potInitLines(pots));
    body.push(adcInitLine(pots.length));
  }
  return body;
}

// Strip existing pot-related lines (per-pot InitSingle and the aggregate
// adc.Init call) from a set of init-block lines, leaving only button/led
// lines — the pot lines are always regenerated fresh from allPots.
function nonPotInitLines(lines: string[]): string[] {
  return lines.filter(l => !l.startsWith(ADC_INIT_PREFIX) && !ADC_ARRAY_INIT_RE.test(l));
}

// Pure: insert init call into source text. allPots is the full list of pots
// (id, pin) after the new control was added (used to regenerate the pot
// InitSingle lines and hardware.adc.Init).
export function insertInitIntoSource(
  source: string,
  id: string,
  kind: DeviceKind,
  pin: number,
  allPots: Array<{ id: string; pin: number }>,
): string {
  const newNonPotLine = kind === 'pot' ? null : initCallLine(id, kind, pin);
  const lines = source.split('\n');

  const initBegIdx = lines.findIndex(l => l.replace(/\r$/, '') === INIT_BEGIN);
  const initEndIdx = lines.findIndex(l => l.replace(/\r$/, '') === INIT_END);

  if (initBegIdx === -1 || initEndIdx === -1 || initEndIdx <= initBegIdx) {
    // Init block absent — insert after END marker (or append)
    const endIdx = lines.findIndex(l => l.replace(/\r$/, '') === END);
    const nonPot = newNonPotLine ? [newNonPotLine] : [];
    const body = rebuildInitBody(nonPot, allPots);
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

  // Init block present — collect existing non-pot lines, add new one, regenerate pot lines
  const existing: string[] = [];
  for (let i = initBegIdx + 1; i < initEndIdx; i++) {
    existing.push(lines[i]!.replace(/\r$/, ''));
  }
  const nonPot = nonPotInitLines(existing);
  if (newNonPotLine) nonPot.push(newNonPotLine);
  const body = rebuildInitBody(nonPot, allPots);

  const result = [...lines];
  result.splice(initBegIdx + 1, initEndIdx - initBegIdx - 1, ...body);
  return result.join('\n');
}

// Pure: remove init call for given id. allPots is the remaining pots (id,
// pin) after the control was removed (used to regenerate the pot InitSingle
// lines and hardware.adc.Init).
export function removeInitFromSource(
  source: string,
  id: string,
  allPots: Array<{ id: string; pin: number }>,
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
    if (l.startsWith(ADC_INIT_PREFIX)) continue;  // will be regenerated
    if (ADC_ARRAY_INIT_RE.test(l)) continue;       // will be regenerated
    if (l.includes(`${id}.Init`)) continue;        // button/led removal by id
    remaining.push(l);
  }
  const body = rebuildInitBody(remaining, allPots);

  const result = [...lines];
  result.splice(initBegIdx + 1, initEndIdx - initBegIdx - 1, ...body);
  return result.join('\n');
}
