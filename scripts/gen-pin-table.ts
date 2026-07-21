// Generates src/devices/pin-table.gen.ts from resources/Daisy_Seed_Rev4_Pinout.csv.
// Run via `npm run gen:pins`. See src/devices/pin-table.gen.ts for the generated output.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CSV_PATH = join(__dirname, '..', 'resources', 'Daisy_Seed_Rev4_Pinout.csv');
const OUT_PATH = join(__dirname, '..', 'src', 'devices', 'pin-table.gen.ts');

interface CsvRow {
  rowNum: number;
  schName: string;
  arduinoD: string;
  arduinoA: string;
  i2c: string;
  uart: string;
  spi: string;
}

interface PinDefLiteral {
  row: number;
  side: 'L' | 'R';
  pin: number | null;
  label: string;
  aLabel: string | null;
  adc: boolean;
  i2c: string[] | null;
  uart: string[] | null;
  spi: string[] | null;
  sdmmc: string | null;
}

// Non-GPIO rows (power/audio/ground) don't carry an Arduino D-number, so their
// display label can't be derived from the CSV's numbering columns — it's read
// from the schematic name instead. This is the only hand-maintained mapping;
// every electrical assignment (pin number, ADC capability, bus signals) is
// derived directly from the CSV.
const SPECIAL_LABELS: Record<string, string> = {
  'AUDIO IN L': 'AIN L',
  'AUDIO INR': 'AIN R',
  'AUDIO OUT L': 'AOUT L',
  'AUDIO OUT R': 'AOUT R',
  AGND: 'AGND',
  GND: 'GND',
  VIN: 'VIN',
  '3v3D': '3V3D',
  '3v3A': '+3V3A',
};

function parseCsv(text: string): CsvRow[] {
  const lines = text.split(/\r?\n/).filter(l => l.length > 0);
  const rows: CsvRow[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(',');
    const rowNum = Number(cols[0]);
    if (!Number.isFinite(rowNum) || rowNum < 1 || rowNum > 40) continue;
    rows.push({
      rowNum,
      schName: (cols[1] ?? '').trim(),
      arduinoD: (cols[4] ?? '').trim(),
      arduinoA: (cols[5] ?? '').trim(),
      i2c: (cols[6] ?? '').trim(),
      uart: (cols[7] ?? '').trim(),
      spi: (cols[8] ?? '').trim(),
    });
  }
  return rows;
}

function splitSignals(cell: string): string[] | null {
  if (!cell) return null;
  const signals = cell.split('/').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  return signals.length > 0 ? signals : null;
}

function sdmmcSignal(schName: string): string | null {
  return /^SDMMC/.test(schName) ? schName : null;
}

function toPinDef(row: CsvRow, side: 'L' | 'R', outRow: number): PinDefLiteral {
  const dMatch = /^D(\d+)$/.exec(row.arduinoD);
  const pin = dMatch ? Number(dMatch[1]) : null;
  const aMatch = /^A\d+$/.exec(row.arduinoA);
  const aLabel = aMatch ? row.arduinoA : null;
  const label = pin !== null ? `D${pin}` : (SPECIAL_LABELS[row.schName] ?? row.schName);
  return {
    row: outRow,
    side,
    pin,
    label,
    aLabel,
    adc: aLabel !== null,
    i2c: splitSignals(row.i2c),
    uart: splitSignals(row.uart),
    spi: splitSignals(row.spi),
    sdmmc: sdmmcSignal(row.schName),
  };
}

function renderEntry(d: PinDefLiteral): string {
  const pin = d.pin === null ? 'null' : String(d.pin);
  const aLabel = d.aLabel === null ? 'null' : JSON.stringify(d.aLabel);
  const i2c = d.i2c === null ? 'null' : JSON.stringify(d.i2c);
  const uart = d.uart === null ? 'null' : JSON.stringify(d.uart);
  const spi = d.spi === null ? 'null' : JSON.stringify(d.spi);
  const sdmmc = d.sdmmc === null ? 'null' : JSON.stringify(d.sdmmc);
  return `  { row: ${d.row}, side: '${d.side}', pin: ${pin}, label: ${JSON.stringify(d.label)}, aLabel: ${aLabel}, adc: ${d.adc}, i2c: ${i2c}, uart: ${uart}, spi: ${spi}, sdmmc: ${sdmmc} },`;
}

function renderModule(pinDefs: PinDefLiteral[]): string {
  const header = [
    '// GENERATED FILE — DO NOT EDIT BY HAND.',
    '// Produced by `npm run gen:pins` (scripts/gen-pin-table.ts) from',
    '// resources/Daisy_Seed_Rev4_Pinout.csv. Regenerate after the CSV changes;',
    '// hand edits will be overwritten on the next build.',
    '',
    '// side: \'L\' = left header, \'R\' = right header.',
    '// pin: D-number for digital GPIO pins; null for power/special (not assignable).',
    '// adc: true when the CSV\'s Arduino A# column is populated for this pin.',
    '// i2c/uart/spi: signal names from the CSV\'s matching column, split on \'/\'.',
    '// sdmmc: the SDMMC signal name when the CSV schematic name identifies one.',
    '',
  ].join('\n');
  const iface = [
    'export interface PinDef {',
    '  row: number;',
    "  side: 'L' | 'R';",
    '  pin: number | null;',
    '  label: string;',
    '  aLabel: string | null;',
    '  adc: boolean;',
    '  i2c: string[] | null;',
    '  uart: string[] | null;',
    '  spi: string[] | null;',
    '  sdmmc: string | null;',
    '}',
    '',
    '',
  ].join('\n');
  const body = `export const PIN_DEFS: PinDef[] = [\n${pinDefs.map(renderEntry).join('\n')}\n];\n`;
  return header + iface + body;
}

function main(): void {
  const csvText = readFileSync(CSV_PATH, 'utf8');
  const rows = parseCsv(csvText);
  const byNum = new Map(rows.map(r => [r.rowNum, r]));

  const pinDefs: PinDefLiteral[] = [];
  // Left header: CSV rows 1-20 in order (D0-D14, then audio/AGND).
  for (let n = 1; n <= 20; n++) {
    const row = byNum.get(n);
    if (!row) throw new Error(`gen-pin-table: missing CSV row ${n}`);
    pinDefs.push(toPinDef(row, 'L', n - 1));
  }
  // Right header: CSV rows 40 down to 21 (GND, VIN, 3V3D, D30 ... D15, +3V3A).
  for (let n = 40; n >= 21; n--) {
    const row = byNum.get(n);
    if (!row) throw new Error(`gen-pin-table: missing CSV row ${n}`);
    pinDefs.push(toPinDef(row, 'R', 40 - n));
  }

  writeFileSync(OUT_PATH, renderModule(pinDefs), 'utf8');
  console.log(`gen-pin-table: wrote ${pinDefs.length} pin defs to ${OUT_PATH}`);
}

if (require.main === module) {
  main();
}
