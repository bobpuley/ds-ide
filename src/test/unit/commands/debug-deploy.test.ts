import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import * as vscode from 'vscode';
import { debugDeploy } from '../../../commands/debug-deploy';
import type { EmulatorManager } from '../../../emulator/manager';
import type { ControllerDef } from '../../../controllers/controller-config';

function makeManager(overrides: Partial<{
  deploy: () => Promise<void>;
  childPid: number | undefined;
  sendControlSnapshot: (pots: Record<number, number>, buttons: Record<number, boolean>) => void;
}> = {}): EmulatorManager {
  const em = new EventEmitter() as unknown as EmulatorManager;
  (em as unknown as Record<string, unknown>)['deploy'] = overrides.deploy ?? vi.fn(() => Promise.resolve());
  (em as unknown as Record<string, unknown>)['sendControlSnapshot'] = overrides.sendControlSnapshot ?? vi.fn();
  Object.defineProperty(em, 'childPid', {
    get: () => 'childPid' in overrides ? overrides.childPid : 42,
    configurable: true,
  });
  return em;
}

const DEFS: ControllerDef[] = [];

function makeChannel(): vscode.OutputChannel {
  return { show: vi.fn(), appendLine: vi.fn() } as unknown as vscode.OutputChannel;
}

function makeWorkspaceState(initial: Record<string, unknown> = {}): vscode.Memento {
  const store = { ...initial };
  return {
    get: vi.fn((key: string, defaultValue?: unknown) => (key in store ? store[key] : defaultValue)),
    update: vi.fn((key: string, value: unknown) => { store[key] = value; return Promise.resolve(); }),
    keys: () => Object.keys(store),
  } as unknown as vscode.Memento;
}

function folder(fsPath: string, name: string): vscode.WorkspaceFolder {
  return { uri: { fsPath }, name, index: 0 } as unknown as vscode.WorkspaceFolder;
}

describe('debugDeploy()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = undefined;
  });

  it('deploys and calls startDebugging with the emulator PID', async () => {
    const manager = makeManager({ childPid: 1234 });
    const showPanel = vi.fn();
    const getPotSnapshot = vi.fn(() => ({ 0: 0.5 }));

    await debugDeploy(manager, () => DEFS, showPanel, getPotSnapshot, undefined, makeChannel(), makeWorkspaceState());

    expect(manager.deploy).toHaveBeenCalled();
    const call = (vscode.debug.startDebugging as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const config = call[1] as Record<string, unknown>;
    expect(config['type']).toBe('daisy-debug');
    expect(config['request']).toBe('attach');
    expect(config['pid']).toBe(1234);
  });

  it('starts the debug session against the persisted active folder in a multi-root workspace (FR-UX-6)', async () => {
    const a = folder('/a', 'a');
    const b = folder('/b', 'b');
    (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = [a, b];
    const workspaceState = makeWorkspaceState({ 'ds-ide.activeFolder': '/b' });
    const manager = makeManager({ childPid: 1234 });

    await debugDeploy(manager, () => DEFS, vi.fn(), () => ({}), undefined, makeChannel(), workspaceState);

    const call = (vscode.debug.startDebugging as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toBe(b);
  });

  it('sends pot snapshot after deploy, with an empty button map (pre-existing debug-path asymmetry, FR-DEV-1)', async () => {
    const sendControlSnapshot = vi.fn();
    const manager = makeManager({ sendControlSnapshot });
    const snapshot = { 0: 0.7, 1: 0.3 };

    await debugDeploy(manager, () => DEFS, vi.fn(), () => snapshot, undefined, makeChannel(), makeWorkspaceState());

    expect(sendControlSnapshot).toHaveBeenCalledWith(snapshot, {});
  });

  it('shows an error and skips startDebugging when deploy fails', async () => {
    const manager = makeManager({
      deploy: vi.fn(() => Promise.reject(new Error('build first'))),
    });

    await debugDeploy(manager, () => DEFS, vi.fn(), () => ({}), undefined, makeChannel(), makeWorkspaceState());

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('deploy failed'),
    );
    expect(vscode.debug.startDebugging).not.toHaveBeenCalled();
  });

  it('shows an error when childPid is undefined after deploy', async () => {
    const manager = makeManager({ childPid: undefined });

    await debugDeploy(manager, () => DEFS, vi.fn(), () => ({}), undefined, makeChannel(), makeWorkspaceState());

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('PID'),
    );
    expect(vscode.debug.startDebugging).not.toHaveBeenCalled();
  });

  it('shows an error when startDebugging returns false', async () => {
    (vscode.debug.startDebugging as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    const manager = makeManager({ childPid: 99 });

    await debugDeploy(manager, () => DEFS, vi.fn(), () => ({}), undefined, makeChannel(), makeWorkspaceState());

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

    await debugDeploy(manager, () => defs, showPanel, () => snapshot, undefined, makeChannel(), makeWorkspaceState());

    expect(showPanel).toHaveBeenCalledWith(defs, snapshot);
  });
});
