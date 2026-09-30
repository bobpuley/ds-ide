// Bounded, timestamped log of scope events — CLIP, DENORMAL, xruns (FR-SCI-13). Pure — no DOM.

export const MAX_EVENTS = 200;
/** A repeat of the same kind this soon after the newest entry is folded into it. */
export const COALESCE_MS = 1000;

export interface EventEntry {
  kind: string;
  /** Epoch ms of the first occurrence folded into this entry. */
  time: number;
  /** How many occurrences were folded into this entry. */
  count: number;
  detail?: string;
}

export class EventLog {
  // Oldest first internally; entries() returns newest first.
  private readonly items: EventEntry[] = [];

  add(kind: string, time: number, detail?: string): void {
    const newest = this.items[this.items.length - 1];
    if (newest && newest.kind === kind && time - newest.time < COALESCE_MS) {
      newest.count += 1;
      return;
    }
    this.items.push(detail === undefined ? { kind, time, count: 1 } : { kind, time, count: 1, detail });
    if (this.items.length > MAX_EVENTS) this.items.shift();
  }

  entries(): readonly EventEntry[] {
    return [...this.items].reverse();
  }

  latest(): EventEntry | undefined {
    return this.items[this.items.length - 1];
  }

  get size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items.length = 0;
  }
}

export function formatClock(time: number): string {
  const d = new Date(time);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
