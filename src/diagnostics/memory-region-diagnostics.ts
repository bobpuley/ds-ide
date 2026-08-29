// Parses GNU ld's post-link memory-region usage summary, streamed by
// buildForHardware() (src/commands/hardware-build.ts) but historically
// discarded unparsed. Shape reference: daisy-seed-knowledge's
// _a7_Getting-Started-Daisy-Bootloader.md.
//
//   Memory region         Used Size  Region Size  %age Used
//          FLASH:          0 GB       128 KB      0.00%
//        DTCMRAM:        7440 B       128 KB      5.68%

export interface MemoryRegion {
  region: string;
  usedBytes: number;
  regionBytes: number;
  pctUsed: number;
}

export interface OverflowError {
  region: string;
  overflowBytes: number;
}

const UNIT_MULTIPLIERS: Record<string, number> = {
  B: 1,
  KB: 1024,
  MB: 1024 * 1024,
  GB: 1024 * 1024 * 1024,
};

const REGION_LINE_RE =
  /^\s*([A-Za-z0-9_]+):\s+([\d.]+)\s*(B|KB|MB|GB)\s+([\d.]+)\s*(B|KB|MB|GB)\s+([\d.]+)%\s*$/;

// GNU ld quotes region names as `NAME' (backtick + straight quote).
const OVERFLOW_RE = /region\s+[`']([A-Za-z0-9_]+)['`]\s+overflowed by\s+(\d+)\s+bytes/i;

function toBytes(value: string, unit: string): number {
  return Math.round(parseFloat(value) * (UNIT_MULTIPLIERS[unit] ?? 1));
}

export function parseMemoryRegionTable(output: string): MemoryRegion[] {
  const regions: MemoryRegion[] = [];
  for (const line of output.split('\n')) {
    const m = REGION_LINE_RE.exec(line);
    if (!m) continue;
    const [, region, usedVal, usedUnit, regionVal, regionUnit, pct] = m;
    regions.push({
      region: region!,
      usedBytes: toBytes(usedVal!, usedUnit!),
      regionBytes: toBytes(regionVal!, regionUnit!),
      pctUsed: parseFloat(pct!),
    });
  }
  return regions;
}

export function extractOverflowError(output: string): OverflowError | undefined {
  const m = OVERFLOW_RE.exec(output);
  if (!m) return undefined;
  return { region: m[1]!, overflowBytes: parseInt(m[2]!, 10) };
}

// Looser signal for build output that mentions an overflow but doesn't
// match OVERFLOW_RE's precise wording (e.g. a future binutils phrasing
// change) — lets the caller show a lower-confidence message instead of
// silently reverting to a fully generic failure message.
export function hasOverflowIndicator(output: string): boolean {
  return extractOverflowError(output) !== undefined || output.includes('overflowed');
}
