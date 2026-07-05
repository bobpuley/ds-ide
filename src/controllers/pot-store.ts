import * as vscode from 'vscode';
import { ControllerDef } from './controller-config';

const STATE_KEY = 'ds-ide.potValues';

// A continuous knob drag posts a `pot` IPC message per mousemove (~60-120Hz);
// persisting on every one would hammer workspaceState with a full
// read-modify-write each time. The persisted write is debounced to this
// idle window while in-memory reads (getAll/getSnapshot) stay live and
// immediate, so IPC responsiveness and post-deploy replay are unaffected
// (FR-UX-5).
const FLUSH_DEBOUNCE_MS = 250;

/**
 * Persists pot channel values in VS Code workspace state (FR-CT-4, FR-CF).
 * Values are keyed by ADC channel number (0–11).
 */
export class PotStore {
  // In-memory mirror of the persisted state, updated synchronously on every
  // set() so getAll()/getSnapshot() always reflect the latest value even
  // while a flush is still pending.
  private cache: Record<number, number>;
  private pendingFlush: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly workspaceState: vscode.Memento) {
    this.cache = workspaceState.get<Record<number, number>>(STATE_KEY, {});
  }

  getAll(): Record<number, number> {
    return this.cache;
  }

  set(channel: number, value: number): void {
    this.cache = { ...this.cache, [channel]: value };
    this.scheduleFlush();
  }

  /** Set default values for any channels not already in storage. */
  setDefaults(defs: ControllerDef[]): void {
    const vals = { ...this.cache };
    let changed = false;
    for (const def of defs) {
      if (vals[def.adcChannel] === undefined) {
        vals[def.adcChannel] = def.default;
        changed = true;
      }
    }
    if (changed) {
      this.cache = vals;
      this.flushNow();
    }
  }

  /** Returns a snapshot of all stored values (for `potSnapshot` replay, FR-DE-2). */
  getSnapshot(): Record<number, number> {
    return this.cache;
  }

  private scheduleFlush(): void {
    if (this.pendingFlush) clearTimeout(this.pendingFlush);
    this.pendingFlush = setTimeout(() => this.flushNow(), FLUSH_DEBOUNCE_MS);
  }

  private flushNow(): void {
    if (this.pendingFlush) {
      clearTimeout(this.pendingFlush);
      this.pendingFlush = undefined;
    }
    void this.workspaceState.update(STATE_KEY, this.cache);
  }
}
