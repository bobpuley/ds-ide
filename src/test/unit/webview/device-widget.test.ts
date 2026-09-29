import { describe, it, expect, vi } from 'vitest';
import {
  widgetHtml, potState, encoderState, toggleState, rgbState, applyVars, ENCODER_VISIBLE_DETENTS,
} from '../../../webview/controls/device-widget';
import { CONTROL_ART_HOOKS } from '../../../wiring/device-icons';

describe('potState (FR-CWS-2)', () => {
  it('maps the value to the --v variable and reports the clamped value', () => {
    expect(potState(0.5)).toEqual({ value: 0.5, vars: { '--v': '0.5' } });
  });
  it('clamps to [0, 1]', () => {
    expect(potState(-3).value).toBe(0);
    expect(potState(2).vars['--v']).toBe('1');
  });
});

describe('encoderState (FR-CWS-2)', () => {
  it('shows the position on the 32 visual detents', () => {
    expect(ENCODER_VISIBLE_DETENTS).toBe(32);
    expect(encoderState(0).vars['--e']).toBe('0');
    expect(encoderState(35).vars['--e']).toBe('3');
    expect(encoderState(32).vars['--e']).toBe('0');
  });
  it('wraps a negative position onto the dial', () => {
    expect(encoderState(-1).vars['--e']).toBe('31');
  });
});

describe('toggleState (FR-CWS-2)', () => {
  it.each([0, 1, 2])('position %i → --p', p => {
    expect(toggleState(p).vars['--p']).toBe(String(p));
  });
});

describe('rgbState (FR-CWS-2)', () => {
  it('builds a color(srgb …) value from 0..1 channels and shows the lens', () => {
    expect(rgbState(1, 0.5, 0).vars).toEqual({ '--c': 'color(srgb 1 0.5 0)', '--co': '1' });
  });
  it('clamps channels to [0, 1]', () => {
    expect(rgbState(2, -1, 0.25).vars['--c']).toBe('color(srgb 1 0 0.25)');
  });
  it('hides the lens when every channel is off', () => {
    expect(rgbState(0, 0, 0).vars['--co']).toBe('0');
  });
});

describe('applyVars', () => {
  it('sets every variable on the element', () => {
    const el = { style: { setProperty: vi.fn() } };
    applyVars(el, { '--v': '0.5', '--e': '3' });
    expect(el.style.setProperty).toHaveBeenCalledWith('--v', '0.5');
    expect(el.style.setProperty).toHaveBeenCalledWith('--e', '3');
  });
});

describe('widgetHtml (FR-CWS-2)', () => {
  it('pot: knob root with channel, value readout and the pointer hook', () => {
    const html = widgetHtml('pot', { pin: 15, channel: 0 });
    expect(html).toMatch(/<div class="knob-wrap" data-channel="0" data-value="0" style="--v:0">/);
    expect(html).toContain('data-part="pointer"');
    expect(html).toContain('<span class="knob-value">0.000</span>');
  });
  it('button: a released button root holding the cap', () => {
    const html = widgetHtml('button', { pin: 5 });
    expect(html).toMatch(/<button class="btn-ce" type="button" data-pin="5" aria-pressed="false">/);
    expect(html).toContain('data-part="cap"');
  });
  it('toggle: button root at position 0 with a position readout that is not the art', () => {
    const html = widgetHtml('toggle', { pin: 6 });
    expect(html).toMatch(/<button class="tgl-ce" type="button" data-pin="6" data-pos="0" style="--p:0">/);
    expect(html).toContain('data-part="lever"');
    expect(html).toContain('<span class="tgl-pos">0</span>');
  });
  it('encoder: dial root at position 0 with a readout', () => {
    const html = widgetHtml('encoder', { pin: 7 });
    expect(html).toMatch(/<div class="enc-wrap" data-pos="0" style="--e:0">/);
    expect(html).toContain('<span class="enc-value">0</span>');
  });
  it('led: unlit LED root keyed by pin', () => {
    const html = widgetHtml('led', { pin: 22 });
    expect(html).toMatch(/<span class="vled-dot" data-pin="22">/);
    expect(html).toContain('data-part="glow"');
  });
  it('rgbled: lens hidden until the emulator sends a colour', () => {
    const html = widgetHtml('rgbled', { pin: 8 });
    expect(html).toMatch(/<span class="vrgb-dot" data-pin="8" style="--co:0">/);
  });
  it('unknown kinds fall back to the LED widget, as the previous card body did', () => {
    expect(widgetHtml('servo', { pin: 3 })).toMatch(/class="vled-dot"/);
  });
  it.each(Object.entries(CONTROL_ART_HOOKS))('%s widget carries every hook the art declares', (kind, parts) => {
    const html = widgetHtml(kind, { pin: 1, channel: 0 });
    for (const part of parts) expect(html).toContain(`data-part="${part}"`);
    expect(html).toContain('class="icon icon-live"');
  });
});
