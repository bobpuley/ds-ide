import { describe, it, expect } from 'vitest';
import { themeCss } from '../../../webview/theme/theme-css';
import { REGISTRY } from '../../../devices/registry';

const BODY_CLASSES = [
  'vscode-light',
  'vscode-dark',
  'vscode-high-contrast',
  'vscode-high-contrast-light',
];

describe('themeCss (FR-THM-1, FR-THM-3)', () => {
  it('aliases --ds-surface to the editor background for the editor surface', () => {
    const css = themeCss({ surface: 'editor' });
    expect(css).toContain('--ds-surface: var(--vscode-editor-background)');
    expect(css).not.toContain('--ds-surface: var(--vscode-sideBar-background)');
  });

  it('aliases --ds-surface to the sidebar background for the sidebar surface', () => {
    const css = themeCss({ surface: 'sidebar' });
    expect(css).toContain('--ds-surface: var(--vscode-sideBar-background)');
    expect(css).not.toContain('--ds-surface: var(--vscode-editor-background)');
  });

  it.each(['editor', 'sidebar'] as const)('emits the shared token aliases (%s)', surface => {
    const css = themeCss({ surface });
    for (const alias of [
      '--ds-surface-raised: var(--vscode-editorWidget-background)',
      '--ds-text: var(--vscode-foreground)',
      '--ds-text-muted: var(--vscode-descriptionForeground)',
      '--ds-border: var(--vscode-panel-border)',
      '--ds-focus: var(--vscode-focusBorder)',
      '--ds-contrast-border: var(--vscode-contrastBorder)',
      '--ds-trace-in: var(--vscode-charts-blue)',
      '--ds-trace-out: var(--vscode-charts-orange)',
      '--ds-trace-out-r: var(--vscode-charts-purple)',
      '--ds-grid: var(--vscode-charts-lines)',
      '--ds-axis: var(--vscode-charts-foreground)',
      '--ds-ok: var(--vscode-testing-iconPassed)',
      '--ds-error: var(--vscode-errorForeground)',
    ]) {
      expect(css).toContain(alias);
    }
  });

  it('generates a dark and a light accent variable for every registry device', () => {
    const css = themeCss({ surface: 'editor' });
    for (const d of Object.values(REGISTRY)) {
      expect(css).toContain(`--ds-accent-${d.id}: ${d.accent.dark};`);
      expect(css).toContain(`--ds-accent-${d.id}: ${d.accent.light};`);
    }
  });

  it('picks accent variants per body theme class, HC kinds reusing the matching variant', () => {
    const css = themeCss({ surface: 'editor' });
    const darkBlock = /([^{}]*)\{([^{}]*--ds-accent-pot: #4ec9b0[^{}]*)\}/.exec(css)!;
    const lightBlock = /([^{}]*)\{([^{}]*--ds-accent-pot: #007a66[^{}]*)\}/.exec(css)!;
    expect(darkBlock[1]).toContain('body.vscode-dark');
    expect(darkBlock[1]).toContain('body.vscode-high-contrast');
    expect(darkBlock[1]).not.toContain('body.vscode-light');
    expect(lightBlock[1]).toContain('body.vscode-light');
    expect(lightBlock[1]).toContain('body.vscode-high-contrast-light');
    expect(lightBlock[1]).not.toMatch(/body\.vscode-(dark|high-contrast)[,\s{]/);
  });

  it('emits contrast-border and focus rules for both high-contrast kinds', () => {
    const css = themeCss({ surface: 'sidebar' });
    for (const cls of ['body.vscode-high-contrast', 'body.vscode-high-contrast-light']) {
      expect(css).toContain(`${cls} .ds-hc`);
    }
    expect(css).toContain('var(--ds-contrast-border)');
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:[^}]*var\(--ds-focus\)/);
  });

  it('mentions every body theme class', () => {
    const css = themeCss({ surface: 'editor' });
    for (const cls of BODY_CLASSES) expect(css).toContain(`body.${cls}`);
  });
});
