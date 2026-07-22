// Pure source-text mutation for bus-attached peripherals (FR-DEV-11) —
// parallel to controls-writer.ts, but simplified for a singleton device with
// no id/pin: at most one declaration, at most one init block, enabled or
// not. Lives in its own marker block ("ds-ide:peripherals:*") entirely
// separate from controls-writer.ts's "ds-ide:controls:*" block, so
// controls-convention-parser.ts (which only scans between its own markers)
// never sees these lines.
import { REGISTRY } from '../devices/registry';
import { isPeripheralEnabled } from './peripheral-state';

const BEGIN = '// ds-ide:peripherals:begin';
const END = '// ds-ide:peripherals:end';
const INIT_BEGIN = '// ds-ide:peripherals:init:begin';
const INIT_END = '// ds-ide:peripherals:init:end';

function stripCr(line: string): string {
  return line.replace(/\r$/, '');
}

// Pure: inserts `id`'s declaration line into source text. No-op if the
// peripheral is already enabled (idempotent) or `id` has no peripheralCodegen.
// `bus` selects which declLine() variant to write for a multi-bus peripheral
// (FR-DEV-14, e.g. oled) — ignored by a single-bus peripheral's codegen.
export function insertPeripheralIntoSource(source: string, id: string, bus?: string): string {
  const codegen = REGISTRY[id]?.peripheralCodegen;
  if (!codegen || isPeripheralEnabled(source, id)) return source;

  const lines = source.split('\n');
  const begIdx = lines.findIndex(l => stripCr(l) === BEGIN);
  const endIdx = lines.findIndex(l => stripCr(l) === END);

  if (begIdx === -1 || endIdx === -1 || endIdx <= begIdx) {
    const trimmed = source.replace(/\n+$/, '');
    return `${trimmed}\n${BEGIN}\n${codegen.declLine(bus)}\n${END}\n`;
  }

  const result = [...lines];
  result.splice(endIdx, 0, codegen.declLine(bus));
  return result.join('\n');
}

// Pure: removes `id`'s declaration line(s). No-op if `id` has no peripheralCodegen.
export function removePeripheralFromSource(source: string, id: string): string {
  const codegen = REGISTRY[id]?.peripheralCodegen;
  if (!codegen) return source;
  return source.split('\n').filter(l => !codegen.isDeclLine(stripCr(l))).join('\n');
}

// Pure: inserts `id`'s init lines. No-op if already present (idempotent) or
// `id` has no peripheralCodegen.
export function insertPeripheralInitIntoSource(source: string, id: string): string {
  const codegen = REGISTRY[id]?.peripheralCodegen;
  if (!codegen) return source;

  const lines = source.split('\n');
  if (lines.some(l => codegen.isInitLine(stripCr(l)))) return source;

  const body = codegen.initLines();
  const initBegIdx = lines.findIndex(l => stripCr(l) === INIT_BEGIN);
  const initEndIdx = lines.findIndex(l => stripCr(l) === INIT_END);

  if (initBegIdx === -1 || initEndIdx === -1 || initEndIdx <= initBegIdx) {
    const endIdx = lines.findIndex(l => stripCr(l) === END);
    const blockLines = [INIT_BEGIN, ...body, INIT_END];
    const result = [...lines];
    if (endIdx !== -1) result.splice(endIdx + 1, 0, ...blockLines);
    else result.push(...blockLines);
    return result.join('\n');
  }

  const result = [...lines];
  result.splice(initEndIdx, 0, ...body);
  return result.join('\n');
}

// Pure: removes `id`'s init line(s). No-op if `id` has no peripheralCodegen.
export function removePeripheralInitFromSource(source: string, id: string): string {
  const codegen = REGISTRY[id]?.peripheralCodegen;
  if (!codegen) return source;
  return source.split('\n').filter(l => !codegen.isInitLine(stripCr(l))).join('\n');
}
