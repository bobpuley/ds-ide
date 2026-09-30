import { describe, it, expect } from 'vitest';
import { buildCsv } from '../../../webview/scope/scope-export';

describe('buildCsv (FR-SCI-12)', () => {
  it('writes a header, then one row per sample with the time in ms', () => {
    const csv = buildCsv(1000, [{ label: 'In', samples: [0.1, -0.2, 0.3] }]);
    expect(csv.split('\n')).toEqual(['time_ms,In', '0.0000,0.100000', '1.0000,-0.200000', '2.0000,0.300000', '']);
  });

  it('writes one column per channel, in order', () => {
    const csv = buildCsv(2000, [
      { label: 'In', samples: [1, 2] },
      { label: 'Out L', samples: [3, 4] },
      { label: 'Out R', samples: [5, 6] },
    ]);
    expect(csv.split('\n')).toEqual([
      'time_ms,In,Out L,Out R',
      '0.0000,1.000000,3.000000,5.000000',
      '0.5000,2.000000,4.000000,6.000000',
      '',
    ]);
  });

  it('writes a header only when there are no samples', () => {
    expect(buildCsv(1000, [{ label: 'In', samples: [] }])).toBe('time_ms,In\n');
    expect(buildCsv(1000, [])).toBe('time_ms\n');
  });

  it('runs to the longest channel and leaves a shorter one blank', () => {
    const csv = buildCsv(1000, [{ label: 'In', samples: [1, 2] }, { label: 'Out R', samples: [9] }]);
    expect(csv.split('\n')).toEqual(['time_ms,In,Out R', '0.0000,1.000000,9.000000', '1.0000,2.000000,', '']);
  });

  it('writes time as 0 while the sample rate is unknown', () => {
    expect(buildCsv(0, [{ label: 'In', samples: [1, 2] }]).split('\n')[2]).toBe('0.0000,2.000000');
  });

  it('quotes a label that would break the row', () => {
    expect(buildCsv(1000, [{ label: 'a,b', samples: [] }])).toBe('time_ms,"a,b"\n');
  });
});
