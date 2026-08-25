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
  pos?: [number, number]; // editor_pos — canvas position (x, y); ignored by runtime
}

// M10: a virtual button declared in the `buttons:` section.
export interface ButtonDef {
  id: string;
  label: string;
  gpioPin: number;       // Daisy pin number 0–31 (matches hw.GetPin(n))
  mode: ButtonMode;      // momentary (held) | toggle (latched)
  activeLevel: ActiveLevel;  // wiring metadata; runtime returns the logical press
  pos?: [number, number]; // editor_pos — canvas position (x, y); ignored by runtime
}

// M10: a virtual LED declared in the `leds:` section. gpio_pin 23 = onboard LED.
export interface LedDef {
  id: string;
  label: string;
  gpioPin: number;
  pos?: [number, number]; // editor_pos — canvas position (x, y); ignored by runtime
}

// M50 (FR-CE-3): encoder/toggle/RGB LED aren't independently configured in
// controllers.yaml the way pots/buttons/leds are — their pin/behavior comes
// entirely from the code annotation convention (controls-convention-parser.ts).
// These `encoders:`/`toggles:`/`rgbleds:` sections exist solely to persist
// each one's Controls Editor canvas position across saves, mirroring the
// `editor_pos` field/round-trip convention the other three device kinds use.
export interface PosOnlyDef {
  id: string;
  pos?: [number, number]; // editor_pos — canvas position (x, y); ignored by runtime
}
export type EncoderPosDef = PosOnlyDef;
export type TogglePosDef = PosOnlyDef;
export type RgbLedPosDef = PosOnlyDef;

export interface ParseResult {
  defs: ControllerDef[];
  errors: string[];
}

// Full controller config: pots (the `controllers:` section), buttons, LEDs,
// and the position-only sections for encoder/toggle/RGB LED (FR-CE-3).
export interface ControllerConfig {
  pots: ControllerDef[];
  buttons: ButtonDef[];
  leds: LedDef[];
  encoders: EncoderPosDef[];
  toggles: TogglePosDef[];
  rgbleds: RgbLedPosDef[];
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

  // Double-quoted string — unescape yamlQuote()'s escape sequences (FR-EXT-20).
  if (v.startsWith('"') && v.endsWith('"')) {
    return unescapeYamlString(v.slice(1, -1));
  }
  // Single-quoted string — never produced by yamlQuote(); preserved verbatim.
  if (v.startsWith("'") && v.endsWith("'")) {
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
// item maps, one per `- ` list entry. Any non-blank, non-comment line matching
// none of these shapes (unknown top-level key, content before any section,
// malformed list item) is reported as a parse error rather than silently
// dropped (FR-QA-EXT-4).
function parseYamlSections(text: string): { sections: Record<string, Record<string, unknown>[]>; errors: string[] } {
  const sections: Record<string, Record<string, unknown>[]> = {};
  const errors: string[] = [];
  let currentSection: string | null = null;
  let current: Record<string, unknown> | null = null;

  const flush = (): void => {
    if (currentSection && current) sections[currentSection]!.push(current);
    current = null;
  };

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.replace(/\r$/, '');
    const lineNo = i + 1;

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

    if (!currentSection) {
      errors.push(`line ${lineNo}: unrecognized line outside any section: '${line.trim()}'`);
      continue;
    }

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
      continue;
    }

    errors.push(`line ${lineNo}: unrecognized line: '${line.trim()}'`);
  }

  flush();
  return { sections, errors };
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
        pos: parseEditorPos(raw['editor_pos']),
      });
    }
  }

  return { pots, errors };
}

// Parse an optional editor_pos value ([x, y] inline array) from a raw item field.
function parseEditorPos(raw: unknown): [number, number] | undefined {
  if (!Array.isArray(raw) || raw.length !== 2) return undefined;
  const x = Number(raw[0]);
  const y = Number(raw[1]);
  if (isNaN(x) || isNaN(y)) return undefined;
  return [x, y];
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
        pos: parseEditorPos(raw['editor_pos']),
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
    if (base) leds.push({ id: base.id, label: base.label, gpioPin: base.gpioPin, pos: parseEditorPos(raw['editor_pos']) });
  }

  return { leds, errors };
}

// Validate a position-only section (`encoders:`/`toggles:`/`rgbleds:` —
// FR-CE-3): just `id` + optional `editor_pos`, since these device kinds'
// pin/behavior comes from the code annotation convention, not this file.
function parsePosOnlyEntries(rawItems: Record<string, unknown>[], kindLabel: string): { entries: PosOnlyDef[]; errors: string[] } {
  const entries: PosOnlyDef[] = [];
  const errors: string[] = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < rawItems.length; i++) {
    const raw = rawItems[i]!;
    const ctx = `${kindLabel} ${i + 1}`;
    const id = raw['id'];

    if (typeof id !== 'string' || !id.trim()) {
      errors.push(`${ctx}: 'id' is required and must be a non-empty string`);
      continue;
    }
    if (seenIds.has(id)) {
      errors.push(`${ctx}: duplicate id '${id}'`);
      continue;
    }
    seenIds.add(id);
    entries.push({ id, pos: parseEditorPos(raw['editor_pos']) });
  }

  return { entries, errors };
}

/**
 * Parse `controllers.yaml` text and validate the pots (`controllers:`) section.
 * Returns all valid ControllerDefs and any errors found. (Backward compatible.)
 */
export function parseControllerYaml(text: string): ParseResult {
  const { sections, errors: sectionErrors } = parseYamlSections(text);
  const { pots, errors } = parsePots(sections['controllers'] ?? []);
  return { defs: pots, errors: [...sectionErrors, ...errors] };
}

/**
 * Parse `controllers.yaml` into the full v2 config: pots (`controllers:`),
 * buttons (`buttons:`), and LEDs (`leds:`), with all validation errors merged.
 */
export function parseControllerConfig(text: string): ControllerConfig {
  const { sections, errors: sectionErrors } = parseYamlSections(text);
  const { pots, errors: potErrors } = parsePots(sections['controllers'] ?? []);
  const { buttons, errors: buttonErrors } = parseButtons(sections['buttons'] ?? []);
  const { leds, errors: ledErrors } = parseLeds(sections['leds'] ?? []);
  const { entries: encoders, errors: encoderErrors } = parsePosOnlyEntries(sections['encoders'] ?? [], 'encoder');
  const { entries: toggles, errors: toggleErrors } = parsePosOnlyEntries(sections['toggles'] ?? [], 'toggle');
  const { entries: rgbleds, errors: rgbledErrors } = parsePosOnlyEntries(sections['rgbleds'] ?? [], 'rgbled');
  return {
    pots, buttons, leds, encoders, toggles, rgbleds,
    errors: [...sectionErrors, ...potErrors, ...buttonErrors, ...ledErrors, ...encoderErrors, ...toggleErrors, ...rgbledErrors],
  };
}

/**
 * Serialize a ControllerConfig back to `controllers.yaml` text.
 * Preserves editor_pos positions when present. Produces a deterministic,
 * human-readable YAML that the parser can round-trip correctly.
 */
export function serializeControllerConfig(cfg: ControllerConfig): string {
  const lines: string[] = [];

  if (cfg.pots.length > 0) {
    lines.push('controllers:');
    for (const p of cfg.pots) {
      lines.push(`  - id: ${yamlQuote(p.id)}`);
      lines.push(`    label: ${yamlQuote(p.label)}`);
      lines.push(`    adc_channel: ${p.adcChannel}`);
      lines.push(`    range: [${p.range[0]}, ${p.range[1]}]`);
      lines.push(`    taper: ${p.taper}`);
      lines.push(`    default: ${p.default}`);
      if (p.pos) lines.push(`    editor_pos: [${Math.round(p.pos[0])}, ${Math.round(p.pos[1])}]`);
    }
  }

  if (cfg.buttons.length > 0) {
    lines.push('buttons:');
    for (const b of cfg.buttons) {
      lines.push(`  - id: ${yamlQuote(b.id)}`);
      lines.push(`    label: ${yamlQuote(b.label)}`);
      lines.push(`    gpio_pin: ${b.gpioPin}`);
      lines.push(`    mode: ${b.mode}`);
      lines.push(`    active_level: ${b.activeLevel}`);
      if (b.pos) lines.push(`    editor_pos: [${Math.round(b.pos[0])}, ${Math.round(b.pos[1])}]`);
    }
  }

  if (cfg.leds.length > 0) {
    lines.push('leds:');
    for (const l of cfg.leds) {
      lines.push(`  - id: ${yamlQuote(l.id)}`);
      lines.push(`    label: ${yamlQuote(l.label)}`);
      lines.push(`    gpio_pin: ${l.gpioPin}`);
      if (l.pos) lines.push(`    editor_pos: [${Math.round(l.pos[0])}, ${Math.round(l.pos[1])}]`);
    }
  }

  serializePosOnlySection(lines, 'encoders', cfg.encoders);
  serializePosOnlySection(lines, 'toggles', cfg.toggles);
  serializePosOnlySection(lines, 'rgbleds', cfg.rgbleds);

  return lines.join('\n') + '\n';
}

// FR-CE-3: shared serialization for the position-only encoder/toggle/rgbled
// sections — just `id` + optional `editor_pos`.
function serializePosOnlySection(lines: string[], sectionName: string, entries: PosOnlyDef[]): void {
  if (entries.length === 0) return;
  lines.push(`${sectionName}:`);
  for (const e of entries) {
    lines.push(`  - id: ${yamlQuote(e.id)}`);
    if (e.pos) lines.push(`    editor_pos: [${Math.round(e.pos[0])}, ${Math.round(e.pos[1])}]`);
  }
}

// Quote a label value for YAML: wraps in double-quotes if it contains
// characters that could be misread as YAML syntax (colon, hash, quote, etc.)
// or that would corrupt the line-based reader below — newlines/carriage
// returns/other control characters are escaped rather than emitted literally,
// so a label containing one still serializes on a single physical line and
// round-trips intact (FR-EXT-20).
function yamlQuote(s: string): string {
  if (/[:#\[\]{},'"&*?|<>=!%@`\x00-\x1f]/.test(s) || s.trim() !== s || s === '' || /^[0-9]/.test(s)) {
    return '"' + escapeYamlString(s) + '"';
  }
  return s;
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\\"\x00-\x1f]/g;

function escapeYamlString(s: string): string {
  return s.replace(CONTROL_CHAR_RE, (ch) => {
    switch (ch) {
      case '\\': return '\\\\';
      case '"': return '\\"';
      case '\n': return '\\n';
      case '\r': return '\\r';
      case '\t': return '\\t';
      default: return '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0');
    }
  });
}

const ESCAPE_SEQUENCE_RE = /\\(\\|"|n|r|t|u[0-9a-fA-F]{4})/g;

function unescapeYamlString(s: string): string {
  return s.replace(ESCAPE_SEQUENCE_RE, (_m, esc: string) => {
    switch (esc[0]) {
      case '\\': return '\\';
      case '"': return '"';
      case 'n': return '\n';
      case 'r': return '\r';
      case 't': return '\t';
      case 'u': return String.fromCharCode(parseInt(esc.slice(1), 16));
      default: return esc;
    }
  });
}
