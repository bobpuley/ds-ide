import { describe, it, expect, vi } from 'vitest';
import { loadScopeColors } from '../../../webview/scope-colors';

describe('loadScopeColors (FR-THM-2)', () => {
  it('maps each scope colour to its --ds-* token', () => {
    const read = vi.fn((name: string) => `<${name}>`);
    expect(loadScopeColors(read)).toEqual({
      background: '<--ds-surface>',
      grid: '<--ds-grid>',
      axis: '<--ds-axis>',
      traceIn: '<--ds-trace-in>',
      traceOut: '<--ds-trace-out>',
      traceOutR: '<--ds-trace-out-r>',
      running: '<--ds-ok>',
      stopped: '<--ds-error>',
    });
  });

  it('reads every token exactly once per load', () => {
    const read = vi.fn(() => '#000');
    loadScopeColors(read);
    expect(read).toHaveBeenCalledTimes(8);
  });
});
