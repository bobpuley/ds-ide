// Input generator definitions for the Daisy Scope (FR-GEN-2). Pure — no DOM.
//
// The ids, labels, parameter ranges and hints are shared by the panel markup and the
// webview; the emulator's own clamping (input_generators.cpp) mirrors these ranges.

export type GeneratorId = 'sine' | 'noise' | 'sweep' | 'impulse' | 'step' | 'silence' | 'twotone';
export type NoiseColor = 'white' | 'pink';

/** Every generator parameter; each generator uses the subset listed in its definition. */
export interface GeneratorParams {
  freq: number;     // Hz, sine
  amp: number;      // 0–1
  color: NoiseColor;
  from: number;     // Hz, sweep start
  to: number;       // Hz, sweep end
  time: number;     // s, sweep duration
  period: number;   // ms, impulse / step
}

export type NumericParamKey = Exclude<keyof GeneratorParams, 'color'>;

export type ParamDef =
  | { readonly kind: 'number'; readonly key: NumericParamKey; readonly label: string; readonly min: number; readonly max: number; readonly step: number; readonly unit: string }
  | { readonly kind: 'choice'; readonly key: 'color'; readonly label: string; readonly options: readonly { value: NoiseColor; label: string }[] };

export interface GeneratorDef {
  readonly id: GeneratorId;
  readonly label: string;
  readonly params: readonly ParamDef[];
  readonly hint?: string;
}

export const GENERATOR_DEFAULTS: GeneratorParams = {
  freq: 440, amp: 0.25, color: 'white', from: 20, to: 20000, time: 5, period: 500,
};

const num = (key: NumericParamKey, label: string, min: number, max: number, step: number, unit = ''): ParamDef =>
  ({ kind: 'number', key, label, min, max, step, unit });

const FREQ = num('freq', 'Freq', 20, 20000, 1, 'Hz');
const AMP = num('amp', 'Amp', 0, 1, 0.01);
const PERIOD = num('period', 'Period', 10, 5000, 10, 'ms');
const COLOR: ParamDef = {
  kind: 'choice', key: 'color', label: 'Colour',
  options: [{ value: 'white', label: 'White' }, { value: 'pink', label: 'Pink' }],
};

export const GENERATORS: readonly GeneratorDef[] = [
  { id: 'sine', label: 'Sine', params: [FREQ, AMP] },
  { id: 'noise', label: 'Noise', params: [COLOR, AMP] },
  {
    id: 'sweep', label: 'Log sweep',
    params: [num('from', 'From', 20, 20000, 1, 'Hz'), num('to', 'To', 20, 20000, 1, 'Hz'), num('time', 'Time', 0.5, 60, 0.5, 's'), AMP],
  },
  { id: 'impulse', label: 'Impulse', params: [AMP, PERIOD], hint: 'One sample every period — shows the impulse response (tails, delay taps)' },
  { id: 'step', label: 'Step', params: [AMP, PERIOD], hint: 'Square wave, 0 and Amp — shows the step response (attack, release, settling)' },
  { id: 'silence', label: 'Silence', params: [], hint: 'Exact zero — shows the effect\'s own noise floor and any self-oscillation' },
  { id: 'twotone', label: 'Two-tone', params: [AMP], hint: '60 Hz + 7 kHz at 4:1 — reveals intermodulation distortion' },
];

export function generatorDef(id: GeneratorId): GeneratorDef {
  return GENERATORS.find(g => g.id === id)!;
}

export function isGeneratorId(v: unknown): v is GeneratorId {
  return typeof v === 'string' && GENERATORS.some(g => g.id === v);
}

function clampNum(v: number, min: number, max: number, fallback: number): number {
  if (Number.isNaN(v)) return fallback;
  return Math.max(min, Math.min(max, v));
}

/**
 * Clamp every parameter to its range. The sweep's To is kept strictly above From, so
 * From tops out just below 20 kHz.
 */
export function clampParams(p: GeneratorParams): GeneratorParams {
  const d = GENERATOR_DEFAULTS;
  const from = clampNum(p.from, 20, 19999, d.from);
  return {
    freq: clampNum(p.freq, 20, 20000, d.freq),
    amp: clampNum(p.amp, 0, 1, d.amp),
    color: p.color === 'pink' ? 'pink' : 'white',
    from,
    to: clampNum(p.to, from + 1, 20000, d.to),
    time: clampNum(p.time, 0.5, 60, d.time),
    period: clampNum(p.period, 10, 5000, d.period),
  };
}
