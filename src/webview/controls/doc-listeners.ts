/// <reference lib="dom" />
// Tracks document-level event listeners added by whichever canvas
// (convention or legacy YAML editor) is currently rendered, so a re-render
// can remove exactly its own stale listeners (FR-EXT-32). A single tracker
// is shared by both canvas modules — matching the pre-split behavior, where
// one global listener list was cleared by either canvas's render function —
// so switching between the two modes still cleans up the other's listeners.
export interface DocListenerTracker {
  add(event: string, fn: EventListener): void;
  clear(): void;
}

export function createDocListenerTracker(): DocListenerTracker {
  const listeners: Array<{ event: string; fn: EventListener }> = [];
  return {
    add(event, fn) {
      document.addEventListener(event, fn);
      listeners.push({ event, fn });
    },
    clear() {
      for (const { event, fn } of listeners) document.removeEventListener(event, fn);
      listeners.length = 0;
    },
  };
}
