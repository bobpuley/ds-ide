import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import * as vscode from 'vscode';
import { debugDeploy } from '../../../commands/debug-deploy';
import type { EmulatorManager } from '../../../emulator/manager';
import type { ControllerDef } from '../../../controllers/controller-config';

function makeManager(overrides: Partial<{
  deploy: () => Promise<void>;
  childPid: number | undefined;
  sendPotSnapshot: (v: Record<number, number>) => void;
}> = {}): EmulatorManager {
  const em = new EventEmitter() as unknown as EmulatorManager;
  (em as unknown as Record<string, unknown>).deploy = overrides.deploy ?? vi.fn(() => Promise.resolve());
  (em as unknown as Record<string, unknown>).sendPotSnapshot = overrides.sendPotSnapshot ?? vi.fn();
  Object.defineProperty(em, 'childPid', {
    get: () => 'childPid' in overrides ? overrides.childPid : 42,
    configurable: true,
  });
  return em;
}

const DEFS: ControllerDef[] = [];

describe('debugDeploy()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deploys and calls startDebugging with the emulator PID', async () => {
    const manager = makeManager({ childPid: 1234 });
    const showPanel = vi.fn();
    const getPotSnapshot = vi.fn(() => ({ 0: 0.5 }));

    await debugDeploy(manager, () => DEFS, showPanel, getPotSnapshot);

    expect(manager.deploy).toHaveBeenCalled();
    const call = (vscode.debug.startDebugging as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const config = call[1] as Record<string, unknown>;
    expect(config['type']).toBe('daisy-debug');
    expect(config['request']).toBe('attach');
    expect(config['pid']).toBe(1234);
  });

  it('sends pot snapshot after deploy', async () => {
    const sendPotSnapshot = vi.fn();
    const manager = makeManager({ sendPotSnapshot });
    const snapshot = { 0: 0.7, 1: 0.3 };

    await debugDeploy(manager, () => DEFS, vi.fn(), () => snapshot);

    expect(sendPotSnapshot).toHaveBeenCalledWith(snapshot);
  });

  it('shows an error and skips startDebugging when deploy fails', async () => {
    const manager = makeManager({
      deploy: vi.fn(() => Promise.reject(new Error('build first'))),
    });

    await debugDeploy(manager, () => DEFS, vi.fn(), () => ({}));

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('deploy failed'),
    );
    expect(vscode.debug.startDebugging).not.toHaveBeenCalled();
  });

  it('shows an error when childPid is undefined after deploy', async () => {
    const manager = makeManager({ childPid: undefined });

    await debugDeploy(manager, () => DEFS, vi.fn(), () => ({}));

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('PID'),
    );
    expect(vscode.debug.startDebugging).not.toHaveBeenCalled();
  });

  it('shows an error when startDebugging returns false', async () => {
    (vscode.debug.startDebugging as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    const manager = makeManager({ childPid: 99 });

    await debugDeploy(manager, () => DEFS, vi.fn(), () => ({}));

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('failed to start debug session'),
    );
  });

  it('shows the scope panel with defs and snapshot', async () => {
    const manager = makeManager({ childPid: 7 });
    const showPanel = vi.fn();
    const snapshot = { 2: 0.9 };
    const defs: ControllerDef[] = [
      { id: 'vol', label: 'Volume', adcChannel: 2, range: [0, 1], taper: 'linear', default: 0.5 },
    ];

    await debugDeploy(manager, () => defs, showPanel, () => snapshot);

    expect(showPanel).toHaveBeenCalledWith(defs, snapshot);
  });
});
