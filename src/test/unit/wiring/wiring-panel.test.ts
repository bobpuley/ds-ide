import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildHtml, PIN_DEFS, WiredPin, expandToWiredPins } from '../../../wiring/wiring-panel';
import type { ConventionControl } from '../../../controllers/controls-convention-parser';

// ── PIN_DEFS integrity ───────────────────────────────────────────────────────

describe('PIN_DEFS', () => {
  it('has exactly 40 entries', () => {
    expect(PIN_DEFS).toHaveLength(40);
  });

  it('has 20 left-side and 20 right-side entries', () => {
    expect(PIN_DEFS.filter(d => d.side === 'L')).toHaveLength(20);
    expect(PIN_DEFS.filter(d => d.side === 'R')).toHaveLength(20);
  });

  it('contains all D0–D30 exactly once', () => {
    const pins = PIN_DEFS.filter(d => d.pin !== null).map(d => d.pin as number);
    for (let p = 0; p <= 30; p++) {
      expect(pins.filter(x => x === p)).toHaveLength(1);
    }
  });

  it('marks D15–D25 (A0–A10) and D28 (A11) as ADC-capable (per Seed_pinout.csv)', () => {
    const adcPins = PIN_DEFS.filter(d => d.adc).map(d => d.pin);
    for (let p = 15; p <= 25; p++) expect(adcPins).toContain(p);
    expect(adcPins).toContain(28);
  });

  it('does not mark D0–D14, D26, D27, D29, D30 as ADC-capable (per Seed_pinout.csv)', () => {
    const nonAdcDigital = PIN_DEFS.filter(d => d.pin !== null && !d.adc).map(d => d.pin as number);
    for (let p = 0; p <= 14; p++) expect(nonAdcDigital).toContain(p);
    expect(nonAdcDigital).toContain(26);
    expect(nonAdcDigital).toContain(27);
    expect(nonAdcDigital).toContain(29);
    expect(nonAdcDigital).toContain(30);
  });

  it('ADC pins have an aLabel', () => {
    PIN_DEFS.filter(d => d.adc).forEach(d => {
      expect(d.aLabel).toBeTruthy();
    });
  });

  it('left-side row 0 is D0 and row 1 is D1 (AC-57 — USB end at top)', () => {
    const left = PIN_DEFS.filter(d => d.side === 'L').sort((a, b) => a.row - b.row);
    expect(left[0]!.label).toBe('D0');
    expect(left[0]!.pin).toBe(0);
    expect(left[1]!.label).toBe('D1');
    expect(left[1]!.pin).toBe(1);
  });

  it('right-side row 0 is GND, row 1 is VIN, row 2 is 3V3D, row 3 is D30 (AC-57)', () => {
    const right = PIN_DEFS.filter(d => d.side === 'R').sort((a, b) => a.row - b.row);
    expect(right[0]!.label).toBe('GND');
    expect(right[0]!.pin).toBeNull();
    expect(right[1]!.label).toBe('VIN');
    expect(right[2]!.label).toBe('3V3D');
    expect(right[3]!.label).toBe('D30');
    expect(right[3]!.pin).toBe(30);
  });

  it('D26 is not ADC-capable and D28 is A11 (AC-57, per Seed_pinout.csv)', () => {
    const d26 = PIN_DEFS.find(d => d.pin === 26)!;
    const d28 = PIN_DEFS.find(d => d.pin === 28)!;
    expect(d26.adc).toBe(false);
    expect(d26.aLabel).toBeNull();
    expect(d28.adc).toBe(true);
    expect(d28.aLabel).toBe('A11');
  });
});

// ── expandToWiredPins (FR-DEV-8/9 regression) ────────────────────────────────

describe('expandToWiredPins', () => {
  it('maps a single-pin control to one WiredPin', () => {
    const controls: ConventionControl[] = [{ id: 'vol', kind: 'pot', pin: 15 }];
    expect(expandToWiredPins(controls)).toEqual([{ pinNumber: 15, deviceType: 'pot', id: 'vol' }]);
  });

  // Regression: extension.ts used to have three independent inline copies of
  // this mapping; one still used `pinNumber: c.pin` only after rgbled/encoder
  // landed, so the Wiring Editor's display collapsed a 3-pin instance down to
  // its primary pin the moment a save re-triggered that code path.
  it('expands a pins-attachment control into one WiredPin per physical pin, all sharing its id', () => {
    const controls: ConventionControl[] = [{ id: 'rgb1', kind: 'rgbled', pin: 5, pins: [5, 6, 7] }];
    expect(expandToWiredPins(controls)).toEqual([
      { pinNumber: 5, deviceType: 'rgbled', id: 'rgb1' },
      { pinNumber: 6, deviceType: 'rgbled', id: 'rgb1' },
      { pinNumber: 7, deviceType: 'rgbled', id: 'rgb1' },
    ]);
  });

  it('mixes single- and multi-pin controls correctly', () => {
    const controls: ConventionControl[] = [
      { id: 'vol', kind: 'pot', pin: 15 },
      { id: 'enc1', kind: 'encoder', pin: 5, pins: [5, 6, 7] },
    ];
    const result = expandToWiredPins(controls);
    expect(result).toHaveLength(4);
    expect(result.filter(p => p.id === 'enc1')).toHaveLength(3);
    expect(result.filter(p => p.id === 'vol')).toHaveLength(1);
  });
});

// ── buildHtml structure ──────────────────────────────────────────────────────

describe('buildHtml', () => {
  const TEST_NONCE = 'test-nonce-abc123';
  const html = buildHtml([], [], TEST_NONCE, 'vscode-resource://test/webview/wiring-webview.js');

  it('contains DOCTYPE and lang', () => {
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('lang="en"');
  });

  it('contains CSP meta tag with nonce (FR-ES-1)', () => {
    expect(html).toContain(`<meta http-equiv="Content-Security-Policy"`);
    expect(html).toContain(`nonce-${TEST_NONCE}`);
  });

  it('has nonce attribute on script tag (FR-ES-1)', () => {
    expect(html).toContain(`<script nonce="${TEST_NONCE}" src=`);
  });

  it('contains SVG with id pinout', () => {
    expect(html).toContain('id="pinout"');
  });

  it('contains board body rect', () => {
    expect(html).toContain('class="board-body"');
  });

  it('contains DAISY SEED label', () => {
    expect(html).toContain('DAISY');
    expect(html).toContain('SEED');
  });

  it('contains popup element', () => {
    expect(html).toContain('id="popup"');
  });

  it('contains Pot / Button / LED buttons', () => {
    expect(html).toContain('id="btn-pot"');
    expect(html).toContain('id="btn-button"');
    expect(html).toContain('id="btn-led"');
  });

  it('contains id input and error', () => {
    expect(html).toContain('id="id-input"');
    expect(html).toContain('id="id-error"');
  });

  it('contains Remove button', () => {
    expect(html).toContain('id="popup-remove"');
  });

  it('contains non-ADC pin warning badge', () => {
    expect(html).toContain('id="pot-warn"');
    expect(html).toContain('non-ADC pin');
  });

  it('serialises PIN_DEFS as JSON in script', () => {
    expect(html).toContain('"side"');
    expect(html).toContain('"adc"');
  });

  it('embeds initial wiredPins from init-data script tag', () => {
    const html2 = buildHtml([{ pinNumber: 15, deviceType: 'pot', id: 'vol' }], [], TEST_NONCE, 'vscode-resource://test/webview/wiring-webview.js');
    expect(html2).toContain('"pinNumber":15');
    expect(html2).toContain('"id":"vol"');
  });

  it('escapes </ in JSON data island to prevent XSS', () => {
    const dangerous = buildHtml([{ pinNumber: 15, deviceType: 'pot', id: '</script><script>alert(1)</script>' }], [], TEST_NONCE, 'vscode-resource://test/webview/wiring-webview.js');
    expect(dangerous).not.toContain('</script><script>');
  });

  it('escapes < and > in pin ID to prevent HTML injection (AC-70)', () => {
    const html = buildHtml([{ pinNumber: 15, deviceType: 'pot', id: '<script>alert(1)</script>' }], [], TEST_NONCE, 'vscode-resource://test/webview/wiring-webview.js');
    // The user-supplied payload must not appear verbatim in the HTML
    expect(html).not.toContain('<script>alert(1)');
    expect(html).not.toContain('</script><');  // no break-out sequence
    // Encoded form must be present (proves the value is in the JSON island, just safely encoded)
    expect(html).toContain('\\u003c');
  });

  it('escapes & in pin ID to prevent entity injection (AC-70)', () => {
    const html = buildHtml([{ pinNumber: 15, deviceType: 'pot', id: 'vol&amp;gain' }], [], TEST_NONCE, 'vscode-resource://test/webview/wiring-webview.js');
    expect(html).not.toContain('vol&amp;gain');
    expect(html).not.toContain('&amp;');
  });

  // T19-5 — USB port indicator (AC-30)
  it('contains usb-port polygon shape (T19-5)', () => {
    expect(html).toContain('usb-port');
  });
});

// ── Peripherals section (FR-DEV-11) ──────────────────────────────────────────

describe('buildHtml Peripherals section', () => {
  const TEST_NONCE = 'test-nonce-abc123';

  it('contains a peripherals list container', () => {
    const html = buildHtml([], [], TEST_NONCE, 'vscode-resource://test/webview/wiring-webview.js');
    expect(html).toContain('id="periph-list"');
  });

  it('embeds initial peripheral state from a data island', () => {
    const peripherals = [{ id: 'sdcard', label: 'SD Card', enabled: false, bus: 'SDMMC1', pins: [1, 2, 3, 4, 5, 6].map(pin => ({ pin, signal: null })) }];
    const html = buildHtml([], peripherals, TEST_NONCE, 'vscode-resource://test/webview/wiring-webview.js');
    expect(html).toContain('"id":"sdcard"');
    expect(html).toContain('"enabled":false');
  });

  it('escapes < and > in a peripheral label to prevent HTML injection', () => {
    const peripherals = [{ id: 'sdcard', label: '<script>alert(1)</script>', enabled: false, bus: 'SDMMC1', pins: [] }];
    const html = buildHtml([], peripherals, TEST_NONCE, 'vscode-resource://test/webview/wiring-webview.js');
    expect(html).not.toContain('<script>alert(1)');
    expect(html).toContain('\\u003c');
  });
});

// ── Bus bracket tooltip/popover containers (FR-DEV-12) ───────────────────────

describe('buildHtml bus bracket tooltip/popover', () => {
  const TEST_NONCE = 'test-nonce-abc123';
  const html = buildHtml([], [], TEST_NONCE, 'vscode-resource://test/webview/wiring-webview.js');

  it('contains a tooltip container', () => {
    expect(html).toContain('id="tooltip"');
  });

  it('contains a bus popover container', () => {
    expect(html).toContain('id="bus-popover"');
  });
});

