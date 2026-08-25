import { describe, it, expect } from 'vitest';
import { defaultId, validateId } from '../../../wiring/id-validation';
import { WiredPin } from '../../../wiring/wiring-panel';

describe('defaultId (FR-IPC-6)', () => {
  it('returns kind1 when no pins of that kind are wired', () => {
    expect(defaultId('pot', [])).toBe('pot1');
  });

  it('skips ids already used by pins of the same kind', () => {
    const wired: WiredPin[] = [{ pinNumber: 15, deviceType: 'pot', id: 'pot1' }];
    expect(defaultId('pot', wired)).toBe('pot2');
  });

  it('does not skip ids used by a different kind', () => {
    const wired: WiredPin[] = [{ pinNumber: 15, deviceType: 'button', id: 'pot1' }];
    expect(defaultId('pot', wired)).toBe('pot1');
  });

  it('finds the first available gap, not just the count + 1', () => {
    const wired: WiredPin[] = [
      { pinNumber: 15, deviceType: 'pot', id: 'pot1' },
      { pinNumber: 16, deviceType: 'pot', id: 'pot3' },
    ];
    expect(defaultId('pot', wired)).toBe('pot2');
  });
});

describe('validateId (FR-IPC-6)', () => {
  it('rejects an empty string', () => {
    expect(validateId('', [])).toBe('id cannot be empty');
  });

  it('rejects a whitespace-only string', () => {
    expect(validateId('   ', [])).toBe('id cannot be empty');
  });

  it('accepts a well-formed unused id', () => {
    expect(validateId('vol1', [])).toBeNull();
  });

  it('rejects an id already used by another pin', () => {
    const wired: WiredPin[] = [{ pinNumber: 20, deviceType: 'pot', id: 'vol1' }];
    expect(validateId('vol1', wired)).toBe('id already used by pin 20');
  });

  it('trims surrounding whitespace before checking for a duplicate', () => {
    const wired: WiredPin[] = [{ pinNumber: 20, deviceType: 'pot', id: 'vol1' }];
    expect(validateId('  vol1  ', wired)).toBe('id already used by pin 20');
  });

  // FR-EXT-11: a free-text id is interpolated unescaped into generated C++
  // declaration/init lines (controls-writer.ts) — an id that isn't a valid
  // C++ identifier must never reach that far.
  it('rejects an id containing a statement injection payload', () => {
    expect(validateId('x; SystemInit(); //', [])).not.toBeNull();
  });

  it('rejects an id starting with a digit', () => {
    expect(validateId('1vol', [])).not.toBeNull();
  });

  it('rejects an id containing a space', () => {
    expect(validateId('my vol', [])).not.toBeNull();
  });

  it('rejects an id containing punctuation', () => {
    expect(validateId('vol.1', [])).not.toBeNull();
  });

  it('rejects a C++ reserved keyword', () => {
    expect(validateId('class', [])).not.toBeNull();
  });

  it('accepts an id with underscores and digits after the first character', () => {
    expect(validateId('my_vol_1', [])).toBeNull();
  });
});
