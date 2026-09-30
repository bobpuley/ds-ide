// Colours the scope and spectrum canvases draw with (FR-THM-2). Canvases can't
// use CSS variables, so scope-webview.ts loads this once at start-up and again
// on each theme change (FR-THM-5) — never per frame.

export interface ScopeColors {
  background: string;
  grid: string;
  axis: string;
  traceIn: string;
  traceOut: string;
  traceOutR: string;
  trigger: string;
  running: string;
  stopped: string;
}

export function loadScopeColors(read: (name: string) => string): ScopeColors {
  return {
    background: read('--ds-surface'),
    grid: read('--ds-grid'),
    axis: read('--ds-axis'),
    traceIn: read('--ds-trace-in'),
    traceOut: read('--ds-trace-out'),
    traceOutR: read('--ds-trace-out-r'),
    trigger: read('--ds-warning-fg'),
    running: read('--ds-ok'),
    stopped: read('--ds-error'),
  };
}
