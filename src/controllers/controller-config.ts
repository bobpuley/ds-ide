export type Taper = 'linear' | 'log' | 'antilog';
export type ButtonMode = 'momentary' | 'toggle';
export type ActiveLevel = 'high' | 'low';

export interface ControllerDef {
  id: string;
  label: string;
  adcChannel: number;
  range: [number, number];
  taper: Taper;
  default: number;
}

// M10: a virtual button declared in the `buttons:` section.
export interface ButtonDef {
  id: string;
  label: string;
  gpioPin: number;       // Daisy pin number 0–31 (matches hw.GetPin(n))
  mode: ButtonMode;      // momentary (held) | toggle (latched)
  activeLevel: ActiveLevel;  // wiring metadata; runtime returns the logical press
}

// M10: a virtual LED declared in the `leds:` section. gpio_pin 23 = onboard LED.
export interface LedDef {
  id: string;
  label: string;
  gpioPin: number;
}

export interface ParseResult {
  defs: ControllerDef[];
  errors: string[];
}

// Full controller config: pots (the `controllers:` section), buttons, and LEDs.
export interface ControllerConfig {
  pots: ControllerDef[];
  buttons: ButtonDef[];
  leds: LedDef[];
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

  // Quoted string — preserve content verbatim (no comment stripping inside quotes).
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }

  // Strip inline comment: one or more spaces followed by # and the rest of the line.
  const stripped = v.replace(/\s+#.*$/, '').trim();

  // Number
  const n = Number(stripped);
  if (stripped !== '' && !isNaN(n)) return n;

  return stripped;
}

// Parse a controllers.yaml text into raw key-value maps grouped by top-level
// section (`controllers:`, `buttons:`, `leds:`). Each section maps to a list of
// item maps, one per `- ` list entry.
function parseYamlSections(text: string): Record<string, Record<string, unknown>[]> {
  const sections: Record<string, Record<string, unknown>[]> = {};
  let currentSection: string | null = null;
  let current: Record<string, unknown> | null = null;

  const flush = (): void => {
    if (currentSection && current) sections[currentSection]!.push(current);
    current = null;
  };

  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\r$/, '');

    // Skip comment and blank lines
    if (line.trimStart().startsWith('#')) continue;
    if (line.trim() === '') continue;

    // Top-level section header: no leading whitespace, bare "name:"
    const sectionMatch = line.match(/^([a-zA-Z_]\w*)\s*:\s*$/);
    if (sectionMatch) {
      flush();
      currentSection = sectionMatch[1]!;
      if (!sections[currentSection]) sections[currentSection] = [];
      continue;
    }

    if (!currentSection) continue;

    // New list item: "  - " (2+ spaces, dash, space)
    const listMatch = line.match(/^(\s{2,})-\s+(.*)/);
    if (listMatch) {
      flush();
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

  flush();
  return sections;
}

// Validate the `controllers:` (pots) section.
function parsePots(rawItems: Record<string, unknown>[]): { pots: ControllerDef[]; errors: string[] } {
  const pots: ControllerDef[] = [];
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
      pots.push({
        id: id as string,
        label: label as string,
        adcChannel: ch,
        range: range as [number, number],
        taper: taper as Taper,
        default: defaultVal as number,
      });
    }
  }

  return { pots, errors };
}

// Shared validation for id / label / gpio_pin (buttons and LEDs).
function validateDigitalEntry(
  raw: Record<string, unknown>,
  ctx: string,
  seenIds: Set<string>,
  seenPins: Set<number>,
  errors: string[],
): { id: string; label: string; gpioPin: number } | null {
  let ok = true;
  const id = raw['id'];
  const label = raw['label'];
  const gpio_pin = raw['gpio_pin'];

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

  if (typeof gpio_pin !== 'number' || !Number.isInteger(gpio_pin) || gpio_pin < 0 || gpio_pin > 31) {
    errors.push(`${ctx}: 'gpio_pin' must be an integer 0–31`);
    ok = false;
  } else if (seenPins.has(gpio_pin)) {
    errors.push(`${ctx}: duplicate gpio_pin ${gpio_pin}`);
    ok = false;
  }

  if (!ok) return null;
  seenIds.add(id as string);
  seenPins.add(gpio_pin as number);
  return { id: id as string, label: label as string, gpioPin: gpio_pin as number };
}

// Validate the `buttons:` section (FR-CT-7).
function parseButtons(rawItems: Record<string, unknown>[]): { buttons: ButtonDef[]; errors: string[] } {
  const buttons: ButtonDef[] = [];
  const errors: string[] = [];
  const seenIds = new Set<string>();
  const seenPins = new Set<number>();

  for (let i = 0; i < rawItems.length; i++) {
    const raw = rawItems[i]!;
    const ctx = `button ${i + 1}`;
    const base = validateDigitalEntry(raw, ctx, seenIds, seenPins, errors);

    // mode / active_level have defaults (decision #4/#5); validate if present.
    const mode = raw['mode'] ?? 'momentary';
    const activeLevel = raw['active_level'] ?? 'low';
    let optsOk = true;
    if (mode !== 'momentary' && mode !== 'toggle') {
      errors.push(`${ctx}: 'mode' must be momentary or toggle`);
      optsOk = false;
    }
    if (activeLevel !== 'high' && activeLevel !== 'low') {
      errors.push(`${ctx}: 'active_level' must be high or low`);
      optsOk = false;
    }

    if (base && optsOk) {
      buttons.push({
        id: base.id,
        label: base.label,
        gpioPin: base.gpioPin,
        mode: mode as ButtonMode,
        activeLevel: activeLevel as ActiveLevel,
      });
    }
  }

  return { buttons, errors };
}

// Validate the `leds:` section (FR-CT-12).
function parseLeds(rawItems: Record<string, unknown>[]): { leds: LedDef[]; errors: string[] } {
  const leds: LedDef[] = [];
  const errors: string[] = [];
  const seenIds = new Set<string>();
  const seenPins = new Set<number>();

  for (let i = 0; i < rawItems.length; i++) {
    const raw = rawItems[i]!;
    const ctx = `led ${i + 1}`;
    const base = validateDigitalEntry(raw, ctx, seenIds, seenPins, errors);
    if (base) leds.push({ id: base.id, label: base.label, gpioPin: base.gpioPin });
  }

  return { leds, errors };
}

/**
 * Parse `controllers.yaml` text and validate the pots (`controllers:`) section.
 * Returns all valid ControllerDefs and any errors found. (Backward compatible.)
 */
export function parseControllerYaml(text: string): ParseResult {
  const sections = parseYamlSections(text);
  const { pots, errors } = parsePots(sections['controllers'] ?? []);
  return { defs: pots, errors };
}

/**
 * Parse `controllers.yaml` into the full v2 config: pots (`controllers:`),
 * buttons (`buttons:`), and LEDs (`leds:`), with all validation errors merged.
 */
export function parseControllerConfig(text: string): ControllerConfig {
  const sections = parseYamlSections(text);
  const { pots, errors: potErrors } = parsePots(sections['controllers'] ?? []);
  const { buttons, errors: buttonErrors } = parseButtons(sections['buttons'] ?? []);
  const { leds, errors: ledErrors } = parseLeds(sections['leds'] ?? []);
  return { pots, buttons, leds, errors: [...potErrors, ...buttonErrors, ...ledErrors] };
}
