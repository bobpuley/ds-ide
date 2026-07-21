import { describe, it, expect, afterEach } from 'vitest';
import { REGISTRY, DEVICE_TYPES, isDeviceType, DeviceType } from '../../../devices/registry';
import { parseControlsConvention } from '../../../controllers/controls-convention-parser';
import { buildHtml as buildWiringHtml } from '../../../wiring/wiring-panel';
import { buildHtml as buildControlsHtml } from '../../../sidebar/controls-editor-panel';
import { declarationLine } from '../../../wiring/controls-writer';

describe('REGISTRY (FR-DEV-2)', () => {
  it('lists pot, button and led', () => {
    expect([...DEVICE_TYPES].sort()).toEqual(['button', 'led', 'pot']);
  });

  it('isDeviceType recognizes registered kinds and rejects others', () => {
    expect(isDeviceType('pot')).toBe(true);
    expect(isDeviceType('encoder')).toBe(false);
  });

  it('declares pot, button and led as pin-attached (FR-DEV-3)', () => {
    expect(REGISTRY['pot']!.attachmentKind).toBe('pin');
    expect(REGISTRY['button']!.attachmentKind).toBe('pin');
    expect(REGISTRY['led']!.attachmentKind).toBe('pin');
  });
});

// The DoD's own acceptance test: adding a registry entry must surface it in
// the parser, both editors' generated HTML and the codegen writer without
// editing any of those files again. Mutates the live REGISTRY (the actual
// single source of truth every consumer reads) rather than a copy, so this
// only passes if consumers really re-read the registry instead of caching a
// hardcoded snapshot.
describe('adding a registry entry surfaces it everywhere (FR-DEV-2)', () => {
  const FAKE_ID = 'toggle';

  afterEach(() => {
    delete REGISTRY[FAKE_ID];
  });

  function addFakeDevice(): void {
    REGISTRY[FAKE_ID] = {
      id: FAKE_ID,
      label: 'Toggle',
      primitive: 'latching',
      accentColor: '#abc123',
      pinFill: '#111222',
      declaredClassName: 'ToggleSwitch',
      attachmentKind: 'pin',
      initArgs: 'false',
    };
  }

  it('surfaces in the annotation parser', () => {
    addFakeDevice();
    const source = [
      '// ds-ide:controls:begin',
      '// ds-ide: id=sw1, kind=toggle, pin=5',
      '// ds-ide:controls:end',
    ].join('\n');
    const result = parseControlsConvention(source);
    expect(result.errors).toEqual([]);
    expect(result.controls).toEqual([{ id: 'sw1', kind: 'toggle', pin: 5 }]);
  });

  it('surfaces in the Wiring Editor CSS and popup button', () => {
    addFakeDevice();
    const html = buildWiringHtml([], 'test-nonce', 'vscode-resource://x.js');
    expect(html).toContain('.pin-toggle');
    expect(html).toContain('#abc123');
    expect(html).toContain('#111222');
    expect(html).toContain('id="btn-toggle"');
    expect(html).toContain('Toggle');
  });

  it('surfaces in the Controls Editor palette CSS and button', () => {
    addFakeDevice();
    const html = buildControlsHtml('test-nonce', 'vscode-resource://x.js');
    expect(html).toContain('data-kind="toggle"');
    expect(html).toContain('#abc123');
    expect(html).toContain('Toggle');
  });

  it('surfaces in controls-writer.ts codegen via declaredClassName', () => {
    addFakeDevice();
    // 'toggle' isn't part of the compile-time DeviceType union (only pot/
    // button/led are, for this milestone) — the cast mirrors how a real new
    // device's literal type would be added to registry.ts alongside its
    // REGISTRY entry; this test only needs the runtime behavior.
    const decl = declarationLine('sw1', FAKE_ID as DeviceType, 5);
    expect(decl).toBe('ToggleSwitch sw1; // ds-ide: id=sw1, kind=toggle, pin=5');
  });
});
