import * as vscode from 'vscode';

const STATE_KEY = 'ds-ide.toggleStates';

/**
 * Persists virtual toggle-switch positions across re-deploys within a
 * session (FR-DEV-7) — the Switch3 counterpart to ButtonStore. Keyed by
 * Daisy GPIO pin number; each stored value is an integer position (0, 1, 2).
 *
 * Unlike buttons/pots, toggle instances aren't declared in controllers.yaml
 * (no ToggleDef — see docs/milestones/v14/Milestone_M44.md's scope note), so
 * setDefaults() takes the plain gpio-pin list recovered from the code
 * annotation convention instead of a YAML def array.
 */
export class ToggleStore {
  constructor(private readonly workspaceState: vscode.Memento) {}

  getAll(): Record<number, number> {
    return this.workspaceState.get<Record<number, number>>(STATE_KEY, {});
  }

  set(gpioPin: number, position: number): void {
    const vals = this.getAll();
    vals[gpioPin] = position;
    void this.workspaceState.update(STATE_KEY, vals)
      .then(undefined, (err) => console.warn('ds-ide: failed to persist toggle state —', err));
  }

  /** Seed any not-yet-stored toggles to position 0. */
  setDefaults(gpioPins: number[]): void {
    const vals = this.getAll();
    let changed = false;
    for (const pin of gpioPins) {
      if (vals[pin] === undefined) {
        vals[pin] = 0;
        changed = true;
      }
    }
    if (changed) void this.workspaceState.update(STATE_KEY, vals);
  }

  /** Snapshot of all stored positions (for `controlSnapshot` replay). */
  getSnapshot(): Record<number, number> {
    return this.getAll();
  }
}
