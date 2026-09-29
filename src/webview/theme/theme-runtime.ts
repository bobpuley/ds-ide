// Webview-side theme helpers for canvas code (FR-THM-2, FR-THM-5): canvases
// can't use CSS variables directly, so they read `--ds-*` from computed style
// once per theme change and cache the result — never per frame.

export interface StyleReader {
  getPropertyValue(name: string): string;
}

/** Reads a `--ds-*` value (leading dashes optional); `fallback` if it is unset. */
export function readThemeColor(
  name: string,
  style: StyleReader = getComputedStyle(document.body),
  fallback = '',
): string {
  const prop = name.startsWith('--') ? name : `--ds-${name}`;
  return style.getPropertyValue(prop).trim() || fallback;
}

export interface ThemeObserver {
  observe(target: Node, options: MutationObserverInit): void;
  disconnect(): void;
}
export type ThemeObserverFactory = (onMutation: () => void) => ThemeObserver;

export interface ThemeChangeDeps {
  target?: Node;
  createObserver?: ThemeObserverFactory;
}

/**
 * Calls `cb` when the theme changes: VS Code flips the <body> theme-kind class
 * on a kind change and `data-vscode-theme-id` on any theme change. A
 * MutationObserver batches mutations, so `cb` runs once per batch. Returns an
 * idempotent dispose.
 */
export function onThemeChange(cb: () => void, deps: ThemeChangeDeps = {}): () => void {
  const target = deps.target ?? document.body;
  const create = deps.createObserver ?? (onMutation => new MutationObserver(onMutation));
  let disposed = false;
  const observer = create(() => {
    if (!disposed) cb();
  });
  observer.observe(target, { attributes: true, attributeFilter: ['class', 'data-vscode-theme-id'] });
  return () => {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
  };
}
