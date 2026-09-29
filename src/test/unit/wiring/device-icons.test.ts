import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { DEVICE_ICONS, CONTROL_ART_HOOKS, deviceIconSvg } from '../../../wiring/device-icons';

const CONTROL_KINDS = ['pot', 'button', 'led', 'toggle', 'encoder', 'rgbled'] as const;

// SHA-256 prefixes of the six control icons as shipped in M66/M68, before the
// hooks were added. Stripping the hooks must give back exactly that art, so
// the palette looks identical (FR-CWS-1).
const ORIGINAL_ART: Record<(typeof CONTROL_KINDS)[number], string> = {
  pot: '6d547793a8b7a4a0',
  button: 'fb1700f6aac3278e',
  led: '3d63cae108129aa5',
  toggle: '6c26b9abed5b5331',
  encoder: '93084e4675cd00ce',
  rgbled: '4019f256c6b04ecf',
};

const OVERLAY = /<circle data-part="lens" [^>]*fill-opacity="0"\/> ?/;

function withoutHooks(body: string): string {
  return body.replace(OVERLAY, '').replace(/ data-part="\w+"/g, '');
}

describe('control art hooks (FR-CWS-1)', () => {
  it.each(Object.entries(CONTROL_ART_HOOKS))('%s art carries the hooks its widget needs', (kind, parts) => {
    for (const part of parts) {
      expect(DEVICE_ICONS[kind], `${kind} → ${part}`).toContain(`data-part="${part}"`);
    }
  });

  it('declares hooks for exactly the six control kinds', () => {
    expect(Object.keys(CONTROL_ART_HOOKS).sort()).toEqual([...CONTROL_KINDS].sort());
    expect(CONTROL_ART_HOOKS).toEqual({
      pot: ['pointer'],
      encoder: ['pointer'],
      button: ['cap'],
      toggle: ['lever'],
      led: ['lens', 'glow'],
      rgbled: ['lens'],
    });
  });

  it.each(CONTROL_KINDS)('%s art is the original art once the hooks are removed (palette unchanged)', kind => {
    const digest = createHash('sha256').update(withoutHooks(DEVICE_ICONS[kind]!)).digest('hex').slice(0, 16);
    expect(digest).toBe(ORIGINAL_ART[kind]);
  });

  it('non-control art has no hooks', () => {
    for (const id of ['sdcard', 'oled', 'midiTrs', 'midiUsb']) {
      expect(DEVICE_ICONS[id]).not.toContain('data-part');
    }
  });
});

describe('deviceIconSvg live variant (FR-CWS-1)', () => {
  it('palette output has the plain icon class', () => {
    expect(deviceIconSvg('pot', 'var(--ds-accent-pot)')).toMatch(/^<svg class="icon" /);
  });

  it('live output marks the root for card sizing and keeps the same art and plate', () => {
    const palette = deviceIconSvg('led', 'var(--ds-accent-led)');
    const live = deviceIconSvg('led', 'var(--ds-accent-led)', { live: true });
    expect(live).toMatch(/^<svg class="icon icon-live" /);
    expect(live.replace('icon icon-live', 'icon')).toBe(palette);
  });
});
