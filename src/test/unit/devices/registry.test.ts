import { describe, it, expect, afterEach } from 'vitest';
import { REGISTRY, DEVICE_TYPES, isDeviceType, DeviceType } from '../../../devices/registry';
import { parseControlsConvention } from '../../../controllers/controls-convention-parser';
import { buildHtml as buildWiringHtml } from '../../../wiring/wiring-panel';
import { buildHtml as buildControlsHtml } from '../../../sidebar/controls-editor-panel';
import { declarationLine } from '../../../wiring/controls-writer';

describe('REGISTRY (FR-DEV-2)', () => {
  it('lists pot, button, led, toggle, rgbled and encoder', () => {
    expect([...DEVICE_TYPES].sort()).toEqual(['button', 'encoder', 'led', 'pot', 'rgbled', 'toggle']);
  });

  it('isDeviceType recognizes registered kinds and rejects others', () => {
    expect(isDeviceType('pot')).toBe(true);
    expect(isDeviceType('servo')).toBe(false);
  });

  it('declares pot, button, led and toggle as pin-attached (FR-DEV-3)', () => {
    expect(REGISTRY['pot']!.attachmentKind).toBe('pin');
    expect(REGISTRY['button']!.attachmentKind).toBe('pin');
    expect(REGISTRY['led']!.attachmentKind).toBe('pin');
    expect(REGISTRY['toggle']!.attachmentKind).toBe('pin');
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
      accentColor: '#abc123',
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

  it('surfaces in the Wiring Editor CSS and popup button', () => {
    addFakeDevice();
    const html = buildWiringHtml([], 'test-nonce', 'vscode-resource://x.js');
    expect(html).toContain('.pin-fakekind');
    expect(html).toContain('#abc123');
    expect(html).toContain('#111222');
    expect(html).toContain('id="btn-fakekind"');
    expect(html).toContain('Fakekind');
  });

  it('surfaces in the Controls Editor palette CSS and button', () => {
    addFakeDevice();
    const html = buildControlsHtml('test-nonce', 'vscode-resource://x.js');
    expect(html).toContain('data-kind="fakekind"');
    expect(html).toContain('#abc123');
    expect(html).toContain('Fakekind');
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
