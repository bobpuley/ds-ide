import { describe, it, expect } from 'vitest';
import {
  parseMemoryRegionTable,
  extractOverflowError,
  hasOverflowIndicator,
} from '../../../diagnostics/memory-region-diagnostics';

const CLEAN_SRAM_BUILD = `
Memory region         Used Size  Region Size  %age Used
       FLASH:          0 GB       128 KB      0.00%
     DTCMRAM:        7440 B       128 KB      5.68%
        SRAM:       46000 B       512 KB      8.77%
  RAM_D2_DMA:         16 KB        32 KB     50.00%
      RAM_D2:          0 GB       256 KB      0.00%
      RAM_D3:          0 GB        64 KB      0.00%
     ITCMRAM:          0 GB        64 KB      0.00%
       SDRAM:          0 GB        64 MB      0.00%
   QSPIFLASH:          0 GB      7936 KB      0.00%
[100%] Built target effect
`;

const NEAR_LIMIT_BUILD = `
Memory region         Used Size  Region Size  %age Used
       FLASH:        100 KB       128 KB     78.13%
     DTCMRAM:        7440 B       128 KB      5.68%
`;

const SDRAM_USED_BUILD = `
Memory region         Used Size  Region Size  %age Used
       FLASH:          0 GB       128 KB      0.00%
       SDRAM:         10 MB        64 MB     15.63%
`;

const OVERFLOW_OUTPUT = `
arm-none-eabi-ld: effect.elf section \`.text' will not fit in region \`FLASH'
arm-none-eabi-ld: region \`FLASH' overflowed by 1234 bytes
collect2: error: ld returned 1 exit status
make: *** [build/effect.elf] Error 1
`;

const UNPARSEABLE_OVERFLOW_OUTPUT = `
arm-none-eabi-ld: some future binutils wording that mentions the region overflowed differently
make: *** [build/effect.elf] Error 1
`;

const UNRELATED_FAILURE_OUTPUT = `
/proj/effect.cpp:12:5: error: use of undeclared identifier 'hw'
make: *** [build/effect.o] Error 1
`;

describe('parseMemoryRegionTable', () => {
  it('parses a clean successful build\'s region table', () => {
    const regions = parseMemoryRegionTable(CLEAN_SRAM_BUILD);
    expect(regions).toEqual([
      { region: 'FLASH', usedBytes: 0, regionBytes: 128 * 1024, pctUsed: 0 },
      { region: 'DTCMRAM', usedBytes: 7440, regionBytes: 128 * 1024, pctUsed: 5.68 },
      { region: 'SRAM', usedBytes: 46000, regionBytes: 512 * 1024, pctUsed: 8.77 },
      { region: 'RAM_D2_DMA', usedBytes: 16 * 1024, regionBytes: 32 * 1024, pctUsed: 50 },
      { region: 'RAM_D2', usedBytes: 0, regionBytes: 256 * 1024, pctUsed: 0 },
      { region: 'RAM_D3', usedBytes: 0, regionBytes: 64 * 1024, pctUsed: 0 },
      { region: 'ITCMRAM', usedBytes: 0, regionBytes: 64 * 1024, pctUsed: 0 },
      { region: 'SDRAM', usedBytes: 0, regionBytes: 64 * 1024 * 1024, pctUsed: 0 },
      { region: 'QSPIFLASH', usedBytes: 0, regionBytes: 7936 * 1024, pctUsed: 0 },
    ]);
  });

  it('parses a region near its limit', () => {
    const regions = parseMemoryRegionTable(NEAR_LIMIT_BUILD);
    expect(regions.find((r) => r.region === 'FLASH')).toEqual({
      region: 'FLASH',
      usedBytes: 100 * 1024,
      regionBytes: 128 * 1024,
      pctUsed: 78.13,
    });
  });

  it('parses nonzero SDRAM usage', () => {
    const regions = parseMemoryRegionTable(SDRAM_USED_BUILD);
    expect(regions.find((r) => r.region === 'SDRAM')).toEqual({
      region: 'SDRAM',
      usedBytes: 10 * 1024 * 1024,
      regionBytes: 64 * 1024 * 1024,
      pctUsed: 15.63,
    });
  });

  it('returns an empty list for output with no region table', () => {
    expect(parseMemoryRegionTable(UNRELATED_FAILURE_OUTPUT)).toEqual([]);
    expect(parseMemoryRegionTable('')).toEqual([]);
  });

  it('ignores the table header line', () => {
    const regions = parseMemoryRegionTable(CLEAN_SRAM_BUILD);
    expect(regions.some((r) => r.region === 'region' || r.region === 'Memory')).toBe(false);
  });
});

describe('extractOverflowError', () => {
  it('extracts the overflowing region and byte count from a real ld overflow', () => {
    expect(extractOverflowError(OVERFLOW_OUTPUT)).toEqual({
      region: 'FLASH',
      overflowBytes: 1234,
    });
  });

  it('returns undefined when the precise overflow pattern is absent', () => {
    expect(extractOverflowError(UNPARSEABLE_OVERFLOW_OUTPUT)).toBeUndefined();
    expect(extractOverflowError(UNRELATED_FAILURE_OUTPUT)).toBeUndefined();
    expect(extractOverflowError('')).toBeUndefined();
  });
});

describe('hasOverflowIndicator', () => {
  it('is true when the precise pattern matches', () => {
    expect(hasOverflowIndicator(OVERFLOW_OUTPUT)).toBe(true);
  });

  it('is true for the looser "overflowed" substring even when the precise pattern does not match', () => {
    expect(hasOverflowIndicator(UNPARSEABLE_OVERFLOW_OUTPUT)).toBe(true);
  });

  it('is false when neither pattern nor substring is present', () => {
    expect(hasOverflowIndicator(UNRELATED_FAILURE_OUTPUT)).toBe(false);
    expect(hasOverflowIndicator('')).toBe(false);
  });
});
