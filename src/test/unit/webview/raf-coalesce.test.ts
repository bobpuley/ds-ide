import { describe, it, expect, vi } from 'vitest';
import { createRafCoalescer } from '../../../webview/raf-coalesce';

function makeManualScheduler() {
  const pending: Array<() => void> = [];
  const scheduleFrame = vi.fn((cb: () => void) => {
    pending.push(cb);
    return pending.length;
  });
  const flushFrame = (): void => {
    const cb = pending.shift();
    cb?.();
  };
  return { scheduleFrame, flushFrame, pendingCount: () => pending.length };
}

describe('createRafCoalescer (FR-UX-5)', () => {
  it('does not call run() until a frame is flushed', () => {
    const run = vi.fn();
    const { scheduleFrame, pendingCount } = makeManualScheduler();
    const coalesced = createRafCoalescer(run, scheduleFrame);

    coalesced(1);
    expect(run).not.toHaveBeenCalled();
    expect(pendingCount()).toBe(1);
  });

  it('calls run() with the argument once the frame fires', () => {
    const run = vi.fn();
    const { scheduleFrame, flushFrame } = makeManualScheduler();
    const coalesced = createRafCoalescer(run, scheduleFrame);

    coalesced(0.5);
    flushFrame();
    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith(0.5);
  });

  it('coalesces a burst of calls within one frame into a single run() with only the latest value', () => {
    const run = vi.fn();
    const { scheduleFrame, flushFrame } = makeManualScheduler();
    const coalesced = createRafCoalescer(run, scheduleFrame);

    coalesced(0.1);
    coalesced(0.2);
    coalesced(0.3);
    coalesced(0.42);
    flushFrame();

    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith(0.42);
  });

  it('only schedules one frame per burst, not one per call', () => {
    const run = vi.fn();
    const { scheduleFrame, flushFrame } = makeManualScheduler();
    const coalesced = createRafCoalescer(run, scheduleFrame);

    coalesced(1);
    coalesced(2);
    coalesced(3);
    expect(scheduleFrame).toHaveBeenCalledOnce();
    flushFrame();
    expect(scheduleFrame).toHaveBeenCalledOnce();
  });

  it('schedules a new frame for calls arriving after the previous frame flushed', () => {
    const run = vi.fn();
    const { scheduleFrame, flushFrame } = makeManualScheduler();
    const coalesced = createRafCoalescer(run, scheduleFrame);

    coalesced(1);
    flushFrame();
    coalesced(2);
    flushFrame();

    expect(scheduleFrame).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenNthCalledWith(1, 1);
    expect(run).toHaveBeenNthCalledWith(2, 2);
  });
});
