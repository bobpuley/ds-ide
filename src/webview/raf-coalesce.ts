// Coalesces a high-frequency stream of calls (e.g. mousemove, which can fire
// well above the display refresh rate) into at most one invocation of `run`
// per animation frame — only the most recent argument survives; intermediate
// ones are dropped rather than queued (FR-UX-5). No DOM access beyond the
// injected scheduler, so this is unit-testable without a browser.
export type FrameScheduler = (cb: () => void) => number;

export function createRafCoalescer<T>(
  run: (arg: T) => void,
  scheduleFrame: FrameScheduler,
): (arg: T) => void {
  let scheduled = false;
  let latest: T;
  return (arg: T) => {
    latest = arg;
    if (scheduled) return;
    scheduled = true;
    scheduleFrame(() => {
      scheduled = false;
      run(latest);
    });
  };
}
