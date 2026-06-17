export type Taper = 'linear' | 'log' | 'antilog';

export interface ControllerDef {
  id: string;
  label: string;
  adcChannel: number;
  range: [number, number];
  taper: Taper;
  default: number;
}

export interface ParseResult {
  defs: ControllerDef[];
  errors: string[];
}

// Parse a scalar YAML value: quoted string, inline array [n, n], number, or bare string.
function parseYamlScalar(raw: string): string | number | [number, number] {
  const v = raw.trim();

  // Inline array [num, num]
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1);
    const parts = inner.split(',').map(p => Number(p.trim()));
    if (parts.length === 2 && parts.every(n => !isNaN(n))) {
      return [parts[0]!, parts[1]!] as [number, number];
    }
  }

  // Quoted string
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }

  // Number
  const n = Number(v);
  if (v !== '' && !isNaN(n)) return n;

  return v;
}

// Parse a controllers.yaml text into raw key-value maps, one per list item.
function parseYamlItems(text: string): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];
  let current: Record<string, unknown> | null = null;
  let inControllers = false;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\r$/, '');

    // Skip comment lines
    if (line.trimStart().startsWith('#')) continue;

    if (!inControllers) {
      if (/^controllers\s*:/.test(line.trimStart())) inControllers = true;
      continue;
    }

    // New list item: "  - " (2+ spaces, dash, space)
    const listMatch = line.match(/^(\s{2,})-\s+(.*)/);
    if (listMatch) {
      if (current) items.push(current);
      current = {};
      // Key-value may follow the dash on the same line
      const rest = (listMatch[2] ?? '').trim();
      if (rest) {
        const ci = rest.indexOf(':');
        if (ci !== -1) {
          const key = rest.slice(0, ci).trim();
          const val = rest.slice(ci + 1);
          if (key) current[key] = parseYamlScalar(val);
        }
      }
      continue;
    }

    // Key-value pair inside current item (4+ spaces)
    const kvMatch = line.match(/^(\s{4,})([\w]+)\s*:\s*(.*)/);
    if (kvMatch && current) {
      const key = kvMatch[2]!;
      const val = kvMatch[3] ?? '';
      current[key] = parseYamlScalar(val);
    }
  }

  if (current) items.push(current);
  return items;
}

/**
 * Parse `controllers.yaml` text and validate each entry.
 * Returns all valid ControllerDefs and any errors found.
 */
export function parseControllerYaml(text: string): ParseResult {
  const rawItems = parseYamlItems(text);
  const defs: ControllerDef[] = [];
  const errors: string[] = [];
  const seenChannels = new Set<number>();
  const seenIds = new Set<string>();

  for (let i = 0; i < rawItems.length; i++) {
    const raw = rawItems[i]!;
    const ctx = `controller ${i + 1}`;
    let ok = true;

    const id = raw['id'];
    const label = raw['label'];
    const adc_channel = raw['adc_channel'];
    const range = raw['range'];
    const taper = raw['taper'];
    const defaultVal = raw['default'];

    if (typeof id !== 'string' || !id.trim()) {
      errors.push(`${ctx}: 'id' is required and must be a non-empty string`);
      ok = false;
    } else if (seenIds.has(id)) {
      errors.push(`${ctx}: duplicate id '${id}'`);
      ok = false;
    }

    if (typeof label !== 'string' || !label.trim()) {
      errors.push(`${ctx}: 'label' is required and must be a non-empty string`);
      ok = false;
    }

    if (
      typeof adc_channel !== 'number' ||
      !Number.isInteger(adc_channel) ||
      adc_channel < 0 ||
      adc_channel > 11
    ) {
      errors.push(`${ctx}: 'adc_channel' must be an integer 0–11`);
      ok = false;
    } else if (seenChannels.has(adc_channel)) {
      errors.push(`${ctx}: duplicate adc_channel ${adc_channel}`);
      ok = false;
    }

    if (!Array.isArray(range) || range.length !== 2 || range.some(isNaN)) {
      errors.push(`${ctx}: 'range' must be [min, max]`);
      ok = false;
    }

    const validTapers: string[] = ['linear', 'log', 'antilog'];
    if (typeof taper !== 'string' || !validTapers.includes(taper)) {
      errors.push(`${ctx}: 'taper' must be linear, log, or antilog`);
      ok = false;
    }

    if (typeof defaultVal !== 'number' || isNaN(defaultVal) || defaultVal < 0 || defaultVal > 1) {
      errors.push(`${ctx}: 'default' must be a number between 0 and 1`);
      ok = false;
    }

    if (ok) {
      const ch = adc_channel as number;
      seenChannels.add(ch);
      seenIds.add(id as string);
      defs.push({
        id: id as string,
        label: label as string,
        adcChannel: ch,
        range: range as [number, number],
        taper: taper as Taper,
        default: defaultVal as number,
      });
    }
  }

  return { defs, errors };
}
