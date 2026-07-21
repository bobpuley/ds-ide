import { parseControlsConvention } from '../controllers/controls-convention-parser';
import { REGISTRY, DeviceType, registryIds } from '../devices/registry';
import type { CodegenInstance } from '../devices/codegen/types';
import { pinToAdcChannel } from '../devices/codegen/pot';

export type DeviceKind = DeviceType;

// Re-exported for existing callers/tests (FR-DEV-4: the mapping itself now
// lives in devices/codegen/pot.ts alongside pot's other codegen rules).
export { pinToAdcChannel };

const BEGIN = '// ds-ide:controls:begin';
const END   = '// ds-ide:controls:end';
const INIT_BEGIN = '// ds-ide:controls:init:begin';
const INIT_END   = '// ds-ide:controls:init:end';

// insertInitIntoSource/removeInitFromSource's public `allPots` parameter is
// pot-specific by API design (that's what every caller — extension.ts —
// actually has on hand); this constant is the one place that couples it to
// "whichever registry entry's shared codegen strategy interprets it." If a
// second shared-strategy device is ever added, its own instance list would
// need a parameter of its own — allPots isn't generic across kinds.
const SHARED_CODEGEN_KIND: DeviceKind = 'pot';

// Pots (or any future device with a `codegen` shared strategy) share one
// regenerated declaration/init instead of a per-instance one, so a pot's
// "declaration" is a marker comment only — it still carries id/kind/pin for
// parseControlsConvention and for insertFromSource/removeFromSource to find
// and edit it (FR-CODEGEN-1). A device with no declaredClassName in the
// registry gets the marker-comment form; every other device gets a named
// instance line.
// pins (FR-DEV-8) is present only for a 'pins'-attachment device (e.g.
// rgbled's r/g/b channels) — appended to the annotation comment so
// parseControlsConvention recovers the full pin list, not just the primary one.
export function declarationLine(id: string, kind: DeviceKind, pin: number, pins?: number[]): string {
  const suffix = pins ? `, pins=${pins.join(',')}` : '';
  const className = REGISTRY[kind]!.declaredClassName;
  if (className === null) {
    return `// ds-ide: id=${id}, kind=${kind}, pin=${pin}${suffix}`;
  }
  return `${className} ${id}; // ds-ide: id=${id}, kind=${kind}, pin=${pin}${suffix}`;
}

// Pure: insert declaration into source text. Returns modified text.
export function insertIntoSource(source: string, id: string, kind: DeviceKind, pin: number, pins?: number[]): string {
  const decl  = declarationLine(id, kind, pin, pins);
  const codegen = REGISTRY[kind]!.codegen;
  const lines  = source.split('\n');
  const endIdx = lines.findIndex(l => l.replace(/\r$/, '') === END);
  const begIdx = lines.findIndex(l => l.replace(/\r$/, '') === BEGIN);

  if (begIdx === -1 || endIdx === -1 || endIdx <= begIdx) {
    // Block absent — append to end of file
    const trimmed = source.replace(/\n+$/, '');
    const body = codegen ? [codegen.declLine([{ id, pin }]), decl] : [decl];
    return `${trimmed}\n${BEGIN}\n${body.join('\n')}\n${END}\n`;
  }

  const result = [...lines];

  if (codegen) {
    // Regenerate (or insert) the shared declaration line sized for the new
    // same-kind instance count — real libDaisy needs one contiguous array
    // for pot, not a separate AdcChannelConfig per instance (FR-CODEGEN-1).
    const { controls: existing } = parseControlsConvention(source);
    const sameKindInstances: CodegenInstance[] = existing
      .filter(c => c.kind === kind)
      .map(c => ({ id: c.id, pin: c.pin }));
    sameKindInstances.push({ id, pin });
    const declIdx = result.findIndex(
      (l, i) => i > begIdx && i < endIdx && codegen.isDeclLine(l.replace(/\r$/, '')),
    );
    const newDeclLine = codegen.declLine(sameKindInstances);
    if (declIdx === -1) {
      result.splice(begIdx + 1, 0, newDeclLine);
    } else {
      result[declIdx] = newDeclLine;
    }
  }

  const newEndIdx = result.findIndex(l => l.replace(/\r$/, '') === END);
  result.splice(newEndIdx, 0, decl);
  return result.join('\n');
}

// Pure: remove declaration with the given id. Returns modified text.
export function removeFromSource(source: string, id: string): string {
  const ANNOTATION = new RegExp(`// ds-ide:\\s*id=(\\S+),\\s*kind=(${registryIds().join('|')}),\\s*pin=(\\d+)`);
  const { controls: existing } = parseControlsConvention(source);
  const removedKinds = existing.filter(c => c.id === id).map(c => c.kind);

  const lines = source.split('\n').filter(line => {
    const m = ANNOTATION.exec(line);
    return !(m && m[1] === id);
  });

  for (const kind of removedKinds) {
    const codegen = REGISTRY[kind]?.codegen;
    if (!codegen) continue;
    const remainingInstances: CodegenInstance[] = existing
      .filter(c => c.kind === kind && c.id !== id)
      .map(c => ({ id: c.id, pin: c.pin }));
    const begIdx = lines.findIndex(l => l.replace(/\r$/, '') === BEGIN);
    const endIdx = lines.findIndex(l => l.replace(/\r$/, '') === END);
    const declIdx = lines.findIndex(
      (l, i) => begIdx !== -1 && endIdx !== -1 && i > begIdx && i < endIdx
        && codegen.isDeclLine(l.replace(/\r$/, '')),
    );
    if (declIdx !== -1) {
      if (remainingInstances.length > 0) lines[declIdx] = codegen.declLine(remainingInstances);
      else lines.splice(declIdx, 1);
    }
  }

  return lines.join('\n');
}

// ── Init block ────────────────────────────────────────────────────────────────

// A device whose Init() takes no second argument (initArgs: null, e.g.
// toggle's Switch3 — FR-DEV-7) emits a bare single-pin call rather than a
// trailing `, null`. A 'pins'-attachment device (e.g. rgbled — FR-DEV-8)
// ignores initArgs entirely and instead emits one daisy::seed::D<pin> per
// entry in `pins` — its Init() takes N pins directly, no extra arg.
function initLine(id: string, kind: DeviceKind, pin: number, pins?: number[]): string {
  if (REGISTRY[kind]!.attachmentKind === 'pins' && pins && pins.length > 0) {
    return `  ${id}.Init(${pins.map(p => `daisy::seed::D${p}`).join(', ')});`;
  }
  const args = REGISTRY[kind]!.initArgs;
  return args === null
    ? `  ${id}.Init(daisy::seed::D${pin});`
    : `  ${id}.Init(daisy::seed::D${pin}, ${args});`;
}

// Rebuild the init-block body: independent-device (non-shared) lines as
// given, followed by `kind`'s fully regenerated shared init lines (empty for
// a kind with no `codegen`). Shared lines are always regenerated in full
// (not patched) because removing/adding an instance can shift every other
// same-kind instance's array index.
function rebuildInitBody(
  nonSharedLines: string[],
  kind: DeviceKind,
  sameKindInstances: CodegenInstance[],
): string[] {
  const codegen = REGISTRY[kind]!.codegen;
  const body = [...nonSharedLines];
  if (codegen) body.push(...codegen.initLines(sameKindInstances));
  return body;
}

// Strip existing shared-strategy lines (e.g. pot's per-instance InitSingle
// and the aggregate adc.Init call) from a set of init-block lines, leaving
// only independent-device lines — shared lines are always regenerated fresh.
function nonSharedInitLines(lines: string[], kind: DeviceKind): string[] {
  const codegen = REGISTRY[kind]!.codegen;
  if (!codegen) return lines;
  return lines.filter(l => !codegen.isInitLine(l));
}

// Pure: insert init call into source text. allPots is the full list of pots
// (id, pin) after the new control was added (used to regenerate pot's
// shared init lines — the only shared-strategy kind today).
export function insertInitIntoSource(
  source: string,
  id: string,
  kind: DeviceKind,
  pin: number,
  allPots: Array<{ id: string; pin: number }>,
  pins?: number[],
): string {
  const hasCodegen = REGISTRY[kind]!.codegen !== undefined;
  const newNonSharedLine = hasCodegen ? null : initLine(id, kind, pin, pins);
  const lines = source.split('\n');

  const initBegIdx = lines.findIndex(l => l.replace(/\r$/, '') === INIT_BEGIN);
  const initEndIdx = lines.findIndex(l => l.replace(/\r$/, '') === INIT_END);

  if (initBegIdx === -1 || initEndIdx === -1 || initEndIdx <= initBegIdx) {
    // Init block absent — insert after END marker (or append)
    const endIdx = lines.findIndex(l => l.replace(/\r$/, '') === END);
    const nonShared = newNonSharedLine ? [newNonSharedLine] : [];
    const body = rebuildInitBody(nonShared, SHARED_CODEGEN_KIND, allPots);
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
  const nonShared = nonSharedInitLines(existing, SHARED_CODEGEN_KIND);
  if (newNonSharedLine) nonShared.push(newNonSharedLine);
  const body = rebuildInitBody(nonShared, SHARED_CODEGEN_KIND, allPots);

  const result = [...lines];
  result.splice(initBegIdx + 1, initEndIdx - initBegIdx - 1, ...body);
  return result.join('\n');
}

// Pure: remove init call for given id. allPots is the remaining pots (id,
// pin) after the control was removed (used to regenerate pot's shared init
// lines — the only shared-strategy kind today).
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

  const sharedCodegen = REGISTRY[SHARED_CODEGEN_KIND]!.codegen!;
  const remaining: string[] = [];
  for (let i = initBegIdx + 1; i < initEndIdx; i++) {
    const l = lines[i]!.replace(/\r$/, '');
    if (sharedCodegen.isInitLine(l)) continue;      // will be regenerated
    if (l.includes(`${id}.Init`)) continue;         // independent-device removal by id
    remaining.push(l);
  }
  const body = rebuildInitBody(remaining, SHARED_CODEGEN_KIND, allPots);

  const result = [...lines];
  result.splice(initBegIdx + 1, initEndIdx - initBegIdx - 1, ...body);
  return result.join('\n');
}
