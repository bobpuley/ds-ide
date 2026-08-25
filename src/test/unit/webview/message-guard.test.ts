import { describe, it, expect, vi } from 'vitest';
import { hasKnownCommand, assertNever } from '../../../webview/message-guard';

const KNOWN = new Set(['status', 'ping']);

describe('hasKnownCommand (FR-EXT-22)', () => {
  it('accepts an object whose command is in the known set', () => {
    expect(hasKnownCommand({ command: 'status', running: true }, KNOWN)).toBe(true);
  });

  it('rejects an object whose command is not in the known set', () => {
    expect(hasKnownCommand({ command: 'evil' }, KNOWN)).toBe(false);
  });

  it('rejects a payload with no command field', () => {
    expect(hasKnownCommand({ running: true }, KNOWN)).toBe(false);
  });

  it('rejects a non-string command', () => {
    expect(hasKnownCommand({ command: 42 }, KNOWN)).toBe(false);
  });

  it('rejects null and undefined', () => {
    expect(hasKnownCommand(null, KNOWN)).toBe(false);
    expect(hasKnownCommand(undefined, KNOWN)).toBe(false);
  });

  it('rejects primitive payloads (string, number, array)', () => {
    expect(hasKnownCommand('status', KNOWN)).toBe(false);
    expect(hasKnownCommand(42, KNOWN)).toBe(false);
    expect(hasKnownCommand(['status'], KNOWN)).toBe(false);
  });
});

// FR-EXT-33: the exhaustiveness sentinel for a discriminated-union switch's
// default branch — logs rather than throws (see message-guard.ts's comment).
describe('assertNever (FR-EXT-33)', () => {
  it('logs the unreachable value instead of throwing', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => assertNever('unreachable' as never, 'test context')).not.toThrow();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('test context'), 'unreachable');
    spy.mockRestore();
  });
});
