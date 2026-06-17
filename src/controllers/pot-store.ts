import * as vscode from 'vscode';
import { ControllerDef } from './controller-config';

const STATE_KEY = 'ds-ide.potValues';

/**
 * Persists pot channel values in VS Code workspace state (FR-CT-4, FR-CF).
 * Values are keyed by ADC channel number (0–11).
 */
export class PotStore {
  constructor(private readonly workspaceState: vscode.Memento) {}

  getAll(): Record<number, number> {
    return this.workspaceState.get<Record<number, number>>(STATE_KEY, {});
  }

  set(channel: number, value: number): void {
    const vals = this.getAll();
    vals[channel] = value;
    void this.workspaceState.update(STATE_KEY, vals);
  }

  /** Set default values for any channels not already in storage. */
  setDefaults(defs: ControllerDef[]): void {
    const vals = this.getAll();
    let changed = false;
    for (const def of defs) {
      if (vals[def.adcChannel] === undefined) {
        vals[def.adcChannel] = def.default;
        changed = true;
      }
    }
    if (changed) void this.workspaceState.update(STATE_KEY, vals);
  }

  /** Returns a snapshot of all stored values (for `potSnapshot` replay, FR-DE-2). */
  getSnapshot(): Record<number, number> {
    return this.getAll();
  }
}
