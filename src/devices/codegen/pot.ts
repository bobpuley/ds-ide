// Pot's codegen strategy (FR-DEV-4) — extracted intact from
// wiring/controls-writer.ts, behavior unchanged (FR-CODEGEN-1: real
// libDaisy's AdcHandle::Init(AdcChannelConfig* cfg, size_t num_channels)
// takes a pointer to one contiguous array, not a list of separately-named
// configs, so every wired pot shares this single generated array).
import type { CodegenInstance, SharedCodegenStrategy } from './types';

const ADC_ARRAY_NAME = 'ds_ide_adc_cfg';
const ADC_ARRAY_DECL_RE = /^\s*AdcChannelConfig\s+ds_ide_adc_cfg\[\d+\]\s*;\s*$/;
const ADC_INIT_PREFIX = '  hardware.adc.Init(';
const ADC_ARRAY_INIT_RE = /^\s*ds_ide_adc_cfg\[\d+\]\.InitSingle\(/;

// ADC channel mapping: D15–D25 → A0–A10 (pin - 15), D28 → A11.
export function pinToAdcChannel(pin: number): number {
  if (pin >= 15 && pin <= 25) return pin - 15;
  if (pin === 28) return 11;
  return 0;
}

function declLine(instances: CodegenInstance[]): string {
  return `  AdcChannelConfig ${ADC_ARRAY_NAME}[${instances.length}];`;
}

// Per-pot InitSingle lines, indexed by position in `instances` (the array
// index each pot occupies in ds_ide_adc_cfg[] and the channel argument later
// code must pass to hardware.adc.GetFloat()) plus the single
// hardware.adc.Init(array, count) call — matches real libDaisy's documented
// pattern (FR-CODEGEN-1). Empty instances produce no lines at all (not even
// an empty Init call).
function initLines(instances: CodegenInstance[]): string[] {
  if (instances.length === 0) return [];
  const lines = instances.map(
    (p, i) => `  ${ADC_ARRAY_NAME}[${i}].InitSingle(daisy::seed::A${pinToAdcChannel(p.pin)});`,
  );
  lines.push(`${ADC_INIT_PREFIX}${ADC_ARRAY_NAME}, ${instances.length});`);
  return lines;
}

export const potCodegen: SharedCodegenStrategy = {
  declLine,
  isDeclLine: (line) => ADC_ARRAY_DECL_RE.test(line),
  initLines,
  isInitLine: (line) => line.startsWith(ADC_INIT_PREFIX) || ADC_ARRAY_INIT_RE.test(line),
};
