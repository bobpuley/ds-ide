import { describe, it, expect } from 'vitest';
import {
  potControlId,
  buttonControlId,
  toggleControlId,
  isValidControlId,
  narrowControlValue,
  narrowControlSnapshot,
} from '../../../ipc/control-values';

describe('potControlId / buttonControlId (FR-DEV-1)', () => {
  it('formats a pot channel as potN', () => {
    expect(potControlId(0)).toBe('pot0');
    expect(potControlId(11)).toBe('pot11');
  });

  it('formats a button gpio pin as btnN', () => {
    expect(buttonControlId(0)).toBe('btn0');
    expect(buttonControlId(28)).toBe('btn28');
  });

  it('formats a toggle gpio pin as tglN (FR-DEV-7)', () => {
    expect(toggleControlId(0)).toBe('tgl0');
    expect(toggleControlId(28)).toBe('tgl28');
  });
});

describe('isValidControlId', () => {
  it('accepts every valid pot id (0-11)', () => {
    for (let c = 0; c <= 11; c++) expect(isValidControlId(`pot${c}`)).toBe(true);
  });

  it('accepts every valid button id (0-63)', () => {
    for (const p of [0, 1, 28, 63]) expect(isValidControlId(`btn${p}`)).toBe(true);
  });

  it('rejects a pot id at/past the 12-channel bound', () => {
    expect(isValidControlId('pot12')).toBe(false);
  });

  it('rejects a button id at/past the 64-pin bound', () => {
    expect(isValidControlId('btn64')).toBe(false);
  });

  it('accepts every valid toggle id (0-63) and rejects at the bound (FR-DEV-7)', () => {
    for (const p of [0, 1, 28, 63]) expect(isValidControlId(`tgl${p}`)).toBe(true);
    expect(isValidControlId('tgl64')).toBe(false);
  });

  it('rejects an unrecognized prefix', () => {
    expect(isValidControlId('led3')).toBe(false);
  });

  it('rejects a bare prefix with no numeric suffix', () => {
    expect(isValidControlId('pot')).toBe(false);
  });

  it('rejects a non-numeric suffix', () => {
    expect(isValidControlId('potX')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidControlId('')).toBe(false);
  });

  it('rejects a negative-looking id (not matched by the digit pattern)', () => {
    expect(isValidControlId('pot-1')).toBe(false);
  });
});

describe('narrowControlValue', () => {
  it('accepts an in-range pot id with a finite value', () => {
    expect(narrowControlValue('pot3', 0.5)).toEqual({ id: 'pot3', value: 0.5 });
  });

  it('accepts an in-range button id with a finite value', () => {
    expect(narrowControlValue('btn28', 1)).toEqual({ id: 'btn28', value: 1 });
  });

  it('rejects an unknown id', () => {
    expect(narrowControlValue('pot12', 0.5)).toBeUndefined();
  });

  it('rejects a NaN value', () => {
    expect(narrowControlValue('pot0', NaN)).toBeUndefined();
  });

  it('rejects an Infinity value', () => {
    expect(narrowControlValue('pot0', Infinity)).toBeUndefined();
    expect(narrowControlValue('pot0', -Infinity)).toBeUndefined();
  });
});

describe('narrowControlSnapshot', () => {
  it('accepts a snapshot with only valid entries', () => {
    expect(narrowControlSnapshot({ pot0: 0.5, btn28: 1 })).toEqual({ pot0: 0.5, btn28: 1 });
  });

  it('rejects the whole snapshot if any single entry has an unknown id', () => {
    expect(narrowControlSnapshot({ pot0: 0.5, pot12: 0.1 })).toBeUndefined();
  });

  it('rejects the whole snapshot if any single entry has a non-finite value', () => {
    expect(narrowControlSnapshot({ pot0: 0.5, pot1: NaN })).toBeUndefined();
  });

  it('accepts an empty snapshot', () => {
    expect(narrowControlSnapshot({})).toEqual({});
  });
});
