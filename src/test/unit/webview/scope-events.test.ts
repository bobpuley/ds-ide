import { describe, it, expect } from 'vitest';
import { EventLog, MAX_EVENTS, COALESCE_MS, formatClock } from '../../../webview/scope/scope-events';

const at = (h: number, m: number, s: number, ms = 0): number => new Date(2026, 8, 30, h, m, s, ms).getTime();

describe('EventLog (FR-SCI-13)', () => {
  it('keeps events newest first, with their kind and time', () => {
    const log = new EventLog();
    log.add('CLIP', at(12, 0, 1));
    log.add('DENORMAL', at(12, 0, 5));
    expect(log.entries().map(e => e.kind)).toEqual(['DENORMAL', 'CLIP']);
    expect(log.latest()?.kind).toBe('DENORMAL');
    expect(log.size).toBe(2);
  });

  it('keeps an event visible after later ones have replaced it in the strip', () => {
    const log = new EventLog();
    log.add('CLIP', at(12, 0, 1));
    log.add('XRUN', at(12, 0, 30));
    expect(log.entries().some(e => e.kind === 'CLIP')).toBe(true);
  });

  it('folds a repeat of the same kind within the coalesce window into one entry with a count', () => {
    const log = new EventLog();
    log.add('CLIP', at(12, 0, 0));
    log.add('CLIP', at(12, 0, 0, COALESCE_MS - 1));
    log.add('CLIP', at(12, 0, 0, COALESCE_MS - 1));
    expect(log.size).toBe(1);
    expect(log.latest()).toMatchObject({ kind: 'CLIP', count: 3, time: at(12, 0, 0) });
  });

  it('starts a new entry once the window has passed, or when another kind intervenes', () => {
    const log = new EventLog();
    log.add('CLIP', at(12, 0, 0));
    log.add('CLIP', at(12, 0, 0, COALESCE_MS));
    expect(log.size).toBe(2);
    log.add('DENORMAL', at(12, 0, 2));
    log.add('CLIP', at(12, 0, 2, 10));
    expect(log.size).toBe(4);
  });

  it('holds at least the last 200 events and drops the oldest', () => {
    expect(MAX_EVENTS).toBeGreaterThanOrEqual(200);
    const log = new EventLog();
    for (let i = 0; i < MAX_EVENTS + 5; i++) log.add(i % 2 ? 'CLIP' : 'DENORMAL', at(12, 0, 0) + i * 10_000);
    expect(log.size).toBe(MAX_EVENTS);
    expect(log.entries().at(-1)?.time).toBe(at(12, 0, 0) + 5 * 10_000);   // the first five were dropped
    expect(log.latest()?.time).toBe(at(12, 0, 0) + (MAX_EVENTS + 4) * 10_000);
  });

  it('records an optional detail', () => {
    const log = new EventLog();
    log.add('XRUN', at(12, 0, 0), 'total 4');
    expect(log.latest()?.detail).toBe('total 4');
  });

  it('has no latest entry when empty', () => {
    expect(new EventLog().latest()).toBeUndefined();
  });

  it('clear() empties the log', () => {
    const log = new EventLog();
    log.add('CLIP', at(12, 0, 0));
    log.clear();
    expect(log.size).toBe(0);
  });
});

describe('formatClock', () => {
  it('formats a time as HH:MM:SS', () => {
    expect(formatClock(at(9, 5, 3))).toBe('09:05:03');
  });
});
