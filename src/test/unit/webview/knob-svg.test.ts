import { describe, it, expect } from 'vitest';
import { knobSvg, encoderSvg } from '../../../webview/controls/knob-svg';

describe('knob / encoder SVG theming (FR-THM-1, FR-THM-3, FR-THM-5)', () => {
  it('knob uses theme variables only — no colour literals — so it repaints with the theme', () => {
    const svg = knobSvg(0.5);
    expect(svg).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(svg).not.toMatch(/\brgba?\(|\bhsla?\(/);
    expect(svg).toContain('var(--ds-surface)');
    expect(svg).toContain('var(--ds-border)');
  });

  it('knob value arc and dot use the pot accent', () => {
    const svg = knobSvg(0.5);
    expect(svg).toMatch(/class="knob-value-path"[^>]*var\(--ds-accent-pot\)/);
    expect(svg).toMatch(/class="knob-dot"[^>]*var\(--ds-accent-pot\)/);
  });

  it('hides the value arc at zero', () => {
    expect(knobSvg(0)).toMatch(/class="knob-value-path"[^>]*display:none/);
  });

  it('encoder uses theme variables and the encoder accent', () => {
    const svg = encoderSvg(3);
    expect(svg).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(svg).toContain('var(--ds-accent-encoder)');
    expect(svg).toContain('var(--ds-surface)');
  });
});
