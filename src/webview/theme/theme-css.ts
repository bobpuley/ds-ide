// Shared theme layer (FR-THM-1, FR-THM-3): the one place that decides which
// VS Code token each `--ds-*` meaning maps to. Views use only `--ds-*`
// variables; VS Code injects the `--vscode-*` tokens and the <body> theme-kind
// class and updates both live, so a theme switch needs no extension-host work.
//
// Pure string generation (no DOM, no `vscode` import).

import { REGISTRY } from '../../devices/registry';

export interface ThemeCssOptions {
  /** Editor-area panels use the editor background; sidebar views the sidebar's. */
  surface: 'editor' | 'sidebar';
}

const SURFACE_TOKEN: Record<ThemeCssOptions['surface'], string> = {
  editor: '--vscode-editor-background',
  sidebar: '--vscode-sideBar-background',
};

const TOKEN_MAP: ReadonlyArray<readonly [string, string]> = [
  ['surface-raised', '--vscode-editorWidget-background'],
  ['text', '--vscode-foreground'],
  ['text-muted', '--vscode-descriptionForeground'],
  ['border', '--vscode-panel-border'],
  ['focus', '--vscode-focusBorder'],
  ['contrast-border', '--vscode-contrastBorder'],
  ['input-bg', '--vscode-input-background'],
  ['input-fg', '--vscode-input-foreground'],
  ['button-bg', '--vscode-button-background'],
  ['button-fg', '--vscode-button-foreground'],
  ['button-hover-bg', '--vscode-button-hoverBackground'],
  ['hover-bg', '--vscode-toolbar-hoverBackground'],
  ['dropdown-bg', '--vscode-dropdown-background'],
  ['dropdown-fg', '--vscode-dropdown-foreground'],
  ['trace-in', '--vscode-charts-blue'],
  ['trace-out', '--vscode-charts-orange'],
  ['grid', '--vscode-charts-lines'],
  ['axis', '--vscode-charts-foreground'],
  ['ok', '--vscode-testing-iconPassed'],
  ['error', '--vscode-errorForeground'],
];

const DARK_KINDS = 'body, body.vscode-dark, body.vscode-high-contrast';
const LIGHT_KINDS = 'body.vscode-light, body.vscode-high-contrast-light';
const HC_KINDS = ['body.vscode-high-contrast', 'body.vscode-high-contrast-light'];

function accentBlock(selector: string, variant: 'dark' | 'light'): string {
  const decls = Object.values(REGISTRY)
    .map(d => `  --ds-accent-${d.id}: ${d.accent[variant]};`)
    .join('\n');
  return `${selector} {\n${decls}\n}`;
}

export function themeCss(opts: ThemeCssOptions): string {
  const aliases = TOKEN_MAP.map(([name, token]) => `  --ds-${name}: var(${token});`).join('\n');
  // `.ds-hc` marks interactive elements, popovers and hardware frames that
  // gain the theme's contrast border in high-contrast kinds.
  const hcRules = HC_KINDS.map(k => `${k} .ds-hc { border: 1px solid var(--ds-contrast-border); }`).join('\n');
  return [
    `body {\n  --ds-surface: var(${SURFACE_TOKEN[opts.surface]});\n${aliases}\n}`,
    accentBlock(DARK_KINDS, 'dark'),
    accentBlock(LIGHT_KINDS, 'light'),
    hcRules,
    ':focus-visible { outline: 1px solid var(--ds-focus); outline-offset: 1px; }',
  ].join('\n');
}
