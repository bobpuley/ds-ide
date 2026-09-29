import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as vscode from 'vscode';
import {
  DaisyRunConfigurationProvider, DsIdeDebugAdapterDescriptorFactory, LAUNCH_ID_KEY,
} from '../../../debug/run-config-provider';
import { RunSessionAdapter, type RunSessionHost } from '../../../debug/run-session-adapter';

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

const PARENT = { id: 'parent-session', configuration: BASE_CONFIG } as unknown as vscode.DebugSession;

describe('DaisyRunConfigurationProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = undefined;
  });

  describe('provideDebugConfigurations()', () => {
    it('returns one ds-ide launch configuration', () => {
      const provider = new DaisyRunConfigurationProvider(vi.fn(), makeWorkspaceState());
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
    it('F5: builds + deploys, returns the config so the live ds-ide session starts (FR-TRN-2)', async () => {
      const buildAndDeploy = vi.fn(() => Promise.resolve(true));
      const provider = new DaisyRunConfigurationProvider(buildAndDeploy, makeWorkspaceState());

      const result = await provider.resolveDebugConfiguration(undefined, { ...BASE_CONFIG });

      expect(buildAndDeploy).toHaveBeenCalledOnce();
      expect(result).toMatchObject(BASE_CONFIG);
      // attaching is the session adapter's job now, not the resolver's
      expect(vscode.debug.startDebugging).not.toHaveBeenCalled();
    });

    it('Ctrl+F5 (noDebug=true): builds + deploys, returns the config so a live session starts (FR-TRN-1)', async () => {
      const buildAndDeploy = vi.fn(() => Promise.resolve(true));
      const provider = new DaisyRunConfigurationProvider(buildAndDeploy, makeWorkspaceState());

      const result = await provider.resolveDebugConfiguration(undefined, { ...BASE_CONFIG, noDebug: true });

      expect(buildAndDeploy).toHaveBeenCalledOnce();
      expect(vscode.debug.startDebugging).not.toHaveBeenCalled();
      expect(result).toMatchObject({ ...BASE_CONFIG, noDebug: true });
    });

    it.each([[{}], [{ noDebug: true }]])('with no launch.json (%j), fills in the ds-ide launch config so a session can start', async (bare) => {
      const provider = new DaisyRunConfigurationProvider(vi.fn(() => Promise.resolve(true)), makeWorkspaceState());
      const result = await provider.resolveDebugConfiguration(undefined, { ...bare } as vscode.DebugConfiguration);
      expect(result).toMatchObject({ ...BASE_CONFIG, ...bare });
    });

    it('keeps a launch.json entry\'s own name and fields', async () => {
      const provider = new DaisyRunConfigurationProvider(vi.fn(() => Promise.resolve(true)), makeWorkspaceState());
      const result = await provider.resolveDebugConfiguration(undefined, { ...BASE_CONFIG, name: 'Mine', extra: 1 });
      expect(result).toMatchObject({ type: 'ds-ide', request: 'launch', name: 'Mine', extra: 1 });
    });

    it.each([[{}], [{ noDebug: true }]])('returns undefined (no session) when build+deploy fails %j', async (extra) => {
      const provider = new DaisyRunConfigurationProvider(vi.fn(() => Promise.resolve(false)), makeWorkspaceState());
      const result = await provider.resolveDebugConfiguration(undefined, { ...BASE_CONFIG, ...extra });
      expect(result).toBeUndefined();
    });

    it('stamps each resolved config with a launch id that can be consumed exactly once (FR-TRN-2)', async () => {
      const provider = new DaisyRunConfigurationProvider(vi.fn(() => Promise.resolve(true)), makeWorkspaceState());

      const first = (await provider.resolveDebugConfiguration(undefined, { ...BASE_CONFIG }))!;
      const second = (await provider.resolveDebugConfiguration(undefined, { ...BASE_CONFIG }))!;

      expect(first[LAUNCH_ID_KEY]).toEqual(expect.any(String));
      expect(second[LAUNCH_ID_KEY]).not.toBe(first[LAUNCH_ID_KEY]);
      expect(provider.consumeLaunch(first)).toBe(true);
      // VS Code's Restart relaunches with the same resolved config → no longer fresh
      expect(provider.consumeLaunch(first)).toBe(false);
      expect(provider.consumeLaunch(second)).toBe(true);
    });

    it('a config with no launch id is never fresh', () => {
      const provider = new DaisyRunConfigurationProvider(vi.fn(), makeWorkspaceState());
      expect(provider.consumeLaunch({ ...BASE_CONFIG })).toBe(false);
    });

    it('reports build+deploy progress via withProgress instead of leaving F5 silent (FR-QA-EXT-9)', async () => {
      const provider = new DaisyRunConfigurationProvider(vi.fn(() => Promise.resolve(true)), makeWorkspaceState());

      await provider.resolveDebugConfiguration(undefined, { ...BASE_CONFIG });

      const locations = (vscode.window.withProgress as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0].location);
      expect(locations).toContain(vscode.ProgressLocation.Notification);
    });

    it('also shows the build+deploy progress on the Daisy view (FR-TRN-4)', async () => {
      const provider = new DaisyRunConfigurationProvider(vi.fn(() => Promise.resolve(true)), makeWorkspaceState());

      await provider.resolveDebugConfiguration(undefined, { ...BASE_CONFIG });

      const locations = (vscode.window.withProgress as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0].location);
      expect(locations).toContainEqual({ viewId: 'ds-ide.daisyView' });
    });

    it.each([[{}, 'debug'], [{ noDebug: true }, 'run']] as const)('passes the session mode to onBuildAndDeploy (%j → %s)', async (extra, mode) => {
      const buildAndDeploy = vi.fn((_token: vscode.CancellationToken, _mode: 'run' | 'debug') => Promise.resolve(true));
      const provider = new DaisyRunConfigurationProvider(buildAndDeploy, makeWorkspaceState());
      await provider.resolveDebugConfiguration(undefined, { ...BASE_CONFIG, ...extra });
      expect(buildAndDeploy).toHaveBeenCalledWith(expect.anything(), mode);
    });

    it('marks the progress notification cancellable and passes the token to onBuildAndDeploy (FR-EXT-16)', async () => {
      const buildAndDeploy = vi.fn(() => Promise.resolve(true));
      const provider = new DaisyRunConfigurationProvider(buildAndDeploy, makeWorkspaceState());

      await provider.resolveDebugConfiguration(undefined, { ...BASE_CONFIG });

      const options = (vscode.window.withProgress as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => c[0]).find((o) => o.location === vscode.ProgressLocation.Notification);
      expect(options).toMatchObject({ cancellable: true });
      expect(buildAndDeploy).toHaveBeenCalledWith(
        expect.objectContaining({ isCancellationRequested: false }), 'debug',
      );
    });
  });

  describe('buildAndDeployWithProgress() (FR-TRN-2 relaunch)', () => {
    it('cancelling the caller token cancels the build+deploy token', async () => {
      const outer = new vscode.CancellationTokenSource();
      let cancelledDuringBuild = false;
      const provider = new DaisyRunConfigurationProvider(
        vi.fn((token: vscode.CancellationToken) => {
          outer.cancel();
          cancelledDuringBuild = token.isCancellationRequested;
          return Promise.resolve(false);
        }),
        makeWorkspaceState(),
      );

      await provider.buildAndDeployWithProgress('run', outer.token);

      expect(cancelledDuringBuild).toBe(true);
    });

    it('an already-cancelled caller token skips the build entirely', async () => {
      const buildAndDeploy = vi.fn(() => Promise.resolve(true));
      const provider = new DaisyRunConfigurationProvider(buildAndDeploy, makeWorkspaceState());
      const outer = new vscode.CancellationTokenSource();
      outer.cancel();

      expect(await provider.buildAndDeployWithProgress('run', outer.token)).toBe(false);
      expect(buildAndDeploy).not.toHaveBeenCalled();
    });
  });

  describe('attachDebugger()', () => {
    it('starts a daisy-debug attach session as a child whose lifecycle the ds-ide session manages', async () => {
      const provider = new DaisyRunConfigurationProvider(vi.fn(), makeWorkspaceState());

      expect(await provider.attachDebugger(PARENT, 1234)).toBe(true);

      const call = (vscode.debug.startDebugging as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(call[1]).toMatchObject({ type: 'daisy-debug', request: 'attach', pid: 1234 });
      expect(call[2]).toMatchObject({ parentSession: PARENT, lifecycleManagedByParent: true });
    });

    it('starts the debug session against the persisted active folder in a multi-root workspace (FR-UX-6)', async () => {
      const a = folder('/a', 'a');
      const b = folder('/b', 'b');
      (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = [a, b];
      const provider = new DaisyRunConfigurationProvider(vi.fn(), makeWorkspaceState({ 'ds-ide.activeFolder': '/b' }));

      await provider.attachDebugger(PARENT, 1234);

      const call = (vscode.debug.startDebugging as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(call[0]).toBe(b);
    });

    it('shows an error and reports failure when startDebugging returns false', async () => {
      (vscode.debug.startDebugging as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
      const provider = new DaisyRunConfigurationProvider(vi.fn(), makeWorkspaceState());

      expect(await provider.attachDebugger(PARENT, 99)).toBe(false);
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('failed to start debug session'),
      );
    });
  });
});

describe('DsIdeDebugAdapterDescriptorFactory', () => {
  const host: RunSessionHost = {
    currentEmulatorPid: () => 1,
    stopEmulator: vi.fn(),
    onEmulatorExit: () => ({ dispose: vi.fn() }),
    consumeLaunch: () => true,
    rebuildAndDeploy: async (_mode, _token) => true,
    attachDebugger: async () => true,
  };
  const session = (configuration: Record<string, unknown>) =>
    ({ configuration: { ...BASE_CONFIG, ...configuration } }) as unknown as vscode.DebugSession;

  it.each([[{ noDebug: true }], [{}]])('gives every ds-ide session (%j) the live RunSessionAdapter, built for that session', (extra) => {
    const makeHost = vi.fn(() => host);
    const factory = new DsIdeDebugAdapterDescriptorFactory(makeHost);
    const s = session(extra);
    const result = factory.createDebugAdapterDescriptor(s);
    expect(result).toBeInstanceOf(vscode.DebugAdapterInlineImplementation);
    expect((result as unknown as { implementation: unknown }).implementation).toBeInstanceOf(RunSessionAdapter);
    expect(makeHost).toHaveBeenCalledWith(s);
  });
});
