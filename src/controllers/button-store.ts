import * as vscode from 'vscode';
import { ButtonDef } from './controller-config';

const STATE_KEY = 'ds-ide.buttonStates';

/**
 * Persists virtual button states across re-deploys within a session (FR-CT-11).
 * Keyed by Daisy GPIO pin number. Toggle buttons keep their latched state;
 * momentary buttons naturally settle to `false` (released) since each release
 * is recorded.
 */
export class ButtonStore {
  constructor(private readonly workspaceState: vscode.Memento) {}

  getAll(): Record<number, boolean> {
    return this.workspaceState.get<Record<number, boolean>>(STATE_KEY, {});
  }

  set(gpioPin: number, pressed: boolean): void {
    const vals = this.getAll();
    vals[gpioPin] = pressed;
    void this.workspaceState.update(STATE_KEY, vals)
      .then(undefined, (err) => console.warn('ds-ide: failed to persist button state —', err));
  }

  /** Seed any not-yet-stored buttons to released (false). */
  setDefaults(defs: ButtonDef[]): void {
    const vals = this.getAll();
    let changed = false;
    for (const def of defs) {
      if (vals[def.gpioPin] === undefined) {
        vals[def.gpioPin] = false;
        changed = true;
      }
    }
    if (changed) void this.workspaceState.update(STATE_KEY, vals);
  }

  /** Snapshot of all stored button states (for `buttonSnapshot` replay). */
  getSnapshot(): Record<number, boolean> {
    return this.getAll();
  }
}
