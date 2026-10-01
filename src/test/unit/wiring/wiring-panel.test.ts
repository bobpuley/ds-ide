import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildHtml, PIN_DEFS, WiredPin, expandToWiredPins, paletteRequirement, legendEntries } from '../../../wiring/wiring-panel';
import { wiredControlIds } from '../../../devices/registry';
import { REGISTRY } from '../../../devices/registry';
import { deviceIconSvg, DEVICE_ICONS } from '../../../wiring/device-icons';
import { themeCss } from '../../../webview/theme/theme-css';
import { BOARD_ART_CSS } from '../../../wiring/board-art';
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

  // FR-UDM-10: the click-a-free-pin assign popup is gone — the palette,
  // drag and the device popover are the only placement surfaces.
  it('has no click-a-free-pin assign popup (FR-UDM-10)', () => {
    expect(html).not.toContain('id="popup"');
    expect(html).not.toContain('id="popup-assign"');
    expect(html).not.toContain('id="btn-pot"');
    expect(html).not.toContain('id="id-input"');
  });

  it('free pins are inert: no pointer cursor or hover highlight (FR-UDM-10)', () => {
    expect(html).not.toMatch(/\.pin-dot\s*\{\s*cursor:\s*pointer/);
    expect(html).not.toMatch(/\.pin-dot:hover circle/);
    expect(html).toMatch(/\.pin-dot:not\(\.pin-unassigned\)\s*\{\s*cursor:\s*pointer/);
  });

  it('points the user at the palette in the hint (FR-UDM-10)', () => {
    expect(html).not.toContain('Click a free pin');
    expect(html).toContain('Drag a device from the palette');
  });

  // FR-UDM-3: one #device-popover replaces popup-assigned and #bus-popover.
  it('contains the unified device popover, not the old assigned/bus popovers (FR-UDM-3)', () => {
    expect(html).toContain('id="device-popover"');
    expect(html).not.toContain('popup-assigned');
    expect(html).not.toContain('id="popup-remove"');
    expect(html).not.toContain('bus-popover');
  });

  // FR-UDM-1: no device id is special-cased for pin suitability; with the
  // assign popup gone (FR-UDM-10) the palette chip shows the requirement.
  it('has no pot special case for pin suitability (FR-UDM-1)', () => {
    expect(html).not.toContain('pot-warn');
    expect(html).not.toContain('warn-badge');
    expect(html).toContain('<div class="meta">ADC pin</div>');
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

  // FR-DEV-17: the USB port graphic needs a stable id so wiring-webview.ts
  // can highlight it when a connector-attached peripheral in its zero-pin
  // mode (midiUsb's INTERNAL) is enabled — there's no pin to mark instead.
  it('groups the USB port graphic under an id for connector highlighting (FR-DEV-17)', () => {
    expect(html).toContain('id="usb-port-group"');
  });
});

// ── Peripherals section (FR-DEV-11) ──────────────────────────────────────────

describe('buildHtml Peripherals section', () => {
  const TEST_NONCE = 'test-nonce-abc123';

  it('has no Peripherals footer — checkbox list and View button are gone (FR-UDM-10)', () => {
    const html = buildHtml([], [], TEST_NONCE, 'vscode-resource://test/webview/wiring-webview.js');
    expect(html).not.toContain('id="peripherals"');
    expect(html).not.toContain('id="periph-list"');
    expect(html).not.toContain('periph-view-btn');
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

});


// ── Device palette (FR-UDM-5) ────────────────────────────────────────────────

describe('device palette (FR-UDM-5)', () => {
  const TEST_NONCE = 'test-nonce-abc123';
  const SCRIPT = 'vscode-resource://test/webview/wiring-webview.js';
  const html = buildHtml([], [], TEST_NONCE, SCRIPT);
  const section = (name: string): string => {
    const m = html.match(new RegExp(`<div class="pal-grp"[^>]*>${name}</div>([\\s\\S]*?)(?=<div class="pal-(?:grp|sep)"|</div>\\s*</div>\\s*<!-- /palette -->)`));
    return m?.[1] ?? '';
  };

  it('renders one draggable chip per registry device', () => {
    for (const id of Object.keys(REGISTRY)) {
      expect(html).toContain(`data-device="${id}"`);
    }
    expect(html.match(/class="device-chip"/g)).toHaveLength(Object.keys(REGISTRY).length);
  });

  it('groups controls and peripherals', () => {
    const controls = section('Controls');
    const peripherals = section('Peripherals · one each');
    for (const id of ['pot', 'button', 'led', 'toggle', 'rgbled', 'encoder']) {
      expect(controls).toContain(`data-device="${id}"`);
      expect(peripherals).not.toContain(`data-device="${id}"`);
    }
    for (const id of ['sdcard', 'oled', 'midiTrs', 'midiUsb']) {
      expect(peripherals).toContain(`data-device="${id}"`);
      expect(controls).not.toContain(`data-device="${id}"`);
    }
  });

  it('colours each chip with its device accent', () => {
    expect(html).toContain(`data-device="pot" style="--accent: var(--ds-accent-pot)"`);
    expect(html).toContain(`data-device="oled" style="--accent: var(--ds-accent-oled)"`);
  });

  it('carries a hover tip naming the device, for the collapsed rail', () => {
    expect(html).toContain('data-tip="RGB LED — 3 pins (R·G·B)"');
    // The rail uses the editor's own #tooltip; a native title would double it.
    expect(html).not.toMatch(/class="device-chip"[^>]*\stitle=/);
  });

  it('describes each device\'s attachment requirement', () => {
    expect(paletteRequirement('pot')).toBe('ADC pin');
    expect(paletteRequirement('button')).toBe('any GPIO pin');
    expect(paletteRequirement('rgbled')).toBe('3 pins (R·G·B)');
    expect(paletteRequirement('encoder')).toBe('3 pins (A·B·SW)');
    expect(paletteRequirement('sdcard')).toBe('SDMMC1');
    expect(paletteRequirement('oled')).toBe('SPI1 / I2C1');
    expect(paletteRequirement('midiTrs')).toBe('USART1');
    expect(paletteRequirement('midiUsb')).toBe('USB port / USB_HS_D');
    expect(html).toContain('<div class="meta">SPI1 / I2C1</div>');
  });

  it('renders every chip as an icon tile in a two-column grid (alt1 palette)', () => {
    expect(html.match(/<div class="pal-grid">/g)).toHaveLength(2);
    for (const id of Object.keys(REGISTRY)) {
      const chip = html.match(new RegExp(`<div class="device-chip" data-device="${id}"[^>]*>([\\s\\S]*?)<\\/div><!-- /chip -->`));
      expect(chip, id).not.toBeNull();
      expect(chip![1]).toContain('<svg class="icon" viewBox="0 0 48 48"');
      expect(chip![1]).toContain(`<div class="name">${REGISTRY[id]!.label}</div>`);
    }
  });

  it('marks a placed-capable (peripheral) chip with a hidden ✓ badge only', () => {
    expect(html).toMatch(/data-device="oled"[^>]*>[\s\S]*?<span class="badge">✓<\/span>/);
    expect(html).not.toMatch(/data-device="pot"[^>]*>(?:(?!<!-- \/chip -->)[\s\S])*class="badge"/);
  });

  it('lays the placement popover\'s confirm and Cancel side by side, not full-width (FR-UDM-7)', () => {
    expect(html).toMatch(/#device-popover \.dp-pair button\s*\{[^}]*flex: 1 1 0/);
  });

  it('has a collapse toggle', () => {
    expect(html).toContain('id="palette-toggle"');
    expect(html).toContain('id="palette-col"');
  });

  it('a device added to the registry appears with no Wiring Editor edit', () => {
    REGISTRY['servo'] = { ...REGISTRY['button']!, id: 'servo', label: 'Servo', accent: { dark: '#123456', light: '#654321' } };
    try {
      const withServo = buildHtml([], [], TEST_NONCE, SCRIPT);
      expect(withServo).toContain('data-device="servo" style="--accent: var(--ds-accent-servo)"');
    } finally {
      delete REGISTRY['servo'];
    }
  });
});

describe('device icons (alt1 palette)', () => {
  it('has an illustrated icon for every shipped registry device', () => {
    for (const id of Object.keys(REGISTRY)) expect(DEVICE_ICONS[id], id).toBeTruthy();
  });

  it('falls back to an accent-coloured dot for a device with no icon', () => {
    const svg = deviceIconSvg('servo', 'var(--ds-accent-servo)');
    expect(svg).toContain('<svg class="icon" viewBox="0 0 48 48"');
    expect(svg).toContain('style="fill:var(--ds-accent-servo)"');
  });

  it('escapes the fallback colour', () => {
    expect(deviceIconSvg('servo', '"><script>')).not.toContain('<script>');
  });
});

describe('Wiring Editor theming (FR-THM-1, FR-THM-3, FR-THM-4)', () => {
  const html = buildHtml([], [], 'test-nonce-abc123', 'vscode-resource://x.js');

  // Literals that are allowed: the shared theme block (accent palette), the
  // board art, the illustrated icons and the registry's pin fills.
  function ownMarkup(): string {
    let own = html.replace(themeCss({ surface: 'sidebar' }), '').replace(BOARD_ART_CSS, '');
    own = own.replace(/<svg class="icon"[\s\S]*?<\/svg>/g, '');
    for (const d of Object.values(REGISTRY)) own = own.split(d.pinFill).join('');
    return own;
  }

  it('includes the shared sidebar-surface theme block', () => {
    expect(html).toContain(themeCss({ surface: 'sidebar' }));
    expect(html).toContain('background: var(--ds-surface)');
  });

  it('has no hex / rgb() / hsl() colour literals outside the allow-list', () => {
    const own = ownMarkup();
    expect(own).not.toMatch(/(?<![&\w])#[0-9a-fA-F]{3,8}\b/);
    expect(own).not.toMatch(/\brgba?\(|\bhsla?\(/);
  });

  it('draws the board inside a themed frame with a contrast border', () => {
    expect(html).toMatch(/<div id="board-frame" class="ds-hc">\s*<svg id="pinout"/);
    expect(html).toMatch(/#board-frame\s*\{[^}]*var\(--ds-surface-raised\)[^}]*var\(--ds-border\)/);
  });

  it('keeps the board art colours from the board-art module', () => {
    expect(html).toContain(BOARD_ART_CSS);
    expect(BOARD_ART_CSS).toMatch(/\.board-body\s*\{[^}]*#/);
  });

  it('shows bus pins, brackets and the conflict hatch in the theme warning colour', () => {
    expect(html).toMatch(/\.pin-bus circle\s*\{[^}]*var\(--ds-warning-fg\)/);
    expect(html).toMatch(/\.bus-bracket\s*\{[^}]*var\(--ds-warning-fg\)/);
    expect(html).toMatch(/\.ctx-occ circle\s*\{[^}]*var\(--ds-warning-fg\)/);
    expect(html).toContain('class="hatch-a"');
  });

  it('marks the micro-USB indicator with the midiUsb accent when active', () => {
    expect(html).toMatch(/#usb-port-group\.active \.usb-port\s*\{[^}]*var\(--ds-accent-midiUsb\)/);
  });

  it('themes the popover and the cursor label', () => {
    expect(html).toMatch(/#device-popover\s*\{[^}]*var\(--ds-surface-raised\)/);
    expect(html).toMatch(/#ghost\s*\{[^}]*var\(--ds-surface-raised\)/);
    expect(html).toMatch(/#ghost\.warn \.tgt\s*\{\s*color:\s*var\(--ds-warning-fg\)/);
  });

  it('gives palette icons a fixed plate so the art reads on any theme', () => {
    expect(deviceIconSvg('pot', 'var(--ds-accent-pot)')).toMatch(/<svg class="icon"[^>]*><rect class="icon-plate"/);
  });
});


// ── Legend (FR-WLG-1) ────────────────────────────────────────────────────────

describe('pin legend (FR-WLG-1)', () => {
  const html = buildHtml([], [], 'n0nce', 'vscode-resource://test/wiring-webview.js');

  it('has an entry for every resting pin state the board draws', () => {
    const classes = legendEntries().flatMap(e => e.classes);
    expect(classes).toEqual(expect.arrayContaining(['pin-unassigned', 'pin-bus', 'pin-power']));
    for (const id of wiredControlIds()) expect(classes).toContain(`pin-${id}`);
  });

  it('gives every entry a text label, so colour is never the only cue', () => {
    for (const e of legendEntries()) expect(e.label.trim().length).toBeGreaterThan(0);
  });

  it('marks the ADC-capable state with its A-label sample', () => {
    expect(legendEntries().some(e => e.sample === 'A0')).toBe(true);
  });

  it('renders the legend in the page using the pins\' own classes', () => {
    expect(html).toContain('id="legend"');
    expect(html).toMatch(/id="legend"[\s\S]*class="pin-dot pin-bus"/);
  });

  it('uses no colour literals', () => {
    const legend = html.slice(html.indexOf('id="legend"'), html.indexOf('id="main"'));
    expect(legend).not.toMatch(/#[0-9a-fA-F]{3,6}\b|rgb\(|hsl\(/);
  });
});
