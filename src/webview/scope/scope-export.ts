// CSV export of the scope's visible samples (FR-SCI-12). Pure — no DOM.

export interface ExportChannel {
  label: string;
  samples: readonly number[];
}

function cell(text: string): string {
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * CSV text: a header row, then one row per sample with the time in ms and one
 * column per channel. `rate` is the effective sample rate of the samples; while it
 * is unknown (0) every time is written as 0.
 */
export function buildCsv(rate: number, channels: readonly ExportChannel[]): string {
  const lines = [['time_ms', ...channels.map(c => c.label)].map(cell).join(',')];
  const rows = Math.max(0, ...channels.map(c => c.samples.length));
  for (let i = 0; i < rows; i++) {
    const timeMs = rate > 0 ? (i / rate) * 1000 : 0;
    const values = channels.map(c => (i < c.samples.length ? c.samples[i]!.toFixed(6) : ''));
    lines.push([timeMs.toFixed(4), ...values].join(','));
  }
  return lines.join('\n') + '\n';
}
