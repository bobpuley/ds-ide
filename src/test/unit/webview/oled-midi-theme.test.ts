import { describe, it, expect } from 'vitest';
import { buildHtml as oledHtml } from '../../../webview/oled-panel';
import { buildHtml as midiHtml } from '../../../webview/midi-panel';
import { themeCss } from '../../../webview/theme/theme-css';

const HEX = /(?<![&\w])#[0-9a-fA-F]{3,8}\b/;
const FUNC = /\brgba?\(|\bhsla?\(/;

// Strip the shared theme block, whose accent palette is allow-listed.
function ownMarkup(html: string): string {
  return html.replace(themeCss({ surface: 'editor' }), '');
}

describe.each([
  ['OLED', () => oledHtml('n0nce', 'x.js')],
  ['MIDI', () => midiHtml('n0nce', 'x.js')],
])('%s panel theming (FR-THM-1)', (_name, build) => {
  it('includes the shared editor-surface theme block', () => {
    const html = build();
    expect(html).toContain(themeCss({ surface: 'editor' }));
    expect(html).toContain('background: var(--ds-surface)');
  });

  it('has no hex / rgb() / hsl() colour literals of its own', () => {
    const own = ownMarkup(build());
    expect(own).not.toMatch(HEX);
    expect(own).not.toMatch(FUNC);
  });
});

describe('OLED panel frame (FR-THM-4)', () => {
  it('keeps the glass black inside a themed frame', () => {
    const html = oledHtml('n0nce', 'x.js');
    expect(html).toMatch(/#oled\s*\{[^}]*background:\s*black/);
    expect(html).toMatch(/#oled-frame\s*\{[^}]*var\(--ds-surface-raised\)[^}]*var\(--ds-border\)/);
    expect(html).toMatch(/<div id="oled-frame" class="ds-hc">\s*<canvas id="oled"/);
  });
});

describe('MIDI panel colours (FR-THM-2)', () => {
  it('colours rx / tx monitor rows, the legend and pressed keys from data tokens', () => {
    const html = midiHtml('n0nce', 'x.js');
    expect(html).toMatch(/\.monitor-row\.dir-rx\s*\{\s*color:\s*var\(--ds-trace-in\)/);
    expect(html).toMatch(/\.monitor-row\.dir-tx\s*\{\s*color:\s*var\(--ds-trace-out\)/);
    expect(html).toMatch(/\.sw\.rx\s*\{\s*background:\s*var\(--ds-trace-in\)/);
    expect(html).toMatch(/\.sw\.tx\s*\{\s*background:\s*var\(--ds-trace-out\)/);
    expect(html).toMatch(/\.key\.pressed\s*\{\s*background:\s*var\(--ds-trace-in\)/);
    expect(html).toMatch(/\.key\s*\{[^}]*background:\s*var\(--ds-surface-raised\)/);
  });
});
