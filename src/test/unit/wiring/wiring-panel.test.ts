import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildHtml, WiringPanel, PIN_DEFS, WiredPin } from '../../../wiring/wiring-panel';

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
    expect(left[0].label).toBe('D0');
    expect(left[0].pin).toBe(0);
    expect(left[1].label).toBe('D1');
    expect(left[1].pin).toBe(1);
  });

  it('right-side row 0 is GND, row 1 is VIN, row 2 is 3V3D, row 3 is D30 (AC-57)', () => {
    const right = PIN_DEFS.filter(d => d.side === 'R').sort((a, b) => a.row - b.row);
    expect(right[0].label).toBe('GND');
    expect(right[0].pin).toBeNull();
    expect(right[1].label).toBe('VIN');
    expect(right[2].label).toBe('3V3D');
    expect(right[3].label).toBe('D30');
    expect(right[3].pin).toBe(30);
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

// ── buildHtml structure ──────────────────────────────────────────────────────

describe('buildHtml', () => {
  const html = buildHtml([]);

  it('contains DOCTYPE and lang', () => {
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('lang="en"');
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
    const html2 = buildHtml([{ pinNumber: 15, deviceType: 'pot', id: 'vol' }]);
    expect(html2).toContain('"pinNumber":15');
    expect(html2).toContain('"id":"vol"');
  });

  it('escapes </ in JSON data island to prevent XSS', () => {
    // safeJson should replace </ with <\/ inside embedded JSON values
    // so a value containing "</script>" cannot break out of the script tag.
    const dangerous = buildHtml([{ pinNumber: 15, deviceType: 'pot', id: '</script><script>alert(1)</script>' }]);
    // The dangerous string should be escaped
    expect(dangerous).not.toContain('</script><script>');
  });

  // T19-4 — ID label repositioning (AC-29)
  it('assigned-id label uses connector-zone x (126 or 434), not pin circle cx (T19-4)', () => {
    expect(html).toContain('labelX');
    expect(html).toContain('126');
    expect(html).toContain('434');
  });

  it('assigned-id label y is cy-7, not cy+22 (T19-4)', () => {
    expect(html).toContain('cy - 7');
    expect(html).not.toContain('cy + 22');
  });

  // T19-5 — USB port indicator (AC-30)
  it('contains usb-port polygon shape (T19-5)', () => {
    expect(html).toContain('usb-port');
  });
});

// ── WiringPanel show / dispose / postWiredPins ───────────────────────────────

describe('WiringPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a webview panel on first show()', async () => {
    const panel = new WiringPanel();
    panel.show([]);
    const vscode = (await import('vscode'));
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
      'daisy-wiring',
      'Daisy Seed Wiring',
      expect.anything(),
      expect.objectContaining({ enableScripts: true }),
    );
    panel.dispose();
  });

  it('reveals existing panel on second show()', async () => {
    const panel = new WiringPanel();
    const vscode = (await import('vscode'));
    panel.show([]);
    const mockPanel = (vscode.window.createWebviewPanel as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    vi.clearAllMocks();
    panel.show([]);
    expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled();
    expect(mockPanel.reveal).toHaveBeenCalled();
    panel.dispose();
  });

  it('postWiredPins sends wiredPins message', async () => {
    const panel = new WiringPanel();
    const vscode = (await import('vscode'));
    panel.show([]);
    const mockPanel = (vscode.window.createWebviewPanel as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    const pins: WiredPin[] = [{ pinNumber: 15, deviceType: 'pot', id: 'vol' }];
    panel.postWiredPins(pins);
    expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'wiredPins', pins }),
    );
    panel.dispose();
  });

  it('dispose closes the panel', async () => {
    const panel = new WiringPanel();
    const vscode = (await import('vscode'));
    panel.show([]);
    const mockPanel = (vscode.window.createWebviewPanel as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    panel.dispose();
    expect(mockPanel.dispose).toHaveBeenCalled();
  });

  it('calls onWirePin when wirePin message received', async () => {
    const onWire = vi.fn().mockResolvedValue(undefined);
    const panel  = new WiringPanel(onWire);
    const vscode = (await import('vscode'));
    panel.show([]);
    const mockPanel = (vscode.window.createWebviewPanel as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    // Simulate message from webview
    const handler = (mockPanel.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    await handler?.({ command: 'wirePin', pinNumber: 15, deviceType: 'pot', id: 'vol' });
    expect(onWire).toHaveBeenCalledWith({ pinNumber: 15, deviceType: 'pot', id: 'vol' });
    panel.dispose();
  });

  it('calls onUnwirePin when unwirePin message received', async () => {
    const onUnwire = vi.fn().mockResolvedValue(undefined);
    const panel    = new WiringPanel(undefined, onUnwire);
    const vscode   = (await import('vscode'));
    panel.show([]);
    const mockPanel = (vscode.window.createWebviewPanel as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    const handler = (mockPanel.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    await handler?.({ command: 'unwirePin', pinNumber: 15, id: 'vol' });
    expect(onUnwire).toHaveBeenCalledWith(15, 'vol');
    panel.dispose();
  });
});
