import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDebouncedSaver } from '../../../webview/controls/auto-save';

describe('createDebouncedSaver (FR-RCH-5)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('saves once, 500 ms after the last schedule()', () => {
    const save = vi.fn();
    const saver = createDebouncedSaver(save);
    saver.schedule();
    vi.advanceTimersByTime(499);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('coalesces rapid schedules into one save', () => {
    const save = vi.fn();
    const saver = createDebouncedSaver(save);
    saver.schedule();
    vi.advanceTimersByTime(300);
    saver.schedule();
    vi.advanceTimersByTime(300);
    saver.schedule();
    vi.advanceTimersByTime(500);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('cancel() drops a pending save', () => {
    const save = vi.fn();
    const saver = createDebouncedSaver(save);
    saver.schedule();
    saver.cancel();
    vi.advanceTimersByTime(1000);
    expect(save).not.toHaveBeenCalled();
  });

  it('flush() saves immediately when a save is pending, and only then', () => {
    const save = vi.fn();
    const saver = createDebouncedSaver(save);
    saver.flush();
    expect(save).not.toHaveBeenCalled();
    saver.schedule();
    saver.flush();
    expect(save).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('can save again after a save has fired', () => {
    const save = vi.fn();
    const saver = createDebouncedSaver(save, 100);
    saver.schedule();
    vi.advanceTimersByTime(100);
    saver.schedule();
    vi.advanceTimersByTime(100);
    expect(save).toHaveBeenCalledTimes(2);
  });
});
