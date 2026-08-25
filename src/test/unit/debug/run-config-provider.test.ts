import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as vscode from 'vscode';
import { DaisyRunConfigurationProvider, DsIdeDebugAdapterDescriptorFactory } from '../../../debug/run-config-provider';

const BASE_CONFIG: vscode.DebugConfiguration = {
  type: 'ds-ide',
  request: 'launch',
  name: 'DS-IDE: Build, Deploy & Debug',
};

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

describe('DaisyRunConfigurationProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = undefined;
  });

  describe('provideDebugConfigurations()', () => {
    it('returns one ds-ide launch configuration', () => {
      const provider = new DaisyRunConfigurationProvider(vi.fn(), vi.fn(), makeWorkspaceState());
      const configs = provider.provideDebugConfigurations();
      expect(configs).toHaveLength(1);
      expect(configs[0]).toMatchObject({
        type: 'ds-ide',
        request: 'launch',
        name: expect.stringContaining('DS-IDE'),
      });
    });
  });

  describe('resolveDebugConfiguration()', () => {
    it('F5: calls buildAndDeploy, starts a daisy-debug attach session, returns undefined', async () => {
      const buildAndDeploy = vi.fn(() => Promise.resolve(true));
      const getEmulatorPid = vi.fn(() => 1234);
      const provider = new DaisyRunConfigurationProvider(buildAndDeploy, getEmulatorPid, makeWorkspaceState());

      const result = await provider.resolveDebugConfiguration(undefined, { ...BASE_CONFIG });

      expect(buildAndDeploy).toHaveBeenCalledOnce();
      const call = (vscode.debug.startDebugging as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(call[1]).toMatchObject({ type: 'daisy-debug', request: 'attach', pid: 1234 });
      expect(result).toBeUndefined();
    });

    it('starts the debug session against the persisted active folder in a multi-root workspace (FR-UX-6)', async () => {
      const a = folder('/a', 'a');
      const b = folder('/b', 'b');
      (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = [a, b];
      const workspaceState = makeWorkspaceState({ 'ds-ide.activeFolder': '/b' });
      const buildAndDeploy = vi.fn(() => Promise.resolve(true));
      const getEmulatorPid = vi.fn(() => 1234);
      const provider = new DaisyRunConfigurationProvider(buildAndDeploy, getEmulatorPid, workspaceState);

      await provider.resolveDebugConfiguration(undefined, { ...BASE_CONFIG });

      const call = (vscode.debug.startDebugging as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(call[0]).toBe(b);
    });

    it('Ctrl+F5 (noDebug=true): calls buildAndDeploy, skips startDebugging, returns undefined', async () => {
      const buildAndDeploy = vi.fn(() => Promise.resolve(true));
      const getEmulatorPid = vi.fn(() => 1234);
      const provider = new DaisyRunConfigurationProvider(buildAndDeploy, getEmulatorPid, makeWorkspaceState());

      const result = await provider.resolveDebugConfiguration(undefined, {
        ...BASE_CONFIG,
        noDebug: true,
      });

      expect(buildAndDeploy).toHaveBeenCalledOnce();
      expect(vscode.debug.startDebugging).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });

    it('aborts and returns undefined when build+deploy fails', async () => {
      const buildAndDeploy = vi.fn(() => Promise.resolve(false));
      const getEmulatorPid = vi.fn(() => 1234);
      const provider = new DaisyRunConfigurationProvider(buildAndDeploy, getEmulatorPid, makeWorkspaceState());

      const result = await provider.resolveDebugConfiguration(undefined, { ...BASE_CONFIG });

      expect(result).toBeUndefined();
      expect(getEmulatorPid).not.toHaveBeenCalled();
      expect(vscode.debug.startDebugging).not.toHaveBeenCalled();
    });

    it('shows an error and returns undefined when emulator PID is unavailable', async () => {
      const buildAndDeploy = vi.fn(() => Promise.resolve(true));
      const getEmulatorPid = vi.fn(() => undefined);
      const provider = new DaisyRunConfigurationProvider(buildAndDeploy, getEmulatorPid, makeWorkspaceState());

      const result = await provider.resolveDebugConfiguration(undefined, { ...BASE_CONFIG });

      expect(result).toBeUndefined();
      expect(vscode.debug.startDebugging).not.toHaveBeenCalled();
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('PID'),
      );
    });

    it('shows an error when startDebugging returns false', async () => {
      (vscode.debug.startDebugging as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
      const buildAndDeploy = vi.fn(() => Promise.resolve(true));
      const getEmulatorPid = vi.fn(() => 99);
      const provider = new DaisyRunConfigurationProvider(buildAndDeploy, getEmulatorPid, makeWorkspaceState());

      const result = await provider.resolveDebugConfiguration(undefined, { ...BASE_CONFIG });

      expect(result).toBeUndefined();
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('failed to start debug session'),
      );
    });

    it('does not query PID or call startDebugging for Ctrl+F5', async () => {
      const buildAndDeploy = vi.fn(() => Promise.resolve(true));
      const getEmulatorPid = vi.fn(() => 99);
      const provider = new DaisyRunConfigurationProvider(buildAndDeploy, getEmulatorPid, makeWorkspaceState());

      await provider.resolveDebugConfiguration(undefined, { ...BASE_CONFIG, noDebug: true });

      expect(getEmulatorPid).not.toHaveBeenCalled();
      expect(vscode.debug.startDebugging).not.toHaveBeenCalled();
    });

    it('reports build+deploy progress via withProgress instead of leaving F5 silent (FR-QA-EXT-9)', async () => {
      const buildAndDeploy = vi.fn(() => Promise.resolve(true));
      const getEmulatorPid = vi.fn(() => 1234);
      const provider = new DaisyRunConfigurationProvider(buildAndDeploy, getEmulatorPid, makeWorkspaceState());

      await provider.resolveDebugConfiguration(undefined, { ...BASE_CONFIG });

      expect(vscode.window.withProgress).toHaveBeenCalledOnce();
      const [options, task] = (vscode.window.withProgress as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(options).toMatchObject({ location: vscode.ProgressLocation.Notification });
      expect(typeof task).toBe('function');
    });

    it('marks the progress notification cancellable and passes the token to onBuildAndDeploy (FR-EXT-16)', async () => {
      const buildAndDeploy = vi.fn(() => Promise.resolve(true));
      const getEmulatorPid = vi.fn(() => 1234);
      const provider = new DaisyRunConfigurationProvider(buildAndDeploy, getEmulatorPid, makeWorkspaceState());

      await provider.resolveDebugConfiguration(undefined, { ...BASE_CONFIG });

      const [options] = (vscode.window.withProgress as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(options).toMatchObject({ cancellable: true });
      expect(buildAndDeploy).toHaveBeenCalledWith(
        expect.objectContaining({ isCancellationRequested: false }),
      );
    });
  });
});

describe('DsIdeDebugAdapterDescriptorFactory', () => {
  it('createDebugAdapterDescriptor returns a DebugAdapterInlineImplementation', () => {
    const factory = new DsIdeDebugAdapterDescriptorFactory();
    const result = factory.createDebugAdapterDescriptor();
    expect(result).toBeInstanceOf(vscode.DebugAdapterInlineImplementation);
  });
});
