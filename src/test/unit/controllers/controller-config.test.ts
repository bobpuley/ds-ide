import { describe, it, expect } from 'vitest';
import { parseControllerYaml } from '../../../controllers/controller-config';

const MINIMAL_VALID = `
controllers:
  - id: osc_pitch
    label: "Oscillator Pitch"
    adc_channel: 0
    range: [0, 1]
    taper: linear
    default: 0.5
`;

const TWO_POTS = `
controllers:
  - id: osc_pitch
    label: "Oscillator Pitch"
    adc_channel: 0
    range: [0, 1]
    taper: linear
    default: 0.5
  - id: filter_cutoff
    label: Filter Cutoff
    adc_channel: 1
    range: [0, 1]
    taper: log
    default: 0.3
`;

describe('parseControllerYaml', () => {
  describe('valid input', () => {
    it('parses a single controller', () => {
      const { defs, errors } = parseControllerYaml(MINIMAL_VALID);
      expect(errors).toHaveLength(0);
      expect(defs).toHaveLength(1);
      const d = defs[0]!;
      expect(d.id).toBe('osc_pitch');
      expect(d.label).toBe('Oscillator Pitch');
      expect(d.adcChannel).toBe(0);
      expect(d.range).toEqual([0, 1]);
      expect(d.taper).toBe('linear');
      expect(d.default).toBe(0.5);
    });

    it('parses two controllers', () => {
      const { defs, errors } = parseControllerYaml(TWO_POTS);
      expect(errors).toHaveLength(0);
      expect(defs).toHaveLength(2);
      expect(defs[0]!.id).toBe('osc_pitch');
      expect(defs[1]!.id).toBe('filter_cutoff');
      expect(defs[1]!.adcChannel).toBe(1);
      expect(defs[1]!.taper).toBe('log');
    });

    it('accepts unquoted label', () => {
      const { defs, errors } = parseControllerYaml(TWO_POTS);
      expect(errors).toHaveLength(0);
      expect(defs[1]!.label).toBe('Filter Cutoff');
    });

    it('accepts all valid tapers', () => {
      for (const taper of ['linear', 'log', 'antilog']) {
        const yaml = MINIMAL_VALID.replace('taper: linear', `taper: ${taper}`);
        const { defs, errors } = parseControllerYaml(yaml);
        expect(errors).toHaveLength(0);
        expect(defs[0]!.taper).toBe(taper);
      }
    });

    it('accepts default: 0 and default: 1 boundary values', () => {
      const yaml0 = MINIMAL_VALID.replace('default: 0.5', 'default: 0');
      const yaml1 = MINIMAL_VALID.replace('default: 0.5', 'default: 1');
      expect(parseControllerYaml(yaml0).errors).toHaveLength(0);
      expect(parseControllerYaml(yaml1).errors).toHaveLength(0);
    });

    it('accepts adc_channel 11 (highest valid)', () => {
      const yaml = MINIMAL_VALID.replace('adc_channel: 0', 'adc_channel: 11');
      const { defs, errors } = parseControllerYaml(yaml);
      expect(errors).toHaveLength(0);
      expect(defs[0]!.adcChannel).toBe(11);
    });

    it('returns empty defs with no errors for empty text', () => {
      const { defs, errors } = parseControllerYaml('');
      expect(errors).toHaveLength(0);
      expect(defs).toHaveLength(0);
    });

    it('returns empty defs with no errors when controllers: is absent', () => {
      const { defs, errors } = parseControllerYaml('# no controllers here\n');
      expect(errors).toHaveLength(0);
      expect(defs).toHaveLength(0);
    });

    it('ignores comment lines', () => {
      const yaml = `
controllers:
  # first pot
  - id: osc_pitch
    label: Pitch
    adc_channel: 0
    range: [0, 1]
    taper: linear
    default: 0.5
`;
      const { defs, errors } = parseControllerYaml(yaml);
      expect(errors).toHaveLength(0);
      expect(defs).toHaveLength(1);
    });
  });

  describe('duplicate detection (FR-CT-5)', () => {
    it('reports duplicate adc_channel', () => {
      const yaml = `
controllers:
  - id: pot_a
    label: A
    adc_channel: 0
    range: [0, 1]
    taper: linear
    default: 0.5
  - id: pot_b
    label: B
    adc_channel: 0
    range: [0, 1]
    taper: linear
    default: 0.3
`;
      const { defs, errors } = parseControllerYaml(yaml);
      expect(errors.some(e => e.includes('duplicate adc_channel'))).toBe(true);
      expect(defs).toHaveLength(1); // only first valid one included
    });

    it('reports duplicate id', () => {
      const yaml = `
controllers:
  - id: osc_pitch
    label: A
    adc_channel: 0
    range: [0, 1]
    taper: linear
    default: 0.5
  - id: osc_pitch
    label: B
    adc_channel: 1
    range: [0, 1]
    taper: linear
    default: 0.3
`;
      const { errors } = parseControllerYaml(yaml);
      expect(errors.some(e => e.includes("duplicate id"))).toBe(true);
    });
  });

  describe('field validation (FR-CT-5)', () => {
    it('reports missing id', () => {
      const yaml = MINIMAL_VALID.replace('id: osc_pitch\n', '');
      const { errors } = parseControllerYaml(yaml);
      expect(errors.some(e => e.includes("'id'"))).toBe(true);
    });

    it('reports missing label', () => {
      const yaml = MINIMAL_VALID.replace('label: "Oscillator Pitch"\n', '');
      const { errors } = parseControllerYaml(yaml);
      expect(errors.some(e => e.includes("'label'"))).toBe(true);
    });

    it('reports adc_channel out of range (> 11)', () => {
      const yaml = MINIMAL_VALID.replace('adc_channel: 0', 'adc_channel: 12');
      const { errors } = parseControllerYaml(yaml);
      expect(errors.some(e => e.includes("'adc_channel'"))).toBe(true);
    });

    it('reports adc_channel out of range (negative)', () => {
      const yaml = MINIMAL_VALID.replace('adc_channel: 0', 'adc_channel: -1');
      const { errors } = parseControllerYaml(yaml);
      expect(errors.some(e => e.includes("'adc_channel'"))).toBe(true);
    });

    it('reports invalid taper', () => {
      const yaml = MINIMAL_VALID.replace('taper: linear', 'taper: exponential');
      const { errors } = parseControllerYaml(yaml);
      expect(errors.some(e => e.includes("'taper'"))).toBe(true);
    });

    it('reports default out of range (> 1)', () => {
      const yaml = MINIMAL_VALID.replace('default: 0.5', 'default: 1.5');
      const { errors } = parseControllerYaml(yaml);
      expect(errors.some(e => e.includes("'default'"))).toBe(true);
    });

    it('reports default out of range (< 0)', () => {
      const yaml = MINIMAL_VALID.replace('default: 0.5', 'default: -0.1');
      const { errors } = parseControllerYaml(yaml);
      expect(errors.some(e => e.includes("'default'"))).toBe(true);
    });

    it('reports invalid range format', () => {
      const yaml = MINIMAL_VALID.replace('range: [0, 1]', 'range: 0');
      const { errors } = parseControllerYaml(yaml);
      expect(errors.some(e => e.includes("'range'"))).toBe(true);
    });

    it('invalid items are excluded from defs but valid ones are kept', () => {
      const yaml = `
controllers:
  - id: bad_one
    label: Bad
    adc_channel: 99
    range: [0, 1]
    taper: linear
    default: 0.5
  - id: good_one
    label: Good
    adc_channel: 3
    range: [0, 1]
    taper: linear
    default: 0.5
`;
      const { defs, errors } = parseControllerYaml(yaml);
      expect(errors.length).toBeGreaterThan(0);
      expect(defs).toHaveLength(1);
      expect(defs[0]!.id).toBe('good_one');
    });
  });
});
