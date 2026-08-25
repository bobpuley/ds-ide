import { describe, it, expect } from 'vitest';
import { parseControllerYaml, parseControllerConfig, serializeControllerConfig, ControllerConfig } from '../../../controllers/controller-config';

const MINIMAL_VALID = `
controllers:
  - id: osc_pitch
    label: "Oscillator Pitch"
    adc_channel: 0
    range: [0, 1]
    taper: linear
    default: 0.5
`;

const TWO_POTS = `
controllers:
  - id: osc_pitch
    label: "Oscillator Pitch"
    adc_channel: 0
    range: [0, 1]
    taper: linear
    default: 0.5
  - id: filter_cutoff
    label: Filter Cutoff
    adc_channel: 1
    range: [0, 1]
    taper: log
    default: 0.3
`;

describe('parseControllerYaml', () => {
  describe('valid input', () => {
    it('parses a single controller', () => {
      const { defs, errors } = parseControllerYaml(MINIMAL_VALID);
      expect(errors).toHaveLength(0);
      expect(defs).toHaveLength(1);
      const d = defs[0]!;
      expect(d.id).toBe('osc_pitch');
      expect(d.label).toBe('Oscillator Pitch');
      expect(d.adcChannel).toBe(0);
      expect(d.range).toEqual([0, 1]);
      expect(d.taper).toBe('linear');
      expect(d.default).toBe(0.5);
    });

    it('parses two controllers', () => {
      const { defs, errors } = parseControllerYaml(TWO_POTS);
      expect(errors).toHaveLength(0);
      expect(defs).toHaveLength(2);
      expect(defs[0]!.id).toBe('osc_pitch');
      expect(defs[1]!.id).toBe('filter_cutoff');
      expect(defs[1]!.adcChannel).toBe(1);
      expect(defs[1]!.taper).toBe('log');
    });

    it('accepts unquoted label', () => {
      const { defs, errors } = parseControllerYaml(TWO_POTS);
      expect(errors).toHaveLength(0);
      expect(defs[1]!.label).toBe('Filter Cutoff');
    });

    it('accepts all valid tapers', () => {
      for (const taper of ['linear', 'log', 'antilog']) {
        const yaml = MINIMAL_VALID.replace('taper: linear', `taper: ${taper}`);
        const { defs, errors } = parseControllerYaml(yaml);
        expect(errors).toHaveLength(0);
        expect(defs[0]!.taper).toBe(taper);
      }
    });

    it('accepts default: 0 and default: 1 boundary values', () => {
      const yaml0 = MINIMAL_VALID.replace('default: 0.5', 'default: 0');
      const yaml1 = MINIMAL_VALID.replace('default: 0.5', 'default: 1');
      expect(parseControllerYaml(yaml0).errors).toHaveLength(0);
      expect(parseControllerYaml(yaml1).errors).toHaveLength(0);
    });

    it('accepts adc_channel 11 (highest valid)', () => {
      const yaml = MINIMAL_VALID.replace('adc_channel: 0', 'adc_channel: 11');
      const { defs, errors } = parseControllerYaml(yaml);
      expect(errors).toHaveLength(0);
      expect(defs[0]!.adcChannel).toBe(11);
    });

    it('returns empty defs with no errors for empty text', () => {
      const { defs, errors } = parseControllerYaml('');
      expect(errors).toHaveLength(0);
      expect(defs).toHaveLength(0);
    });

    it('returns empty defs with no errors when controllers: is absent', () => {
      const { defs, errors } = parseControllerYaml('# no controllers here\n');
      expect(errors).toHaveLength(0);
      expect(defs).toHaveLength(0);
    });

    it('ignores comment lines', () => {
      const yaml = `
controllers:
  # first pot
  - id: osc_pitch
    label: Pitch
    adc_channel: 0
    range: [0, 1]
    taper: linear
    default: 0.5
`;
      const { defs, errors } = parseControllerYaml(yaml);
      expect(errors).toHaveLength(0);
      expect(defs).toHaveLength(1);
    });
  });

  describe('unrecognized lines (FR-QA-EXT-4)', () => {
    it('reports a parse error for a top-level key the parser does not recognize, instead of silently skipping it', () => {
      const yaml = `controls: []\n`;
      const { defs, errors } = parseControllerYaml(yaml);
      expect(defs).toHaveLength(0);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toMatch(/unrecognized/i);
    });

    it('reports a parse error for content preceding any section header', () => {
      const yaml = `not a valid line\ncontrollers:\n`;
      const { errors } = parseControllerYaml(yaml);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toMatch(/unrecognized/i);
    });
  });

  describe('duplicate detection (FR-CT-5)', () => {
    it('reports duplicate adc_channel', () => {
      const yaml = `
controllers:
  - id: pot_a
    label: A
    adc_channel: 0
    range: [0, 1]
    taper: linear
    default: 0.5
  - id: pot_b
    label: B
    adc_channel: 0
    range: [0, 1]
    taper: linear
    default: 0.3
`;
      const { defs, errors } = parseControllerYaml(yaml);
      expect(errors.some(e => e.includes('duplicate adc_channel'))).toBe(true);
      expect(defs).toHaveLength(1); // only first valid one included
    });

    it('reports duplicate id', () => {
      const yaml = `
controllers:
  - id: osc_pitch
    label: A
    adc_channel: 0
    range: [0, 1]
    taper: linear
    default: 0.5
  - id: osc_pitch
    label: B
    adc_channel: 1
    range: [0, 1]
    taper: linear
    default: 0.3
`;
      const { errors } = parseControllerYaml(yaml);
      expect(errors.some(e => e.includes("duplicate id"))).toBe(true);
    });
  });

  describe('field validation (FR-CT-5)', () => {
    it('reports missing id', () => {
      const yaml = MINIMAL_VALID.replace('id: osc_pitch\n', '');
      const { errors } = parseControllerYaml(yaml);
      expect(errors.some(e => e.includes("'id'"))).toBe(true);
    });

    it('reports missing label', () => {
      const yaml = MINIMAL_VALID.replace('label: "Oscillator Pitch"\n', '');
      const { errors } = parseControllerYaml(yaml);
      expect(errors.some(e => e.includes("'label'"))).toBe(true);
    });

    it('reports adc_channel out of range (> 11)', () => {
      const yaml = MINIMAL_VALID.replace('adc_channel: 0', 'adc_channel: 12');
      const { errors } = parseControllerYaml(yaml);
      expect(errors.some(e => e.includes("'adc_channel'"))).toBe(true);
    });

    it('reports adc_channel out of range (negative)', () => {
      const yaml = MINIMAL_VALID.replace('adc_channel: 0', 'adc_channel: -1');
      const { errors } = parseControllerYaml(yaml);
      expect(errors.some(e => e.includes("'adc_channel'"))).toBe(true);
    });

    it('reports invalid taper', () => {
      const yaml = MINIMAL_VALID.replace('taper: linear', 'taper: exponential');
      const { errors } = parseControllerYaml(yaml);
      expect(errors.some(e => e.includes("'taper'"))).toBe(true);
    });

    it('reports default out of range (> 1)', () => {
      const yaml = MINIMAL_VALID.replace('default: 0.5', 'default: 1.5');
      const { errors } = parseControllerYaml(yaml);
      expect(errors.some(e => e.includes("'default'"))).toBe(true);
    });

    it('reports default out of range (< 0)', () => {
      const yaml = MINIMAL_VALID.replace('default: 0.5', 'default: -0.1');
      const { errors } = parseControllerYaml(yaml);
      expect(errors.some(e => e.includes("'default'"))).toBe(true);
    });

    it('reports invalid range format', () => {
      const yaml = MINIMAL_VALID.replace('range: [0, 1]', 'range: 0');
      const { errors } = parseControllerYaml(yaml);
      expect(errors.some(e => e.includes("'range'"))).toBe(true);
    });

    it('invalid items are excluded from defs but valid ones are kept', () => {
      const yaml = `
controllers:
  - id: bad_one
    label: Bad
    adc_channel: 99
    range: [0, 1]
    taper: linear
    default: 0.5
  - id: good_one
    label: Good
    adc_channel: 3
    range: [0, 1]
    taper: linear
    default: 0.5
`;
      const { defs, errors } = parseControllerYaml(yaml);
      expect(errors.length).toBeGreaterThan(0);
      expect(defs).toHaveLength(1);
      expect(defs[0]!.id).toBe('good_one');
    });
  });
});

// ---- M10: buttons + LEDs (T10.1) ----

const FULL_CONFIG = `
controllers:
  - id: vol
    label: Volume
    adc_channel: 0
    range: [0, 1]
    taper: linear
    default: 0.5
buttons:
  - id: bypass
    label: Bypass
    gpio_pin: 28
    mode: toggle
    active_level: low
leds:
  - id: status
    label: Status
    gpio_pin: 23
`;

describe('parseControllerConfig (M10)', () => {
  describe('valid input', () => {
    it('parses pots, buttons, and leds together', () => {
      const { pots, buttons, leds, errors } = parseControllerConfig(FULL_CONFIG);
      expect(errors).toHaveLength(0);
      expect(pots).toHaveLength(1);
      expect(buttons).toHaveLength(1);
      expect(leds).toHaveLength(1);
      expect(pots[0]!.id).toBe('vol');
    });

    it('keeps the controllers: (pots) section unchanged', () => {
      const { pots } = parseControllerConfig(FULL_CONFIG);
      expect(pots[0]!.adcChannel).toBe(0);
      expect(pots[0]!.taper).toBe('linear');
    });

    it('parses a button with all fields', () => {
      const { buttons } = parseControllerConfig(FULL_CONFIG);
      const b = buttons[0]!;
      expect(b.id).toBe('bypass');
      expect(b.label).toBe('Bypass');
      expect(b.gpioPin).toBe(28);
      expect(b.mode).toBe('toggle');
      expect(b.activeLevel).toBe('low');
    });

    it('defaults mode to momentary and active_level to low when omitted', () => {
      const yaml = `
buttons:
  - id: tap
    label: Tap
    gpio_pin: 25
`;
      const { buttons, errors } = parseControllerConfig(yaml);
      expect(errors).toHaveLength(0);
      expect(buttons[0]!.mode).toBe('momentary');
      expect(buttons[0]!.activeLevel).toBe('low');
    });

    it('parses an led entry', () => {
      const { leds } = parseControllerConfig(FULL_CONFIG);
      expect(leds[0]!.id).toBe('status');
      expect(leds[0]!.gpioPin).toBe(23);
    });

    it('returns empty sections when buttons:/leds: are absent', () => {
      const yaml = `
controllers:
  - id: vol
    label: Volume
    adc_channel: 0
    range: [0, 1]
    taper: linear
    default: 0.5
`;
      const { buttons, leds, errors } = parseControllerConfig(yaml);
      expect(errors).toHaveLength(0);
      expect(buttons).toHaveLength(0);
      expect(leds).toHaveLength(0);
    });

    // FR-EXT-21 — the pin table's actual highest defined pin is 30, not the
    // previously-hardcoded 31; the upper bound must track PIN_DEFS.
    it('accepts gpio_pin boundaries 0 and 30 (the pin table\'s actual max)', () => {
      const yaml = `
buttons:
  - id: a
    label: A
    gpio_pin: 0
  - id: b
    label: B
    gpio_pin: 30
`;
      const { buttons, errors } = parseControllerConfig(yaml);
      expect(errors).toHaveLength(0);
      expect(buttons).toHaveLength(2);
    });

    it('rejects gpio_pin 31 — beyond the pin table\'s actual maximum (FR-EXT-21)', () => {
      const yaml = `buttons:\n  - id: a\n    label: A\n    gpio_pin: 31\n`;
      const { buttons, errors } = parseControllerConfig(yaml);
      expect(errors.some(e => e.includes("'gpio_pin'"))).toBe(true);
      expect(buttons).toHaveLength(0);
    });
  });

  describe('button validation', () => {
    it('reports gpio_pin out of range (> pin table max)', () => {
      const yaml = `buttons:\n  - id: a\n    label: A\n    gpio_pin: 32\n`;
      const { errors } = parseControllerConfig(yaml);
      expect(errors.some(e => e.includes("'gpio_pin'"))).toBe(true);
    });

    it('reports duplicate gpio_pin among buttons', () => {
      const yaml = `buttons:\n  - id: a\n    label: A\n    gpio_pin: 5\n  - id: b\n    label: B\n    gpio_pin: 5\n`;
      const { buttons, errors } = parseControllerConfig(yaml);
      expect(errors.some(e => e.includes('duplicate gpio_pin'))).toBe(true);
      expect(buttons).toHaveLength(1);
    });

    it('reports duplicate button id', () => {
      const yaml = `buttons:\n  - id: a\n    label: A\n    gpio_pin: 5\n  - id: a\n    label: B\n    gpio_pin: 6\n`;
      const { errors } = parseControllerConfig(yaml);
      expect(errors.some(e => e.includes('duplicate id'))).toBe(true);
    });

    it('reports invalid mode', () => {
      const yaml = `buttons:\n  - id: a\n    label: A\n    gpio_pin: 5\n    mode: latching\n`;
      const { errors } = parseControllerConfig(yaml);
      expect(errors.some(e => e.includes("'mode'"))).toBe(true);
    });

    it('reports invalid active_level', () => {
      const yaml = `buttons:\n  - id: a\n    label: A\n    gpio_pin: 5\n    active_level: middle\n`;
      const { errors } = parseControllerConfig(yaml);
      expect(errors.some(e => e.includes("'active_level'"))).toBe(true);
    });

    it('reports missing gpio_pin', () => {
      const yaml = `buttons:\n  - id: a\n    label: A\n`;
      const { errors } = parseControllerConfig(yaml);
      expect(errors.some(e => e.includes("'gpio_pin'"))).toBe(true);
    });
  });

  describe('led validation', () => {
    it('reports led gpio_pin out of range', () => {
      const yaml = `leds:\n  - id: x\n    label: X\n    gpio_pin: -1\n`;
      const { errors } = parseControllerConfig(yaml);
      expect(errors.some(e => e.includes("'gpio_pin'"))).toBe(true);
    });

    it('reports duplicate led gpio_pin', () => {
      const yaml = `leds:\n  - id: x\n    label: X\n    gpio_pin: 23\n  - id: y\n    label: Y\n    gpio_pin: 23\n`;
      const { leds, errors } = parseControllerConfig(yaml);
      expect(errors.some(e => e.includes('duplicate gpio_pin'))).toBe(true);
      expect(leds).toHaveLength(1);
    });

    it('button and led may share a pin number (independent sections)', () => {
      const yaml = `buttons:\n  - id: b\n    label: B\n    gpio_pin: 10\nleds:\n  - id: l\n    label: L\n    gpio_pin: 10\n`;
      const { buttons, leds, errors } = parseControllerConfig(yaml);
      expect(errors).toHaveLength(0);
      expect(buttons).toHaveLength(1);
      expect(leds).toHaveLength(1);
    });
  });

  it('parseControllerYaml still returns only pots (backward compatible)', () => {
    const { defs, errors } = parseControllerYaml(FULL_CONFIG);
    expect(errors).toHaveLength(0);
    expect(defs).toHaveLength(1);
    expect(defs[0]!.id).toBe('vol');
  });

  it('strips inline YAML comments from unquoted scalar values', () => {
    const yaml = `
buttons:
  - id: bypass
    label: Bypass
    gpio_pin: 28
    mode: toggle        # click to latch audio on/off
    active_level: low
  - id: boost
    label: Boost
    gpio_pin: 25
    mode: momentary     # louder only while held
    active_level: low
`;
    const { buttons, errors } = parseControllerConfig(yaml);
    expect(errors).toHaveLength(0);
    expect(buttons).toHaveLength(2);
    expect(buttons[0]!.mode).toBe('toggle');
    expect(buttons[1]!.mode).toBe('momentary');
  });
});

// ---- M10b: editor_pos + serializer (T10b.3) ----

describe('editor_pos parsing (M10b)', () => {
  it('parses editor_pos on a pot', () => {
    const yaml = `
controllers:
  - id: vol
    label: Volume
    adc_channel: 0
    range: [0, 1]
    taper: linear
    default: 0.5
    editor_pos: [120, 80]
`;
    const { pots, errors } = parseControllerConfig(yaml);
    expect(errors).toHaveLength(0);
    expect(pots[0]!.pos).toEqual([120, 80]);
  });

  it('parses editor_pos on a button', () => {
    const yaml = `
buttons:
  - id: bypass
    label: Bypass
    gpio_pin: 28
    editor_pos: [250, 80]
`;
    const { buttons } = parseControllerConfig(yaml);
    expect(buttons[0]!.pos).toEqual([250, 80]);
  });

  it('parses editor_pos on a led', () => {
    const yaml = `
leds:
  - id: status
    label: Status
    gpio_pin: 23
    editor_pos: [380, 80]
`;
    const { leds } = parseControllerConfig(yaml);
    expect(leds[0]!.pos).toEqual([380, 80]);
  });

  it('leaves pos undefined when editor_pos is absent', () => {
    const yaml = `
controllers:
  - id: vol
    label: Volume
    adc_channel: 0
    range: [0, 1]
    taper: linear
    default: 0.5
`;
    const { pots } = parseControllerConfig(yaml);
    expect(pots[0]!.pos).toBeUndefined();
  });
});

// ---- M50: encoder/toggle/rgbled position-only sections (FR-CE-3) ----

describe('encoder/toggle/rgbled editor_pos parsing (FR-CE-3)', () => {
  it('parses editor_pos on an encoder', () => {
    const yaml = `
encoders:
  - id: enc1
    editor_pos: [120, 80]
`;
    const { encoders, errors } = parseControllerConfig(yaml);
    expect(errors).toHaveLength(0);
    expect(encoders).toEqual([{ id: 'enc1', pos: [120, 80] }]);
  });

  it('parses editor_pos on a toggle', () => {
    const yaml = `
toggles:
  - id: tgl1
    editor_pos: [250, 80]
`;
    const { toggles, errors } = parseControllerConfig(yaml);
    expect(errors).toHaveLength(0);
    expect(toggles).toEqual([{ id: 'tgl1', pos: [250, 80] }]);
  });

  it('parses editor_pos on a rgbled', () => {
    const yaml = `
rgbleds:
  - id: rgb1
    editor_pos: [380, 80]
`;
    const { rgbleds, errors } = parseControllerConfig(yaml);
    expect(errors).toHaveLength(0);
    expect(rgbleds).toEqual([{ id: 'rgb1', pos: [380, 80] }]);
  });

  it('leaves pos undefined when editor_pos is absent on an encoder', () => {
    const { encoders } = parseControllerConfig('encoders:\n  - id: enc1\n');
    expect(encoders[0]!.pos).toBeUndefined();
  });

  it('reports an error for a duplicate encoder id', () => {
    const { errors } = parseControllerConfig('encoders:\n  - id: enc1\n  - id: enc1\n');
    expect(errors).toContainEqual(expect.stringContaining("duplicate id 'enc1'"));
  });

  it('reports an error when an encoder entry has no id', () => {
    const { errors } = parseControllerConfig('encoders:\n  - editor_pos: [10, 20]\n');
    expect(errors).toContainEqual(expect.stringContaining("'id' is required"));
  });
});

describe('serializeControllerConfig (M10b)', () => {
  it('round-trips a full config without editor_pos', () => {
    const yaml = `controllers:
  - id: vol
    label: Volume
    adc_channel: 0
    range: [0, 1]
    taper: linear
    default: 0.5
buttons:
  - id: bypass
    label: Bypass
    gpio_pin: 28
    mode: toggle
    active_level: low
leds:
  - id: status
    label: Status
    gpio_pin: 23
`;
    const cfg = parseControllerConfig(yaml);
    const out = serializeControllerConfig(cfg);
    const reparsed = parseControllerConfig(out);
    expect(reparsed.errors).toHaveLength(0);
    expect(reparsed.pots[0]!.id).toBe('vol');
    expect(reparsed.buttons[0]!.id).toBe('bypass');
    expect(reparsed.leds[0]!.id).toBe('status');
  });

  it('round-trips editor_pos positions', () => {
    const cfg = parseControllerConfig(`
controllers:
  - id: vol
    label: Volume
    adc_channel: 0
    range: [0, 1]
    taper: linear
    default: 0.5
    editor_pos: [120, 80]
buttons:
  - id: bypass
    label: Bypass
    gpio_pin: 28
    editor_pos: [250, 80]
leds:
  - id: status
    label: Status
    gpio_pin: 23
    editor_pos: [380, 80]
`);
    const out = serializeControllerConfig(cfg);
    const reparsed = parseControllerConfig(out);
    expect(reparsed.pots[0]!.pos).toEqual([120, 80]);
    expect(reparsed.buttons[0]!.pos).toEqual([250, 80]);
    expect(reparsed.leds[0]!.pos).toEqual([380, 80]);
  });

  // FR-CE-3 — the drag → save → reload round trip M50 exists to fix:
  // encoder/toggle/rgbled positions must survive a full parse/serialize
  // cycle exactly like pot/button/led already do above.
  it('round-trips encoder/toggle/rgbled editor_pos positions', () => {
    const cfg = parseControllerConfig(`
encoders:
  - id: enc1
    editor_pos: [15, 25]
toggles:
  - id: tgl1
    editor_pos: [35, 45]
rgbleds:
  - id: rgb1
    editor_pos: [55, 65]
`);
    const out = serializeControllerConfig(cfg);
    const reparsed = parseControllerConfig(out);
    expect(reparsed.errors).toHaveLength(0);
    expect(reparsed.encoders[0]!.pos).toEqual([15, 25]);
    expect(reparsed.toggles[0]!.pos).toEqual([35, 45]);
    expect(reparsed.rgbleds[0]!.pos).toEqual([55, 65]);
  });

  it('omits editor_pos line when pos is undefined', () => {
    const cfg = parseControllerConfig(`
leds:
  - id: status
    label: Status
    gpio_pin: 23
`);
    const out = serializeControllerConfig(cfg);
    expect(out).not.toContain('editor_pos');
  });

  it('rounds fractional positions to integers', () => {
    const cfg = parseControllerConfig(`
leds:
  - id: x
    label: X
    gpio_pin: 5
    editor_pos: [10, 20]
`);
    cfg.leds[0]!.pos = [100.7, 200.3];
    const out = serializeControllerConfig(cfg);
    expect(out).toContain('editor_pos: [101, 200]');
  });

  it('quotes labels containing special YAML characters', () => {
    const cfg = parseControllerConfig(`
leds:
  - id: x
    label: "Status: on"
    gpio_pin: 5
`);
    const out = serializeControllerConfig(cfg);
    expect(out).toContain('"Status: on"');
  });

  it('produces no pots section when pots is empty', () => {
    const cfg = parseControllerConfig(`leds:\n  - id: x\n    label: X\n    gpio_pin: 5\n`);
    const out = serializeControllerConfig(cfg);
    expect(out).not.toContain('controllers:');
    expect(out).toContain('leds:');
  });

  // FR-IPC-3 — ids containing YAML-syntax characters must round-trip intact.
  it('quotes a pot id containing a colon so it round-trips intact', () => {
    const cfg: ControllerConfig = {
      pots: [{ id: 'foo:bar', label: 'L', adcChannel: 0, range: [0, 1], taper: 'linear', default: 0.5 }],
      buttons: [], leds: [], encoders: [], toggles: [], rgbleds: [], errors: [],
    };
    const out = serializeControllerConfig(cfg);
    expect(out).toContain('id: "foo:bar"');
    const reparsed = parseControllerConfig(out);
    expect(reparsed.errors).toHaveLength(0);
    expect(reparsed.pots[0]!.id).toBe('foo:bar');
  });

  it('quotes a button id containing a hash so it round-trips intact', () => {
    const cfg: ControllerConfig = {
      pots: [], leds: [],
      buttons: [{ id: 'foo#bar', label: 'L', gpioPin: 5, mode: 'momentary', activeLevel: 'low' }],
      encoders: [], toggles: [], rgbleds: [],
      errors: [],
    };
    const out = serializeControllerConfig(cfg);
    expect(out).toContain('id: "foo#bar"');
    const reparsed = parseControllerConfig(out);
    expect(reparsed.errors).toHaveLength(0);
    expect(reparsed.buttons[0]!.id).toBe('foo#bar');
  });

  it('quotes an led id containing a hash so it round-trips intact', () => {
    const cfg: ControllerConfig = {
      pots: [], buttons: [],
      leds: [{ id: 'foo#bar', label: 'L', gpioPin: 5 }],
      encoders: [], toggles: [], rgbleds: [],
      errors: [],
    };
    const out = serializeControllerConfig(cfg);
    expect(out).toContain('id: "foo#bar"');
    const reparsed = parseControllerConfig(out);
    expect(reparsed.errors).toHaveLength(0);
    expect(reparsed.leds[0]!.id).toBe('foo#bar');
  });

  // FR-EXT-20 — a label containing an embedded newline must round-trip
  // through save/load without corrupting the (line-based) parser or losing data.
  it('quotes and escapes a label containing an embedded newline so it round-trips intact', () => {
    const cfg: ControllerConfig = {
      pots: [{ id: 'osc_pitch', label: 'Line one\nLine two', adcChannel: 0, range: [0, 1], taper: 'linear', default: 0.5 }],
      buttons: [], leds: [], encoders: [], toggles: [], rgbleds: [], errors: [],
    };
    const out = serializeControllerConfig(cfg);
    // The escaped label must not introduce an actual newline into the file —
    // same line count as an equivalent single-line label (7 lines: header +
    // id/label/adc_channel/range/taper/default), not 8 from a raw newline.
    expect(out.split('\n').filter(l => l.length > 0)).toHaveLength(7);
    expect(out).toContain('\\n');

    const reparsed = parseControllerConfig(out);
    expect(reparsed.errors).toHaveLength(0);
    expect(reparsed.pots[0]!.label).toBe('Line one\nLine two');
  });

  it('quotes and escapes a label containing a carriage return so it round-trips intact', () => {
    const cfg: ControllerConfig = {
      pots: [],
      buttons: [{ id: 'a', label: 'A\rB', gpioPin: 5, mode: 'momentary', activeLevel: 'low' }],
      leds: [], encoders: [], toggles: [], rgbleds: [], errors: [],
    };
    const out = serializeControllerConfig(cfg);
    const reparsed = parseControllerConfig(out);
    expect(reparsed.errors).toHaveLength(0);
    expect(reparsed.buttons[0]!.label).toBe('A\rB');
  });

  it('leaves plain identifier ids unquoted', () => {
    const cfg: ControllerConfig = {
      pots: [{ id: 'osc_pitch', label: 'L', adcChannel: 0, range: [0, 1], taper: 'linear', default: 0.5 }],
      buttons: [], leds: [], encoders: [], toggles: [], rgbleds: [], errors: [],
    };
    const out = serializeControllerConfig(cfg);
    expect(out).toContain('id: osc_pitch');
    expect(out).not.toContain('"osc_pitch"');
  });
});
