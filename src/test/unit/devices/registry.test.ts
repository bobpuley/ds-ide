import { describe, it, expect, afterEach } from 'vitest';
import { REGISTRY, DEVICE_TYPES, isDeviceType, DeviceType, wiredControlIds, accentVar, type DeviceDescriptor } from '../../../devices/registry';
import { parseControlsConvention } from '../../../controllers/controls-convention-parser';
import { buildHtml as buildWiringHtml } from '../../../wiring/wiring-panel';
import { buildHtml as buildControlsHtml } from '../../../sidebar/controls-editor-panel';
import { declarationLine } from '../../../wiring/controls-writer';

describe('REGISTRY (FR-DEV-2)', () => {
  it('lists pot, button, led, toggle, rgbled, encoder, sdcard, oled, midiTrs and midiUsb', () => {
    expect([...DEVICE_TYPES].sort()).toEqual(['button', 'encoder', 'led', 'midiTrs', 'midiUsb', 'oled', 'pot', 'rgbled', 'sdcard', 'toggle']);
  });

  it('isDeviceType recognizes registered kinds and rejects others', () => {
    expect(isDeviceType('pot')).toBe(true);
    expect(isDeviceType('servo')).toBe(false);
  });

  // Backs the `REGISTRY[kind]!` non-null-assertion convention documented at
  // REGISTRY's declaration (FR-EXT-29): every kind, statically typed as
  // DeviceType, is guaranteed a REGISTRY entry.
  it('has a REGISTRY entry for every DEVICE_TYPES member', () => {
    for (const kind of DEVICE_TYPES) {
      expect(REGISTRY[kind]).toBeDefined();
    }
  });

  it('declares pot, button, led and toggle as pin-attached (FR-DEV-3)', () => {
    expect(REGISTRY['pot']!.attachmentKind).toBe('pin');
    expect(REGISTRY['button']!.attachmentKind).toBe('pin');
    expect(REGISTRY['led']!.attachmentKind).toBe('pin');
    expect(REGISTRY['toggle']!.attachmentKind).toBe('pin');
  });

  it('declares pot as requiring an ADC pin and no other device as pin-constrained (FR-UDM-1)', () => {
    expect(REGISTRY['pot']!.pinRequires).toBe('adc');
    for (const id of ['button', 'led', 'toggle', 'rgbled', 'encoder']) {
      expect(REGISTRY[id]!.pinRequires).toBeUndefined();
    }
  });

  it('names each multi-pin device\'s pin slots in Init() argument order (FR-UDM-3)', () => {
    expect(REGISTRY['rgbled']!.pinSlots).toEqual(['R', 'G', 'B']);
    expect(REGISTRY['encoder']!.pinSlots).toEqual(['A', 'B', 'SW']);
    for (const id of Object.keys(REGISTRY)) {
      const d = REGISTRY[id]!;
      if (d.pinSlots) expect(d.pinSlots).toHaveLength(d.pinCount!);
    }
  });

  it('declares toggle with the multi-position primitive (FR-DEV-7)', () => {
    expect(REGISTRY['toggle']!.primitive).toBe('multi-position');
    expect(REGISTRY['toggle']!.declaredClassName).toBe('Switch3');
    expect(REGISTRY['toggle']!.initArgs).toBeNull();
  });

  it('declares rgbled as a 3-pin ("pins") device (FR-DEV-8)', () => {
    expect(REGISTRY['rgbled']!.attachmentKind).toBe('pins');
    expect(REGISTRY['rgbled']!.pinCount).toBe(3);
    expect(REGISTRY['rgbled']!.declaredClassName).toBe('RgbLed');
    expect(REGISTRY['rgbled']!.primitive).toBe('indicator');
  });

  it('declares encoder as a 3-pin ("pins") device with the delta primitive (FR-DEV-9)', () => {
    expect(REGISTRY['encoder']!.attachmentKind).toBe('pins');
    expect(REGISTRY['encoder']!.pinCount).toBe(3);
    expect(REGISTRY['encoder']!.declaredClassName).toBe('Encoder');
    expect(REGISTRY['encoder']!.primitive).toBe('delta');
  });

  it('declares sdcard as a bus-attached device with no per-instance class or primitive (FR-DEV-10)', () => {
    expect(REGISTRY['sdcard']!.attachmentKind).toBe('bus');
    expect(REGISTRY['sdcard']!.declaredClassName).toBeNull();
    expect(REGISTRY['sdcard']!.primitive).toBeUndefined();
    expect(REGISTRY['sdcard']!.peripheralCodegen).toBeDefined();
  });

  it('declares oled as a bus-attached device with more than one candidate bus (FR-DEV-14)', () => {
    expect(REGISTRY['oled']!.attachmentKind).toBe('bus');
    expect(REGISTRY['oled']!.declaredClassName).toBeNull();
    expect(REGISTRY['oled']!.primitive).toBeUndefined();
    expect(REGISTRY['oled']!.peripheralCodegen).toBeDefined();
    expect(REGISTRY['oled']!.busChoices).toEqual(['SPI1', 'I2C1']);
  });

  it('declares midiTrs as a bus-attached device fixed to USART1 (FR-DEV-16)', () => {
    expect(REGISTRY['midiTrs']!.attachmentKind).toBe('bus');
    expect(REGISTRY['midiTrs']!.bus).toBe('USART1');
    expect(REGISTRY['midiTrs']!.declaredClassName).toBeNull();
    expect(REGISTRY['midiTrs']!.primitive).toBeUndefined();
    expect(REGISTRY['midiTrs']!.peripheralCodegen).toBeDefined();
  });

  it('declares midiUsb as a bus-attached device with INTERNAL/USB_HS_D mode choices (FR-DEV-17)', () => {
    expect(REGISTRY['midiUsb']!.attachmentKind).toBe('bus');
    expect(REGISTRY['midiUsb']!.busChoices).toEqual(['INTERNAL', 'USB_HS_D']);
    expect(REGISTRY['midiUsb']!.declaredClassName).toBeNull();
    expect(REGISTRY['midiUsb']!.primitive).toBeUndefined();
    expect(REGISTRY['midiUsb']!.peripheralCodegen).toBeDefined();
  });
});

describe('wiredControlIds (FR-DEV-10)', () => {
  it('includes every pin/pins-attached device', () => {
    const ids = wiredControlIds();
    expect(ids).toContain('pot');
    expect(ids).toContain('button');
    expect(ids).toContain('led');
    expect(ids).toContain('toggle');
    expect(ids).toContain('rgbled');
    expect(ids).toContain('encoder');
  });

  it('excludes bus-attached peripherals', () => {
    expect(wiredControlIds()).not.toContain('sdcard');
    expect(wiredControlIds()).not.toContain('oled');
  });
});

// The DoD's own acceptance test: adding a registry entry must surface it in
// the parser, both editors' generated HTML and the codegen writer without
// editing any of those files again. Mutates the live REGISTRY (the actual
// single source of truth every consumer reads) rather than a copy, so this
// only passes if consumers really re-read the registry instead of caching a
// hardcoded snapshot.
describe('adding a registry entry surfaces it everywhere (FR-DEV-2)', () => {
  // Was literally 'toggle' before M44 — now a real registry entry (FR-DEV-7),
  // so this placeholder id had to move to something that will never collide
  // with a real device kind.
  const FAKE_ID = 'fakekind';

  afterEach(() => {
    delete REGISTRY[FAKE_ID];
  });

  function addFakeDevice(): void {
    REGISTRY[FAKE_ID] = {
      id: FAKE_ID,
      label: 'Fakekind',
      primitive: 'latching',
      accent: { dark: '#abc123', light: '#123abc' },
      pinFill: '#111222',
      declaredClassName: 'FakeKindSwitch',
      attachmentKind: 'pin',
      initArgs: 'false',
    };
  }

  it('surfaces in the annotation parser', () => {
    addFakeDevice();
    const source = [
      '// ds-ide:controls:begin',
      '// ds-ide: id=sw1, kind=fakekind, pin=5',
      '// ds-ide:controls:end',
    ].join('\n');
    const result = parseControlsConvention(source);
    expect(result.errors).toEqual([]);
    expect(result.controls).toEqual([{ id: 'sw1', kind: 'fakekind', pin: 5 }]);
  });

  it('surfaces in the Wiring Editor CSS and palette chip', () => {
    addFakeDevice();
    const html = buildWiringHtml([], [], 'test-nonce', 'vscode-resource://x.js');
    expect(html).toContain('.pin-fakekind');
    expect(html).toContain('var(--ds-accent-fakekind)');
    expect(html).not.toContain('#abc123');
    expect(html).toContain('#111222');
    expect(html).toContain('data-device="fakekind"');
    expect(html).toContain('Fakekind');
  });

  it('surfaces in the Controls Editor card CSS', () => {
    addFakeDevice();
    const html = buildControlsHtml('test-nonce', 'vscode-resource://x.js');
    expect(html).toContain('.ctrl-card[data-kind="fakekind"]');
    expect(html).toContain('var(--ds-accent-fakekind)');
  });

  it('surfaces in controls-writer.ts codegen via declaredClassName', () => {
    addFakeDevice();
    // 'fakekind' isn't part of the compile-time DeviceType union (only the
    // shipped devices are) — the cast mirrors how a real new device's literal
    // type would be added to registry.ts alongside its REGISTRY entry; this
    // test only needs the runtime behavior.
    const decl = declarationLine('sw1', FAKE_ID as DeviceType, 5);
    expect(decl).toBe('FakeKindSwitch sw1; // ds-ide: id=sw1, kind=fakekind, pin=5');
  });
});

// A bus-attached peripheral (sdcard) is enabled/disabled from the Wiring
// Editor's Peripherals section (FR-DEV-11), never by clicking an arbitrary
// pin — so it must not leak into either editor's pin/palette pickers, which
// enumerate wiredControlIds() (pin/pins-attached only), not every registry id.
describe('bus-attached peripherals are excluded from pin/palette pickers (FR-DEV-10)', () => {
  it('sdcard gets no per-pin device CSS class in the Wiring Editor', () => {
    const html = buildWiringHtml([], [], 'test-nonce', 'vscode-resource://x.js');
    expect(html).not.toContain('.pin-sdcard');
  });

  it('sdcard has no control-card style in the Controls Editor', () => {
    const html = buildControlsHtml('test-nonce', 'vscode-resource://x.js');
    expect(html).not.toContain('data-kind="sdcard"');
  });
});

// FR-THM-3: each device's accent is a dark/light pair; the light variant must
// read on Light+'s white editor background and the dark one on Dark+'s #1e1e1e.
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe('device accent variants (FR-THM-3)', () => {
  const HEX = /^#[0-9a-f]{6}$/i;

  it.each(Object.values(REGISTRY).map(d => [d.id, d] as const))(
    '%s has dark and light hex variants that reach WCAG 3:1 on their theme background',
    (_id, d) => {
      expect(d.accent.dark).toMatch(HEX);
      expect(d.accent.light).toMatch(HEX);
      expect(contrastRatio(d.accent.light, '#ffffff')).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(d.accent.dark, '#1e1e1e')).toBeGreaterThanOrEqual(3);
    },
  );

  it('accentVar names the per-device CSS variable', () => {
    expect(accentVar('pot')).toBe('var(--ds-accent-pot)');
  });

  it('a device without both variants fails to type-check', () => {
    // @ts-expect-error — `accent.light` is required
    const missingLight: DeviceDescriptor['accent'] = { dark: '#000000' };
    expect(missingLight.dark).toBe('#000000');
  });
});
