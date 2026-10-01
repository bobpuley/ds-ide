// Debounced layout auto-save (FR-RCH-5). Pure and DOM-free so the timing is
// unit-testable; the Controls Editor saves its layout this long after the
// last change instead of waiting for an explicit button press.
export const AUTO_SAVE_DELAY_MS = 500;

export interface DebouncedSaver {
  /** (Re)start the timer; rapid calls coalesce into one save. */
  schedule(): void;
  /** Drop a pending save without running it. */
  cancel(): void;
  /** Run a pending save now (e.g. as the view is hidden); no-op when none is pending. */
  flush(): void;
}

export function createDebouncedSaver(save: () => void, delayMs: number = AUTO_SAVE_DELAY_MS): DebouncedSaver {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = (): void => {
    if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
  };
  return {
    schedule(): void {
      cancel();
      timer = setTimeout(() => { timer = undefined; save(); }, delayMs);
    },
    cancel,
    flush(): void {
      if (timer === undefined) return;
      cancel();
      save();
    },
  };
}
