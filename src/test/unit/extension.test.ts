import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import * as vscode from 'vscode';
import * as path from 'path';

vi.mock('fs', () => {
  const promises = {
    readFile: vi.fn(() => Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))),
    access: vi.fn(() => Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))),
    readdir: vi.fn(() => Promise.resolve([])),
    writeFile: vi.fn(() => Promise.resolve()),
    stat: vi.fn(() => Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))),
  };
  return {
    default: {
      readFileSync: vi.fn(() => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); }),
      writeFileSync: vi.fn(),
      existsSync: vi.fn(() => false),
      readdirSync: vi.fn(() => []),
      promises,
    },
    readFileSync: vi.fn(() => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); }),
    writeFileSync: vi.fn(),
    existsSync: vi.fn(() => false),
    readdirSync: vi.fn(() => []),
    promises,
  };
});

// Track manager instances so tests can emit events on them.
const managerInstances: EventEmitter[] = [];

vi.mock('../../emulator/manager', () => {
  const { EventEmitter: EE } = require('events') as typeof import('events');
  class MockEmulatorManager extends EE {
    build = vi.fn();
    deploy = vi.fn();
    sendControlSnapshot = vi.fn();
    sendPot = vi.fn();
    sendTransport = vi.fn();
    sendSine = vi.fn();
    sendAudioMode = vi.fn();
    sendAudioDevice = vi.fn();
    sendWavFile = vi.fn();
    stop = vi.fn();
    dispose = vi.fn();
    get childPid() { return 42; }
    get isConnected() { return true; }
    constructor() {
      super();
      managerInstances.push(this);
    }
  }
  return {
    EmulatorManager: MockEmulatorManager,
    // FR-EXT-2: real implementation is a pure hash of buildDir — safe to reuse
    // directly rather than re-mocking its internals.
    workspaceRuntimeDir: (buildDir: string) => `/tmp/ds-ide-mock-${buildDir.length}`,
  };
});

// Imported for type inference only — each test describe re-imports dynamically.
import type { activate as ActivateFn, deactivate as DeactivateFn } from '../../extension';
import { makeBlockEdit, findDeviceDeclarationLine, revealDeviceInCode } from '../../extension';
import { oledCodegen } from '../../devices/codegen/oled';

function makeContext(): vscode.ExtensionContext {
  return {
    subscriptions: [],
    extensionPath: '/ext',
    extensionUri: { fsPath: '/ext' },
    workspaceState: {
      get: (_key: string, defaultValue?: unknown) => defaultValue,
      update: (_key: string, _value: unknown) => Promise.resolve(),
      keys: () => [],
    },
  } as unknown as vscode.ExtensionContext;
}

describe('extension', () => {
  let activate: typeof ActivateFn;
  let deactivate: typeof DeactivateFn;

  beforeEach(async () => {
    vi.clearAllMocks();
    managerInstances.length = 0;
    // Dynamic re-import ensures the block-scoped variables are always populated.
    // vi.resetModules() is not needed: all singleton state lives inside activate() now.
    const ext = await import('../../extension');
    activate = ext.activate;
    deactivate = ext.deactivate;
  });

  it('exports activate and deactivate', () => {
    expect(typeof activate).toBe('function');
    expect(typeof deactivate).toBe('function');
  });

  it('activate registers all commands (FR-TWE-4: no openControlsEditor/openWiringEditor)', () => {
    const ctx = makeContext();
    activate(ctx);

    const calls = (vscode.commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
    const registeredIds = calls.map((c: unknown[]) => c[0] as string);

    expect(registeredIds).toContain('ds-ide.build');
    expect(registeredIds).toContain('ds-ide.buildAndDeploy');
    expect(registeredIds).toContain('ds-ide.deploy');
    expect(registeredIds).toContain('ds-ide.start');
    expect(registeredIds).toContain('ds-ide.stop');
    expect(registeredIds).toContain('ds-ide.debug');
    expect(registeredIds).toContain('ds-ide.buildHardware');
    expect(registeredIds).toContain('ds-ide.flash');
    expect(registeredIds).toContain('ds-ide.selectActiveFolder');
    // Removed in M35 — access now via Activity Bar icons
    expect(registeredIds).not.toContain('ds-ide.openControlsEditor');
    expect(registeredIds).not.toContain('ds-ide.openWiringEditor');
  });

  it('activate pushes each command, provider, and listener to context.subscriptions (AC-78)', () => {
    const ctx = makeContext();
    activate(ctx);
    const subs = ctx.subscriptions as unknown[];
    // Every registerCommand return value is in subscriptions
    for (const r of (vscode.commands.registerCommand as ReturnType<typeof vi.fn>).mock.results) {
      expect(subs).toContain(r.value);
    }
    // Both WebviewViewProvider registrations are in subscriptions (FR-TWE-1, FR-TWE-2)
    for (const r of (vscode.window.registerWebviewViewProvider as ReturnType<typeof vi.fn>).mock.results) {
      expect(subs).toContain(r.value);
    }
    // Save listener is in subscriptions
    expect(subs).toContain((vscode.workspace.onDidSaveTextDocument as ReturnType<typeof vi.fn>).mock.results[0]?.value);
    // All debug registrations are in subscriptions
    for (const r of (vscode.debug.registerDebugAdapterDescriptorFactory as ReturnType<typeof vi.fn>).mock.results) {
      expect(subs).toContain(r.value);
    }
    for (const r of (vscode.debug.registerDebugAdapterTrackerFactory as ReturnType<typeof vi.fn>).mock.results) {
      expect(subs).toContain(r.value);
    }
    for (const r of (vscode.debug.registerDebugConfigurationProvider as ReturnType<typeof vi.fn>).mock.results) {
      expect(subs).toContain(r.value);
    }
  });

  it('deactivate does not throw', () => {
    expect(() => deactivate()).not.toThrow();
  });

  it('shows a warning notification when a NaN event arrives from the manager', () => {
    const ctx = makeContext();
    activate(ctx);
    const mgr = managerInstances[0]!;
    mgr.emit('message', { type: 'event', kind: 'nan' });
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('NAN'),
    );
  });

  it('shows a warning notification when an Inf event arrives', () => {
    const ctx = makeContext();
    activate(ctx);
    const mgr = managerInstances[0]!;
    mgr.emit('message', { type: 'event', kind: 'inf' });
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('INF'),
    );
  });

  it('does not show a notification for clip/denormal events (less critical)', () => {
    const ctx = makeContext();
    activate(ctx);
    const mgr = managerInstances[0]!;
    mgr.emit('message', { type: 'event', kind: 'clip' });
    mgr.emit('message', { type: 'event', kind: 'denormal' });
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });

  it('shows an error notification and does not throw when emulator disconnects', () => {
    const ctx = makeContext();
    activate(ctx);
    const mgr = managerInstances[0]!;
    expect(() => mgr.emit('disconnect')).not.toThrow();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('emulator disconnected'),
    );
  });

  // FR-EXT-6 / FR-EXT-39: Node's EventEmitter throws in-process on an
  // unhandled 'error' emission — without a production listener, any raw
  // socket error from EmulatorManager would crash the entire Extension Host.
  it('shows an error notification and does not throw when EmulatorManager emits an error', () => {
    const ctx = makeContext();
    activate(ctx);
    const mgr = managerInstances[0]!;
    expect(() => mgr.emit('error', new Error('socket blew up'))).not.toThrow();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('socket blew up'),
    );
  });

  // FR-EXT-25: dropped/malformed IPC traffic was previously visible only via
  // console.warn — now forwarded through EmulatorManager and surfaced in the
  // same emulatorChannel output channel every other emulator diagnostic uses.
  it("appends the emulator channel when EmulatorManager emits a 'warning'", () => {
    const ctx = makeContext();
    activate(ctx);
    const mgr = managerInstances[0]!;

    const createCalls = (vscode.window.createOutputChannel as ReturnType<typeof vi.fn>).mock.calls;
    const emulatorChannelIndex = createCalls.findIndex((c: unknown[]) => c[0] === 'Daisy IDE Emulator');
    const emulatorChannel = (vscode.window.createOutputChannel as ReturnType<typeof vi.fn>)
      .mock.results[emulatorChannelIndex]!.value as { appendLine: ReturnType<typeof vi.fn> };

    expect(() => mgr.emit('warning', { message: 'dropped a malformed line', count: 1 })).not.toThrow();
    expect(emulatorChannel.appendLine).toHaveBeenCalledWith(
      expect.stringContaining('dropped a malformed line'),
    );
  });

  it('routes type:led manager messages to controlsProvider webview (FR-TWE-1)', async () => {
    const ctx = makeContext();
    activate(ctx);
    const mgr = managerInstances[0]!;

    // Retrieve the registered ControlsViewProvider and simulate VS Code calling resolveWebviewView
    const registerCalls = (vscode.window.registerWebviewViewProvider as ReturnType<typeof vi.fn>).mock.calls;
    const controlsEntry = registerCalls.find((c: unknown[]) => c[0] === 'ds-ide.controlsEditor');
    const controlsProvider = controlsEntry?.[1] as { resolveWebviewView: (view: unknown) => void } | undefined;

    const webviewPostMessage = vi.fn();
    const mockView = {
      webview: {
        html: '',
        options: {},
        onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
        postMessage: webviewPostMessage,
        asWebviewUri: vi.fn((u: unknown) => u),
        cspSource: '',
      },
      visible: true,
      onDidDispose: vi.fn((_cb: () => void) => ({ dispose: vi.fn() })),
      onDidChangeVisibility: vi.fn((_cb: () => void) => ({ dispose: vi.fn() })),
      show: vi.fn(),
    };
    controlsProvider?.resolveWebviewView(mockView);

    mgr.emit('message', { type: 'led', gpioPin: 23, lit: true });

    expect(webviewPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'led', gpioPin: 23, lit: true }),
    );
  });

  it('registers WebviewViewProvider for ds-ide.controlsEditor and ds-ide.wiringEditor (FR-TWE-1, FR-TWE-2)', () => {
    const ctx = makeContext();
    activate(ctx);
    const calls = (vscode.window.registerWebviewViewProvider as ReturnType<typeof vi.fn>).mock.calls;
    const viewIds = calls.map((c: unknown[]) => c[0] as string);
    expect(viewIds).toContain('ds-ide.controlsEditor');
    expect(viewIds).toContain('ds-ide.wiringEditor');
  });

  it('registers a debug adapter descriptor factory for daisy-debug', () => {
    const ctx = makeContext();
    activate(ctx);
    expect(vscode.debug.registerDebugAdapterDescriptorFactory).toHaveBeenCalledWith(
      'daisy-debug',
      expect.anything(),
    );
  });

  it('registers a debug configuration provider for ds-ide (FR-CM-3/4)', () => {
    const ctx = makeContext();
    activate(ctx);
    expect(vscode.debug.registerDebugConfigurationProvider).toHaveBeenCalledWith(
      'ds-ide',
      expect.anything(),
    );
  });

  it('registers a debug adapter descriptor factory for ds-ide (pre-check requirement)', () => {
    const ctx = makeContext();
    activate(ctx);
    const calls = (vscode.debug.registerDebugAdapterDescriptorFactory as ReturnType<typeof vi.fn>).mock.calls;
    const types = calls.map((c: unknown[]) => c[0] as string);
    expect(types).toContain('ds-ide');
  });

  it('registers a debug adapter tracker factory for daisy-debug (mute-on-breakpoint)', () => {
    const ctx = makeContext();
    activate(ctx);
    expect(vscode.debug.registerDebugAdapterTrackerFactory).toHaveBeenCalledWith(
      'daisy-debug',
      expect.anything(),
    );
  });

  it('pushes debug session event listener disposables to context.subscriptions (FR-EQ-6)', () => {
    const ctx = makeContext();
    activate(ctx);
    const startDisposable = (vscode.debug.onDidStartDebugSession as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    const terminateDisposable = (vscode.debug.onDidTerminateDebugSession as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    expect(ctx.subscriptions).toContain(startDisposable);
    expect(ctx.subscriptions).toContain(terminateDisposable);
  });

  it('registers onDidSaveTextDocument on activate (FR-CE-9, FR-WE-11)', () => {
    const ctx = makeContext();
    activate(ctx);
    expect(vscode.workspace.onDidSaveTextDocument).toHaveBeenCalled();
  });

  it('registers the editor-title transport commands (FR-TRN-3)', () => {
    activate(makeContext());
    const ids = (vscode.commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0]);
    expect(ids).toEqual(expect.arrayContaining(['ds-ide.runEffect', 'ds-ide.debugEffect', 'ds-ide.buildAndFlash']));
  });

  function commandHandler(id: string): (...args: unknown[]) => unknown {
    const call = (vscode.commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls.find((c: unknown[]) => c[0] === id);
    return call![1] as (...args: unknown[]) => unknown;
  }

  it('ds-ide.runEffect starts the ds-ide launch config without debugging (FR-TRN-3)', async () => {
    activate(makeContext());
    await commandHandler('ds-ide.runEffect')();
    const call = (vscode.debug.startDebugging as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[1]).toMatchObject({ type: 'ds-ide', request: 'launch' });
    expect(call[2]).toMatchObject({ noDebug: true });
  });

  it('ds-ide.debugEffect starts the ds-ide launch config with debugging (FR-TRN-3)', async () => {
    activate(makeContext());
    await commandHandler('ds-ide.debugEffect')();
    const call = (vscode.debug.startDebugging as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[1]).toMatchObject({ type: 'ds-ide', request: 'launch' });
    expect(call[2]?.noDebug).toBeFalsy();
  });

  it('registers the Daisy tree view and disposes it with the extension (FR-TRN-4)', () => {
    const ctx = makeContext();
    activate(ctx);
    const call = (vscode.window.createTreeView as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toBe('ds-ide.daisyView');
    expect(call[1]).toMatchObject({ treeDataProvider: expect.anything() });
    expect(ctx.subscriptions).toContain((vscode.window.createTreeView as ReturnType<typeof vi.fn>).mock.results[0]!.value);
  });

  it('registers the Daisy view commands (FR-TRN-4)', () => {
    activate(makeContext());
    const ids = (vscode.commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0]);
    expect(ids).toEqual(expect.arrayContaining([
      'ds-ide.stopEffect', 'ds-ide.cancelTransport', 'ds-ide.restartEffect', 'ds-ide.refreshBoard', 'ds-ide.showEmulatorOutput',
    ]));
  });

  it('ds-ide.stopEffect with no transport session stops the emulator directly (FR-TRN-4)', async () => {
    activate(makeContext());
    await commandHandler('ds-ide.stopEffect')();
    expect((managerInstances[0] as unknown as { stop: ReturnType<typeof vi.fn> }).stop).toHaveBeenCalledOnce();
    expect(vscode.debug.stopDebugging).not.toHaveBeenCalled();
  });

  it('ds-ide.stopEffect ends the tracked transport session (FR-TRN-4)', async () => {
    activate(makeContext());
    const startCb = (vscode.debug.onDidStartDebugSession as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0] as (s: unknown) => void);
    const s = { type: 'ds-ide', configuration: { noDebug: true } };
    for (const cb of startCb) cb(s);
    await commandHandler('ds-ide.stopEffect')();
    expect(vscode.debug.stopDebugging).toHaveBeenCalledWith(s);
  });

  it('ds-ide.restartEffect with no session rebuilds and redeploys (FR-TRN-4)', async () => {
    activate(makeContext());
    await commandHandler('ds-ide.restartEffect')();
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('ds-ide.buildAndDeploy');
  });

  it('ds-ide.showEmulatorOutput reveals the emulator channel (FR-TRN-4)', () => {
    activate(makeContext());
    const channels = (vscode.window.createOutputChannel as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    const emulator = (vscode.window.createOutputChannel as ReturnType<typeof vi.fn>).mock.results[channels.indexOf('Daisy IDE Emulator')]!.value;
    commandHandler('ds-ide.showEmulatorOutput')();
    expect(emulator.show).toHaveBeenCalled();
  });

  function stateItem(): { text: string; command?: unknown; show: ReturnType<typeof vi.fn> } {
    const calls = (vscode.window.createStatusBarItem as ReturnType<typeof vi.fn>).mock.calls;
    const i = calls.findIndex((c) => c[0] === 'ds-ide.transportState');
    return (vscode.window.createStatusBarItem as ReturnType<typeof vi.fn>).mock.results[i]!.value;
  }

  it('shows debugging on the state item when a standalone daisy-debug session starts (FR-TRN-5)', () => {
    activate(makeContext());
    const startCbs = (vscode.debug.onDidStartDebugSession as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as (s: unknown) => void);
    for (const cb of startCbs) cb({ type: 'daisy-debug', configuration: {} });
    expect(stateItem().text).toContain('debugging');
  });

  it('shows stopped on the state item when that session terminates (FR-TRN-5)', () => {
    activate(makeContext());
    const s = { type: 'daisy-debug', configuration: {} };
    for (const c of (vscode.debug.onDidStartDebugSession as ReturnType<typeof vi.fn>).mock.calls) (c[0] as (s: unknown) => void)(s);
    for (const c of (vscode.debug.onDidTerminateDebugSession as ReturnType<typeof vi.fn>).mock.calls) (c[0] as (s: unknown) => void)(s);
    expect(stateItem().text).toContain('stopped');
  });

  it('writes the status bar only through the transport state items — no other status item exists (FR-TRN-5)', () => {
    activate(makeContext());
    const ids = (vscode.window.createStatusBarItem as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(ids).toEqual(['ds-ide.transportState', 'ds-ide.flash']);
  });

  it('registers ds-ide.revealDaisyView, which focuses the Daisy view (FR-TRN-5)', async () => {
    activate(makeContext());
    await commandHandler('ds-ide.revealDaisyView')();
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('ds-ide.daisyView.focus');
  });
});


// ── FR-CE-9 / FR-WE-11: initialize views on project open + refresh on save ──

describe('extension view initialization (FR-CE-9, FR-WE-11)', () => {
  let fsMock: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    managerInstances.length = 0;
    fsMock = (await import('fs')) as unknown as Record<string, ReturnType<typeof vi.fn>>;
    const promisesMock = fsMock['promises'] as unknown as Record<string, ReturnType<typeof vi.fn>>;
    promisesMock['access']!.mockImplementation((p: unknown) => {
      const fp = String(p);
      if (fp.endsWith('CMakeLists.txt') || fp.endsWith('.cpp')) return Promise.resolve();
      return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    });
    promisesMock['readdir']!.mockResolvedValue(['effect.cpp']);
    promisesMock['readFile']!.mockImplementation((p: unknown) => {
      const fp = String(p);
      if (fp.endsWith('.cpp')) return Promise.resolve('// ds-ide:controls\n// ds-ide:pot vol 15\n');
      if (fp.endsWith('controllers.yaml')) return Promise.resolve('pots: []\nbuttons: []\nleds: []\n');
      return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    });
    (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = [
      { uri: { fsPath: '/proj' } },
    ];
  });

  afterEach(() => {
    (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = undefined;
  });

  it('registers onDidSaveTextDocument watcher on activate (FR-CE-9, FR-WE-11)', async () => {
    const { activate: act } = await import('../../extension');
    const ctx = makeContext();
    act(ctx);
    // the view-sync watcher, plus the transport's stale-source watcher (FR-TRN-4)
    expect(vscode.workspace.onDidSaveTextDocument).toHaveBeenCalledTimes(2);
  });

  it('onDidSaveTextDocument cb registered is a function (FR-CE-9, FR-WE-11)', async () => {
    const { activate: act } = await import('../../extension');
    const ctx = makeContext();
    act(ctx);
    const saveCb = (vscode.workspace.onDidSaveTextDocument as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(typeof saveCb).toBe('function');
  });

  it('save cb reads effect source when .cpp file is saved (FR-CE-9, FR-WE-11)', async () => {
    const { activate: act } = await import('../../extension');
    const ctx = makeContext();
    act(ctx);
    const saveCb = (vscode.workspace.onDidSaveTextDocument as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      ((doc: { uri: { fsPath: string } }) => Promise<void>);
    const promisesMock = fsMock['promises'] as unknown as Record<string, ReturnType<typeof vi.fn>>;
    promisesMock['readFile']!.mockClear();
    await saveCb({ uri: { fsPath: path.join('/proj', 'effect.cpp') } });
    expect(promisesMock['readFile']).toHaveBeenCalledWith(
      expect.stringMatching(/\.cpp$/), expect.anything(),
    );
  });

  it('save cb does not read files when unrelated file is saved (FR-CE-9, FR-WE-11)', async () => {
    const { activate: act } = await import('../../extension');
    const ctx = makeContext();
    act(ctx);
    const saveCb = (vscode.workspace.onDidSaveTextDocument as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      ((doc: { uri: { fsPath: string } }) => Promise<void>);
    const promisesMock = fsMock['promises'] as unknown as Record<string, ReturnType<typeof vi.fn>>;
    promisesMock['readFile']!.mockClear();
    await saveCb({ uri: { fsPath: '/other/unrelated.txt' } });
    expect(promisesMock['readFile']).not.toHaveBeenCalled();
  });

  it('save cb ignores a sibling directory sharing a string prefix with the active folder (FR-UX-4)', async () => {
    const { activate: act } = await import('../../extension');
    const ctx = makeContext();
    act(ctx);
    const saveCb = (vscode.workspace.onDidSaveTextDocument as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      ((doc: { uri: { fsPath: string } }) => Promise<void>);
    const promisesMock = fsMock['promises'] as unknown as Record<string, ReturnType<typeof vi.fn>>;
    promisesMock['readFile']!.mockClear();
    // '/proj-sibling'.startsWith('/proj') is true, but it is not actually
    // inside the '/proj' workspace folder — a raw prefix check would
    // false-positive here; vscode.workspace.getWorkspaceFolder must not.
    await saveCb({ uri: { fsPath: '/proj-sibling/effect.cpp' } });
    expect(promisesMock['readFile']).not.toHaveBeenCalled();
  });

  it('save cb reads controllers.yaml when yaml file is saved (FR-CE-9)', async () => {
    const { activate: act } = await import('../../extension');
    const ctx = makeContext();
    act(ctx);
    const saveCb = (vscode.workspace.onDidSaveTextDocument as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      ((doc: { uri: { fsPath: string } }) => Promise<void>);
    const promisesMock = fsMock['promises'] as unknown as Record<string, ReturnType<typeof vi.fn>>;
    promisesMock['readFile']!.mockClear();
    await saveCb({ uri: { fsPath: path.join('/proj', 'controllers.yaml') } });
    expect(promisesMock['readFile']).toHaveBeenCalledWith(
      expect.stringMatching(/controllers\.yaml$/), expect.anything(),
    );
  });

  it('activate() completes setup synchronously without blocking on file reads (AC-66)', async () => {
    const { activate: act } = await import('../../extension');
    const promisesMock = fsMock['promises'] as unknown as Record<string, ReturnType<typeof vi.fn>>;
    // Make file reads never resolve — activate() must still return
    promisesMock['access']!.mockReturnValue(new Promise(() => {}));
    promisesMock['readFile']!.mockReturnValue(new Promise(() => {}));
    const ctx = makeContext();
    act(ctx);
    // All registrations must be synchronous — even with never-resolving file reads
    const subs = ctx.subscriptions as unknown[];
    for (const r of (vscode.commands.registerCommand as ReturnType<typeof vi.fn>).mock.results) {
      expect(subs).toContain(r.value);
    }
    expect(subs).toContain((vscode.workspace.onDidSaveTextDocument as ReturnType<typeof vi.fn>).mock.results[0]?.value);
  });

  it('sets the ds-ide.isDaisyProject context key to true when an effect source is found (FR-QA-EXT-6)', async () => {
    const { activate: act } = await import('../../extension');
    act(makeContext());

    await vi.waitFor(() => {
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith('setContext', 'ds-ide.isDaisyProject', true);
    });
  });

  it('sets ds-ide.isEffectSource from the active editor, true only for the effect source (FR-TRN-3)', async () => {
    const { activate: act } = await import('../../extension');
    act(makeContext());
    await vi.waitFor(() => {
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith('setContext', 'ds-ide.isDaisyProject', true);
    });
    const onChange = (vscode.window.onDidChangeActiveTextEditor as ReturnType<typeof vi.fn>).mock.calls[0]![0] as
      (e: { document: { uri: { fsPath: string } } } | undefined) => void;

    (vscode.commands.executeCommand as ReturnType<typeof vi.fn>).mockClear();
    onChange({ document: { uri: { fsPath: path.join('/proj', 'effect.cpp') } } });
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('setContext', 'ds-ide.isEffectSource', true);

    (vscode.commands.executeCommand as ReturnType<typeof vi.fn>).mockClear();
    onChange({ document: { uri: { fsPath: path.join('/proj', 'other.h') } } });
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('setContext', 'ds-ide.isEffectSource', false);

    (vscode.commands.executeCommand as ReturnType<typeof vi.fn>).mockClear();
    onChange(undefined);
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('setContext', 'ds-ide.isEffectSource', false);
  });

  it('sets ds-ide.isEffectSource for an effect source that is already open at activation (FR-TRN-3)', async () => {
    (vscode.window as unknown as Record<string, unknown>)['activeTextEditor'] = {
      document: { uri: { fsPath: path.join('/proj', 'effect.cpp') } },
    };
    try {
      const { activate: act } = await import('../../extension');
      act(makeContext());
      await vi.waitFor(() => {
        expect(vscode.commands.executeCommand).toHaveBeenCalledWith('setContext', 'ds-ide.isEffectSource', true);
      });
    } finally {
      (vscode.window as unknown as Record<string, unknown>)['activeTextEditor'] = undefined;
    }
  });

  it('keeps the state items hidden when no effect source is found (FR-TRN-5)', async () => {
    const promisesMock = fsMock['promises'] as unknown as Record<string, ReturnType<typeof vi.fn>>;
    promisesMock['readdir']!.mockResolvedValue([]);
    promisesMock['access']!.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    const { activate: act } = await import('../../extension');
    act(makeContext());
    const results = (vscode.window.createStatusBarItem as ReturnType<typeof vi.fn>).mock.results.map((r) => r.value);
    await vi.waitFor(() => {
      for (const item of results) expect(item.hide).toHaveBeenCalled();
    });
    for (const item of results) expect(item.show).not.toHaveBeenCalled();
  });

  it('sets the ds-ide.isDaisyProject context key to false when no effect source is found (FR-QA-EXT-6)', async () => {
    const promisesMock = fsMock['promises'] as unknown as Record<string, ReturnType<typeof vi.fn>>;
    promisesMock['readdir']!.mockResolvedValue([]);
    promisesMock['access']!.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const { activate: act } = await import('../../extension');
    act(makeContext());

    await vi.waitFor(() => {
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith('setContext', 'ds-ide.isDaisyProject', false);
    });
  });
});

// ── FR-IPC-4: distinguish absent controllers.yaml from an unreadable one ──

describe('controllers.yaml read robustness (FR-IPC-4)', () => {
  let fsMock: Record<string, ReturnType<typeof vi.fn>>;
  let promisesMock: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    managerInstances.length = 0;
    fsMock = (await import('fs')) as unknown as Record<string, ReturnType<typeof vi.fn>>;
    promisesMock = fsMock['promises'] as unknown as Record<string, ReturnType<typeof vi.fn>>;
    promisesMock['access']!.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    promisesMock['readdir']!.mockResolvedValue([]);
    (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = [
      { uri: { fsPath: '/proj' } },
    ];
  });

  afterEach(() => {
    (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = undefined;
  });

  async function triggerLoadViaSave(ctx: vscode.ExtensionContext): Promise<void> {
    const saveCb = (vscode.workspace.onDidSaveTextDocument as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      (doc: { uri: { fsPath: string } }) => Promise<void>;
    await saveCb({ uri: { fsPath: path.join('/proj', 'controllers.yaml') } });
  }

  function getControlsEditorHandlerAndView() {
    const registerCalls = (vscode.window.registerWebviewViewProvider as ReturnType<typeof vi.fn>).mock.calls;
    const controlsEntry = registerCalls.find((c: unknown[]) => c[0] === 'ds-ide.controlsEditor');
    const controlsProvider = controlsEntry?.[1] as { resolveWebviewView: (view: unknown) => void };
    const mockView = {
      webview: {
        html: '', options: {},
        onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
        postMessage: vi.fn(),
        asWebviewUri: vi.fn((u: unknown) => u),
        cspSource: '',
      },
      visible: true,
      onDidDispose: vi.fn((_cb: () => void) => ({ dispose: vi.fn() })),
      onDidChangeVisibility: vi.fn((_cb: () => void) => ({ dispose: vi.fn() })),
      show: vi.fn(),
    };
    controlsProvider.resolveWebviewView(mockView);
    const handler = (mockView.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0] as (msg: unknown) => void;
    return { handler, mockView };
  }

  function getControlsEditorMessageHandler(): (msg: unknown) => void {
    return getControlsEditorHandlerAndView().handler;
  }

  it('treats a missing controllers.yaml (ENOENT) as empty, without an unreadable warning', async () => {
    promisesMock['readFile']!.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    const { activate: act } = await import('../../extension');
    const ctx = makeContext();
    act(ctx);
    await triggerLoadViaSave(ctx);
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalledWith(
      expect.stringMatching(/unreadable|could not read/i),
    );
  });

  it('surfaces a warning when controllers.yaml read fails with a non-ENOENT error', async () => {
    promisesMock['readFile']!.mockRejectedValue(Object.assign(new Error('permission denied'), { code: 'EACCES' }));
    const { activate: act } = await import('../../extension');
    const ctx = makeContext();
    act(ctx);
    await triggerLoadViaSave(ctx);
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringMatching(/could not read controllers\.yaml/i),
    );
  });

  it('refuses to overwrite controllers.yaml after a non-ENOENT read failure', async () => {
    promisesMock['readFile']!.mockRejectedValue(Object.assign(new Error('permission denied'), { code: 'EACCES' }));
    const { activate: act } = await import('../../extension');
    const ctx = makeContext();
    act(ctx);
    await triggerLoadViaSave(ctx);

    const handler = getControlsEditorMessageHandler();
    promisesMock['writeFile']!.mockClear();
    handler({ command: 'editorSave', cfg: { pots: [], buttons: [], leds: [], encoders: [], toggles: [], rgbleds: [], errors: [] } });
    await Promise.resolve();
    expect(promisesMock['writeFile']).not.toHaveBeenCalled();
  });

  it('writes normally once controllers.yaml has been read successfully', async () => {
    promisesMock['readFile']!.mockImplementation((p: unknown) => {
      const fp = String(p);
      if (fp.endsWith('controllers.yaml')) return Promise.resolve('pots: []\nbuttons: []\nleds: []\n');
      return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    });
    const { activate: act } = await import('../../extension');
    const ctx = makeContext();
    act(ctx);
    await triggerLoadViaSave(ctx);

    const handler = getControlsEditorMessageHandler();
    promisesMock['writeFile']!.mockClear();
    handler({ command: 'editorSave', cfg: { pots: [], buttons: [], leds: [], encoders: [], toggles: [], rgbleds: [], errors: [] } });
    await Promise.resolve();
    expect(promisesMock['writeFile']).toHaveBeenCalledWith(
      expect.stringMatching(/controllers\.yaml$/), expect.anything(), 'utf8',
    );
  });

  it('re-pushes the just-saved layout to the webview so a later flush cannot show a stale snapshot (FR-CE-1)', async () => {
    promisesMock['readFile']!.mockImplementation((p: unknown) => {
      const fp = String(p);
      if (fp.endsWith('controllers.yaml')) return Promise.resolve('pots: []\nbuttons: []\nleds: []\n');
      return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    });
    const { activate: act } = await import('../../extension');
    const ctx = makeContext();
    act(ctx);
    await triggerLoadViaSave(ctx);

    const { handler, mockView } = getControlsEditorHandlerAndView();
    const savedCfg = {
      pots: [{ id: 'pot1', label: 'Pot 1', adcChannel: 0, range: [0, 1], taper: 'linear', default: 0, pos: [10, 20] }],
      buttons: [], leds: [], encoders: [], toggles: [], rgbleds: [], errors: [],
    };
    handler({ command: 'editorSave', cfg: savedCfg });
    // Allow the writeFile().then() chain (and the buildControlsConfig() await inside it) to settle.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // A later visibility-change flush must see the just-saved positions, not a stale
    // pre-save cache — simulate switching back to the Controls Editor after the save.
    mockView.webview.postMessage.mockClear();
    const visibilityCb = (mockView.onDidChangeVisibility as ReturnType<typeof vi.fn>).mock.calls[0]![0] as () => void;
    mockView.visible = true;
    visibilityCb();

    expect(mockView.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'editorLoad',
        cfg: expect.objectContaining({
          pots: expect.arrayContaining([expect.objectContaining({ id: 'pot1', pos: [10, 20] })]),
        }),
      }),
    );
  });

  // M50 (FR-CE-3) — encoder/toggle/rgbled positions previously had no
  // persistence mechanism at all; this is the drag → save → reload
  // regression the milestone's DoD asks for, at the same editorSave →
  // flush level as FR-CE-1's pot test above, plus the controlsConfig
  // placements a convention-mode canvas actually reads its position from.
  it('persists a saved encoder position and reflects it in both editorLoad and controlsConfig placements (FR-CE-3)', async () => {
    promisesMock['readFile']!.mockImplementation((p: unknown) => {
      const fp = String(p);
      if (fp.endsWith('controllers.yaml')) return Promise.resolve('pots: []\nbuttons: []\nleds: []\n');
      return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    });
    const { activate: act } = await import('../../extension');
    const ctx = makeContext();
    act(ctx);
    await triggerLoadViaSave(ctx);

    const { handler, mockView } = getControlsEditorHandlerAndView();
    const savedCfg = {
      pots: [], buttons: [], leds: [],
      encoders: [{ id: 'enc1', pos: [15, 25] }], toggles: [], rgbleds: [],
      errors: [],
    };
    handler({ command: 'editorSave', cfg: savedCfg });
    // Let the writeFile().then() chain and buildControlsConfig()'s own
    // fs-backed awaits (findEffectSource etc.) fully settle — a fixed
    // Promise.resolve() count isn't enough for this deeper async chain.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockView.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'editorLoad',
        cfg: expect.objectContaining({
          encoders: expect.arrayContaining([expect.objectContaining({ id: 'enc1', pos: [15, 25] })]),
        }),
      }),
    );
    expect(mockView.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'controlsConfig',
        placements: expect.arrayContaining([expect.objectContaining({ id: 'enc1', pos: [15, 25] })]),
      }),
    );

    // Simulate switching away and back — the persisted position must still
    // be there, not just present in the immediate post-save flush.
    mockView.webview.postMessage.mockClear();
    const visibilityCb = (mockView.onDidChangeVisibility as ReturnType<typeof vi.fn>).mock.calls[0]![0] as () => void;
    mockView.visible = true;
    visibilityCb();

    expect(mockView.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'editorLoad',
        cfg: expect.objectContaining({
          encoders: expect.arrayContaining([expect.objectContaining({ id: 'enc1', pos: [15, 25] })]),
        }),
      }),
    );
  });

  it('a slower, stale controlsConfig refresh does not overwrite a faster, later layout-save refresh (FR-CE-1 follow-up)', async () => {
    // Reproduces a bug found in manual testing: the extension-activation-time
    // refresh (initViewsFromProject's own buildControlsConfig call) and a
    // layout-save's refresh both read the effect source asynchronously and
    // can resolve out of order. If the activation-time read is slow (e.g. a
    // transient read failure/workspace-mount race) and resolves *after* the
    // save's own (successful, faster) refresh, the stale response used to
    // win — silently reverting the canvas to empty right after a successful
    // save (observed: a button disappearing from the Controls Editor).
    const cppSource = [
      '// ds-ide:controls:begin',
      'Switch  selectBtn; // ds-ide: id=selectBtn, kind=button, pin=11',
      'Encoder enc1;       // ds-ide: id=enc1, kind=encoder, pin=12, pins=12,13,14',
      '// ds-ide:controls:end',
    ].join('\n');
    promisesMock['readdir']!.mockResolvedValue(['effect.cpp']);

    let effectCppReadCount = 0;
    let releaseFirstRead: (() => void) | undefined;
    promisesMock['readFile']!.mockImplementation((p: unknown) => {
      const fp = String(p);
      if (fp.endsWith('controllers.yaml')) {
        return Promise.resolve(
          'buttons:\n  - id: selectBtn\n    label: Select Effect\n    gpio_pin: 11\n    mode: momentary\n    active_level: low\n    editor_pos: [20, 20]\n',
        );
      }
      if (fp.endsWith('effect.cpp')) {
        effectCppReadCount++;
        if (effectCppReadCount === 1) {
          // The activation-time (initViewsFromProject) read — held open
          // until releaseFirstRead() is called below, simulating it
          // finishing late, after a subsequent save's own refresh.
          return new Promise((_resolve, reject) => {
            releaseFirstRead = () => reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
          });
        }
        return Promise.resolve(cppSource);
      }
      return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    });

    const { activate: act } = await import('../../extension');
    const ctx = makeContext();
    act(ctx);  // kicks off initViewsFromProject() — its effect.cpp read is now stuck open

    const { handler, mockView } = getControlsEditorHandlerAndView();
    mockView.webview.postMessage.mockClear();
    const savedCfg = {
      pots: [], leds: [], encoders: [], toggles: [], rgbleds: [], errors: [],
      buttons: [{ id: 'selectBtn', label: 'Select Effect', gpioPin: 11, mode: 'momentary', activeLevel: 'low', pos: [20, 20] }],
    };
    handler({ command: 'editorSave', cfg: savedCfg });
    // The save's own refresh (2nd effect.cpp read) resolves immediately.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Now the stale, slower activation-time read finally settles (with a
    // failure, producing an empty controls list) — after the save's own
    // correct refresh already landed.
    releaseFirstRead?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const controlsConfigCalls = (mockView.webview.postMessage as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => c[0] as Record<string, unknown>)
      .filter(m => m['command'] === 'controlsConfig');
    const lastControlsConfig = controlsConfigCalls[controlsConfigCalls.length - 1];
    const ids = ((lastControlsConfig?.['controls'] as Array<{ id: string }>) || []).map(c => c.id);
    expect(ids.sort()).toEqual(['enc1', 'selectBtn']);
  });
});

// ── FR-SD-1: SD card content viewer ──────────────────────────────────────

describe('SD card content viewer (FR-SD-1)', () => {
  let promisesMock: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    managerInstances.length = 0;
    const fsMock = (await import('fs')) as unknown as Record<string, ReturnType<typeof vi.fn>>;
    promisesMock = fsMock['promises'] as unknown as Record<string, ReturnType<typeof vi.fn>>;
    promisesMock['access']!.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    promisesMock['readdir']!.mockResolvedValue([]);
    (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = [
      { uri: { fsPath: '/proj' } },
    ];
  });

  afterEach(() => {
    (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = undefined;
  });

  function resolveControlsProvider(): { handler: (msg: unknown) => Promise<void> | void; postMessage: ReturnType<typeof vi.fn> } {
    const registerCalls = (vscode.window.registerWebviewViewProvider as ReturnType<typeof vi.fn>).mock.calls;
    const entry = registerCalls.find((c: unknown[]) => c[0] === 'ds-ide.controlsEditor');
    const provider = entry?.[1] as { resolveWebviewView: (view: unknown) => void };
    const postMessage = vi.fn();
    const mockView = {
      webview: {
        html: '', options: {},
        onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
        postMessage,
        asWebviewUri: vi.fn((u: unknown) => u),
        cspSource: '',
      },
      visible: true,
      onDidDispose: vi.fn((_cb: () => void) => ({ dispose: vi.fn() })),
      onDidChangeVisibility: vi.fn((_cb: () => void) => ({ dispose: vi.fn() })),
      show: vi.fn(),
    };
    provider.resolveWebviewView(mockView);
    const handler = (mockView.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      (msg: unknown) => Promise<void> | void;
    return { handler, postMessage };
  }

  function flushMicrotasks(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  it('pushes sdContents built from ./sdcard/\'s root entries when the webview requests a refresh', async () => {
    promisesMock['readdir']!.mockImplementation((p: unknown) => {
      const fp = String(p);
      if (fp.endsWith('sdcard')) return Promise.resolve(['LOG.TXT', 'IR_HALL.WAV']);
      return Promise.resolve([]);
    });
    promisesMock['stat']!.mockImplementation((p: unknown) => {
      const fp = String(p);
      if (fp.endsWith('LOG.TXT')) return Promise.resolve({ isFile: () => true, size: 96 });
      if (fp.endsWith('IR_HALL.WAV')) return Promise.resolve({ isFile: () => true, size: 1_887_436 });
      return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    });
    const { activate: act } = await import('../../extension');
    const ctx = makeContext();
    act(ctx);
    await flushMicrotasks();

    const { handler, postMessage } = resolveControlsProvider();
    postMessage.mockClear();
    await handler({ command: 'sdRefresh' });
    await flushMicrotasks();

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'sdContents',
        entries: [
          { name: 'IR_HALL.WAV', size: 1_887_436 },
          { name: 'LOG.TXT', size: 96 },
        ],
      }),
    );
  });

  it('pushes an empty sdContents list when ./sdcard/ does not exist', async () => {
    promisesMock['readdir']!.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    const { activate: act } = await import('../../extension');
    const ctx = makeContext();
    act(ctx);
    await flushMicrotasks();

    const { handler, postMessage } = resolveControlsProvider();
    postMessage.mockClear();
    await handler({ command: 'sdRefresh' });
    await flushMicrotasks();

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'sdContents', entries: [] }),
    );
  });

  it('pushes sdPreview with file content when the webview requests a preview of a readable .txt file', async () => {
    promisesMock['readFile']!.mockImplementation((p: unknown) => {
      const fp = String(p);
      if (fp.endsWith('LOG.TXT')) return Promise.resolve(Buffer.from('[boot] sdcard mounted ok\n'));
      return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    });
    const { activate: act } = await import('../../extension');
    const ctx = makeContext();
    act(ctx);
    await flushMicrotasks();

    const { handler, postMessage } = resolveControlsProvider();
    postMessage.mockClear();
    await handler({ command: 'sdPreview', name: 'LOG.TXT' });
    await flushMicrotasks();

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'sdPreview', name: 'LOG.TXT', content: '[boot] sdcard mounted ok\n' }),
    );
  });

  it('pushes a null sdPreview content for a non-UTF-8 file', async () => {
    promisesMock['readFile']!.mockImplementation((p: unknown) => {
      const fp = String(p);
      if (fp.endsWith('IR_HALL.WAV')) return Promise.resolve(Buffer.from([0xff, 0xfe, 0x00, 0x01]));
      return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    });
    const { activate: act } = await import('../../extension');
    const ctx = makeContext();
    act(ctx);
    await flushMicrotasks();

    const { handler, postMessage } = resolveControlsProvider();
    postMessage.mockClear();
    await handler({ command: 'sdPreview', name: 'IR_HALL.WAV' });
    await flushMicrotasks();

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'sdPreview', name: 'IR_HALL.WAV', content: null }),
    );
  });

  it('rejects a preview request for a name that is not a bare root-level filename', async () => {
    const { activate: act } = await import('../../extension');
    const ctx = makeContext();
    act(ctx);
    await flushMicrotasks();

    const { handler, postMessage } = resolveControlsProvider();
    postMessage.mockClear();
    await handler({ command: 'sdPreview', name: '../secrets.txt' });
    await flushMicrotasks();

    expect(promisesMock['readFile']).not.toHaveBeenCalledWith(
      expect.stringContaining('secrets.txt'), expect.anything(),
    );
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'sdPreview', name: '../secrets.txt', content: null }),
    );
  });
});

// ── FR-UX-2: aggregate/dedupe controllers.yaml validation-error notifications ──

describe('controllers.yaml validation notification aggregation (FR-UX-2)', () => {
  let fsMock: Record<string, ReturnType<typeof vi.fn>>;
  let promisesMock: Record<string, ReturnType<typeof vi.fn>>;

  const INVALID_YAML =
    'controllers:\n  - id: ""\n    label: ""\n    adc_channel: 0\nbuttons: []\nleds: []\n';
  const INVALID_YAML_2 =
    'controllers:\n  - id: "vol"\n    label: ""\n    adc_channel: 0\nbuttons: []\nleds: []\n';

  beforeEach(async () => {
    vi.clearAllMocks();
    managerInstances.length = 0;
    fsMock = (await import('fs')) as unknown as Record<string, ReturnType<typeof vi.fn>>;
    promisesMock = fsMock['promises'] as unknown as Record<string, ReturnType<typeof vi.fn>>;
    promisesMock['access']!.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    promisesMock['readdir']!.mockResolvedValue([]);
    (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = [
      { uri: { fsPath: '/proj' } },
    ];
  });

  afterEach(() => {
    (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = undefined;
  });

  async function triggerLoadViaSave(): Promise<void> {
    const saveCb = (vscode.workspace.onDidSaveTextDocument as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      (doc: { uri: { fsPath: string } }) => Promise<void>;
    await saveCb({ uri: { fsPath: path.join('/proj', 'controllers.yaml') } });
  }

  it('aggregates multiple validation errors into a single warning toast', async () => {
    promisesMock['readFile']!.mockResolvedValue(INVALID_YAML);
    const { activate: act } = await import('../../extension');
    act(makeContext());
    await triggerLoadViaSave();

    const warningCalls = (vscode.window.showWarningMessage as ReturnType<typeof vi.fn>).mock.calls
      .filter((c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('controllers.yaml'));
    expect(warningCalls.length).toBe(1);
  });

  it('does not repeat the warning toast on a subsequent save with the same error set', async () => {
    promisesMock['readFile']!.mockResolvedValue(INVALID_YAML);
    const { activate: act } = await import('../../extension');
    act(makeContext());
    await triggerLoadViaSave();
    (vscode.window.showWarningMessage as ReturnType<typeof vi.fn>).mockClear();
    await triggerLoadViaSave();

    const warningCalls = (vscode.window.showWarningMessage as ReturnType<typeof vi.fn>).mock.calls
      .filter((c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('controllers.yaml'));
    expect(warningCalls.length).toBe(0);
  });

  it('shows a new warning toast when the error set changes', async () => {
    promisesMock['readFile']!.mockResolvedValue(INVALID_YAML);
    const { activate: act } = await import('../../extension');
    act(makeContext());
    await triggerLoadViaSave();
    (vscode.window.showWarningMessage as ReturnType<typeof vi.fn>).mockClear();
    promisesMock['readFile']!.mockResolvedValue(INVALID_YAML_2);
    await triggerLoadViaSave();

    const warningCalls = (vscode.window.showWarningMessage as ReturnType<typeof vi.fn>).mock.calls
      .filter((c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('controllers.yaml'));
    expect(warningCalls.length).toBe(1);
  });

  it('resumes warning on the next distinct error set after a clean save in between', async () => {
    promisesMock['readFile']!.mockResolvedValue(INVALID_YAML);
    const { activate: act } = await import('../../extension');
    act(makeContext());
    await triggerLoadViaSave();
    (vscode.window.showWarningMessage as ReturnType<typeof vi.fn>).mockClear();

    promisesMock['readFile']!.mockResolvedValue('controllers:\nbuttons:\nleds:\n');
    await triggerLoadViaSave();

    promisesMock['readFile']!.mockResolvedValue(INVALID_YAML);
    await triggerLoadViaSave();

    const warningCalls = (vscode.window.showWarningMessage as ReturnType<typeof vi.fn>).mock.calls
      .filter((c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('controllers.yaml'));
    expect(warningCalls.length).toBe(1);
  });
});

// ── FR-IPC-5: applyEdit result checking, duplicate-marker safety, view consistency ──

describe('makeBlockEdit duplicate-marker safety (FR-IPC-5)', () => {
  function makeDoc(text: string): vscode.TextDocument {
    const lines = text.split('\n');
    return {
      lineCount: lines.length,
      lineAt: (n: number) => ({ range: { end: { line: n, character: lines[n]!.length } } }),
    } as unknown as vscode.TextDocument;
  }

  it('falls back to a full-file replacement when the begin marker is duplicated', () => {
    const oldText = [
      '// ds-ide:controls:begin',
      'int a = 1;',
      '// ds-ide:controls:end',
      '// ds-ide:controls:begin', // duplicate begin marker
      'int b = 2;',
    ].join('\n');
    const newText = oldText.replace('int a = 1;', 'int a = 2;');
    const doc = makeDoc(oldText);
    const { edit } = makeBlockEdit(doc, { fsPath: '/proj/effect.cpp' } as unknown as vscode.Uri, oldText, newText);
    const replaceCalls = (edit.replace as ReturnType<typeof vi.fn>).mock.calls;
    // Full-file fallback: exactly one replace() spanning the whole document,
    // not a (mis-paired) partial marker-block range.
    expect(replaceCalls).toHaveLength(1);
    expect(replaceCalls[0]![2]).toBe(newText);
  });

  it('falls back to a full-file replacement when the end marker is duplicated', () => {
    const oldText = [
      '// ds-ide:controls:begin',
      'int a = 1;',
      '// ds-ide:controls:end',
      '// ds-ide:controls:end', // duplicate end marker
    ].join('\n');
    const newText = oldText.replace('int a = 1;', 'int a = 2;');
    const doc = makeDoc(oldText);
    const { edit } = makeBlockEdit(doc, { fsPath: '/proj/effect.cpp' } as unknown as vscode.Uri, oldText, newText);
    const replaceCalls = (edit.replace as ReturnType<typeof vi.fn>).mock.calls;
    expect(replaceCalls).toHaveLength(1);
    expect(replaceCalls[0]![2]).toBe(newText);
  });

  it('still uses a targeted block replacement when markers are unique', () => {
    const oldText = [
      '// ds-ide:controls:begin',
      'int a = 1;',
      '// ds-ide:controls:end',
      '// ds-ide:controls:init:begin',
      'a.Init();',
      '// ds-ide:controls:init:end',
    ].join('\n');
    const newText = oldText.replace('int a = 1;', 'int a = 2;');
    const doc = makeDoc(oldText);
    const { edit } = makeBlockEdit(doc, { fsPath: '/proj/effect.cpp' } as unknown as vscode.Uri, oldText, newText);
    const replaceCalls = (edit.replace as ReturnType<typeof vi.fn>).mock.calls;
    // Both marker pairs are unique and matched — two targeted block
    // replacements, never a full-file fallback.
    expect(replaceCalls).toHaveLength(2);
    for (const call of replaceCalls) {
      expect(call[2]).not.toBe(newText);
    }
  });
});

// ── FR-UX-3: append-with-confirmation for files with no marker blocks yet ──

describe('makeBlockEdit append-with-confirmation (FR-UX-3)', () => {
  function makeDoc(text: string): vscode.TextDocument {
    const lines = text.split('\n');
    return {
      lineCount: lines.length,
      lineAt: (n: number) => ({ range: { end: { line: n, character: lines[n]!.length } } }),
    } as unknown as vscode.TextDocument;
  }

  it('flags needsAppendConfirmation and inserts (not full-file-replaces) when no marker blocks exist yet', () => {
    const oldText = 'int a = 1;\nvoid Process() {}\n';
    const newText = [
      'int a = 1;',
      'void Process() {}',
      '// ds-ide:controls:begin',
      '// ds-ide: id=vol, kind=pot, pin=15',
      '// ds-ide:controls:end',
      '',
    ].join('\n');
    const doc = makeDoc(oldText);
    const { edit, needsAppendConfirmation } = makeBlockEdit(
      doc, { fsPath: '/proj/effect.cpp' } as unknown as vscode.Uri, oldText, newText,
    );
    expect(needsAppendConfirmation).toBe(true);
    expect(edit.replace).not.toHaveBeenCalled();
    expect(edit.insert).toHaveBeenCalledOnce();
    const insertedText = (edit.insert as ReturnType<typeof vi.fn>).mock.calls[0]![2] as string;
    expect(insertedText).toContain('// ds-ide:controls:begin');
    expect(insertedText).toContain('// ds-ide:controls:end');
  });

  it('does not flag needsAppendConfirmation once marker blocks already exist', () => {
    const oldText = [
      '// ds-ide:controls:begin',
      '// ds-ide: id=vol, kind=pot, pin=15',
      '// ds-ide:controls:end',
    ].join('\n');
    const newText = oldText.replace('pin=15', 'pin=16');
    const doc = makeDoc(oldText);
    const { needsAppendConfirmation } = makeBlockEdit(
      doc, { fsPath: '/proj/effect.cpp' } as unknown as vscode.Uri, oldText, newText,
    );
    expect(needsAppendConfirmation).toBe(false);
  });

  it('only touches the newly-appended block, leaving an already-established block untouched, when one pair exists and the other does not', () => {
    const oldText = [
      '// ds-ide:controls:begin',
      '// ds-ide: id=vol, kind=pot, pin=15',
      '// ds-ide:controls:end',
    ].join('\n');
    const newText = [
      '// ds-ide:controls:begin',
      '// ds-ide: id=vol, kind=pot, pin=15',
      '// ds-ide:controls:end',
      '// ds-ide:controls:init:begin',
      '  hardware.adc.Init(ds_ide_adc_cfg, 1);',
      '// ds-ide:controls:init:end',
      '',
    ].join('\n');
    const doc = makeDoc(oldText);
    const { edit, needsAppendConfirmation } = makeBlockEdit(
      doc, { fsPath: '/proj/effect.cpp' } as unknown as vscode.Uri, oldText, newText,
    );
    expect(needsAppendConfirmation).toBe(true);
    // The established decl block gets exactly one targeted, in-place replace
    // at its own already-correct range — never a full-file rewrite that would
    // also touch unrelated lines just because the *other* (init) block is
    // missing. The missing init block is appended via insert(), not replace().
    expect(edit.replace).toHaveBeenCalledOnce();
    const replaceCall = (edit.replace as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(replaceCall[2]).toBe(oldText); // decl block content is unchanged
    expect(edit.insert).toHaveBeenCalledOnce();
    const insertedText = (edit.insert as ReturnType<typeof vi.fn>).mock.calls[0]![2] as string;
    expect(insertedText).toContain('// ds-ide:controls:init:begin');
  });

  // FR-DEV-11 — makeBlockEdit is reused for peripheral enable/disable edits,
  // which live in their own "ds-ide:peripherals:*" marker pair alongside (not
  // instead of) the controls ones.
  it('flags needsAppendConfirmation and appends a peripherals block when none exists yet', () => {
    const oldText = 'int main() {}\n';
    const newText = [
      'int main() {}',
      '// ds-ide:peripherals:begin',
      '  SdmmcHandler ds_ide_sd; FatFSInterface ds_ide_fatfs;',
      '// ds-ide:peripherals:end',
      '',
    ].join('\n');
    const doc = makeDoc(oldText);
    const { edit, needsAppendConfirmation } = makeBlockEdit(
      doc, { fsPath: '/proj/effect.cpp' } as unknown as vscode.Uri, oldText, newText,
    );
    expect(needsAppendConfirmation).toBe(true);
    const insertedText = (edit.insert as ReturnType<typeof vi.fn>).mock.calls[0]![2] as string;
    expect(insertedText).toContain('// ds-ide:peripherals:begin');
  });

  it('in-place replaces an already-established peripherals block, not a full-file rewrite', () => {
    const oldText = [
      'int main() {}',
      '// ds-ide:peripherals:begin',
      '  SdmmcHandler ds_ide_sd; FatFSInterface ds_ide_fatfs;',
      '// ds-ide:peripherals:end',
    ].join('\n');
    const newText = oldText.replace(
      '// ds-ide:peripherals:begin\n  SdmmcHandler ds_ide_sd; FatFSInterface ds_ide_fatfs;\n// ds-ide:peripherals:end',
      '// ds-ide:peripherals:begin\n// ds-ide:peripherals:end',
    );
    const doc = makeDoc(oldText);
    const { needsAppendConfirmation } = makeBlockEdit(
      doc, { fsPath: '/proj/effect.cpp' } as unknown as vscode.Uri, oldText, newText,
    );
    expect(needsAppendConfirmation).toBe(false);
  });
});

describe('wiring edit consistency (FR-IPC-5)', () => {
  let fsMock: Record<string, ReturnType<typeof vi.fn>>;
  let promisesMock: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    managerInstances.length = 0;
    fsMock = (await import('fs')) as unknown as Record<string, ReturnType<typeof vi.fn>>;
    promisesMock = fsMock['promises'] as unknown as Record<string, ReturnType<typeof vi.fn>>;
    promisesMock['access']!.mockImplementation((p: unknown) => {
      const fp = String(p);
      if (fp.endsWith('CMakeLists.txt') || fp.endsWith('.cpp')) return Promise.resolve();
      return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    });
    promisesMock['readdir']!.mockResolvedValue(['effect.cpp']);
    promisesMock['readFile']!.mockResolvedValue('');
    (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = [
      { uri: { fsPath: '/proj' } },
    ];
    (vscode.workspace.applyEdit as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    // The fixture effect.cpp is empty (no marker blocks yet), so every wire/
    // unwire edit in this suite needs the FR-UX-3 append confirmation — the
    // user is assumed to accept it unless a test overrides this.
    (vscode.window.showWarningMessage as ReturnType<typeof vi.fn>).mockResolvedValue('Append');
  });

  afterEach(() => {
    (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = undefined;
  });

  function resolveProvider(viewId: string): { handler: (msg: unknown) => Promise<void> | void; postMessage: ReturnType<typeof vi.fn> } {
    const registerCalls = (vscode.window.registerWebviewViewProvider as ReturnType<typeof vi.fn>).mock.calls;
    const entry = registerCalls.find((c: unknown[]) => c[0] === viewId);
    const provider = entry?.[1] as { resolveWebviewView: (view: unknown) => void };
    const postMessage = vi.fn();
    const mockView = {
      webview: {
        html: '', options: {},
        onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
        postMessage,
        asWebviewUri: vi.fn((u: unknown) => u),
        cspSource: '',
      },
      visible: true,
      onDidDispose: vi.fn((_cb: () => void) => ({ dispose: vi.fn() })),
      onDidChangeVisibility: vi.fn((_cb: () => void) => ({ dispose: vi.fn() })),
      show: vi.fn(),
    };
    provider.resolveWebviewView(mockView);
    const handler = (mockView.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      (msg: unknown) => Promise<void> | void;
    return { handler, postMessage };
  }

  // activate() kicks off initViewsFromProject() fire-and-forget; let its
  // fs-backed promise chain fully settle before attaching mock views so its
  // one-time flush doesn't land in the middle of a test's own assertions.
  function flushMicrotasks(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  it('does not update either view and shows an error when applyEdit returns false on wire', async () => {
    (vscode.workspace.applyEdit as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    const { activate: act } = await import('../../extension');
    const ctx = makeContext();
    act(ctx);
    await flushMicrotasks();
    const wiring = resolveProvider('ds-ide.wiringEditor');
    const controls = resolveProvider('ds-ide.controlsEditor');
    wiring.postMessage.mockClear();
    controls.postMessage.mockClear();

    await wiring.handler({ command: 'wirePin', pinNumber: 15, deviceType: 'pot', id: 'vol' });

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringMatching(/wiring edit/i));
    expect(wiring.postMessage).not.toHaveBeenCalled();
    expect(controls.postMessage).not.toHaveBeenCalled();
  });

  it('does not update either view and shows an error when applyEdit returns false on unwire', async () => {
    (vscode.workspace.applyEdit as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    const { activate: act } = await import('../../extension');
    const ctx = makeContext();
    act(ctx);
    await flushMicrotasks();
    const wiring = resolveProvider('ds-ide.wiringEditor');
    const controls = resolveProvider('ds-ide.controlsEditor');
    wiring.postMessage.mockClear();
    controls.postMessage.mockClear();

    await wiring.handler({ command: 'unwirePin', pinNumber: 15, id: 'vol' });

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringMatching(/wiring edit/i));
    expect(wiring.postMessage).not.toHaveBeenCalled();
    expect(controls.postMessage).not.toHaveBeenCalled();
  });

  it('saves the document after a successful wire so both views reflect the same state without a manual save', async () => {
    const { activate: act } = await import('../../extension');
    const ctx = makeContext();
    act(ctx);
    await flushMicrotasks();
    const wiring = resolveProvider('ds-ide.wiringEditor');
    const controls = resolveProvider('ds-ide.controlsEditor');
    wiring.postMessage.mockClear();
    controls.postMessage.mockClear();

    await wiring.handler({ command: 'wirePin', pinNumber: 15, deviceType: 'pot', id: 'vol' });

    const openDocResults = (vscode.workspace.openTextDocument as ReturnType<typeof vi.fn>).mock.results;
    const doc = await openDocResults[openDocResults.length - 1]!.value as { save: ReturnType<typeof vi.fn> };
    expect(doc.save).toHaveBeenCalled();
    expect(wiring.postMessage).toHaveBeenCalledWith(expect.objectContaining({ command: 'wiredPins' }));
    expect(controls.postMessage).toHaveBeenCalledWith(expect.objectContaining({ command: 'controlsConfig' }));
  });

  it('asks for confirmation before appending marker blocks to a file that has none, and shows the modal option (FR-UX-3)', async () => {
    const { activate: act } = await import('../../extension');
    const ctx = makeContext();
    act(ctx);
    await flushMicrotasks();
    const wiring = resolveProvider('ds-ide.wiringEditor');
    await wiring.handler({ command: 'wirePin', pinNumber: 15, deviceType: 'pot', id: 'vol' });

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('marker blocks'),
      expect.objectContaining({ modal: true }),
      'Append',
    );
  });

  it('does not apply the edit when the user declines the append-marker-blocks confirmation (FR-UX-3)', async () => {
    (vscode.window.showWarningMessage as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    const { activate: act } = await import('../../extension');
    const ctx = makeContext();
    act(ctx);
    await flushMicrotasks();
    const wiring = resolveProvider('ds-ide.wiringEditor');
    const controls = resolveProvider('ds-ide.controlsEditor');
    wiring.postMessage.mockClear();
    controls.postMessage.mockClear();

    await wiring.handler({ command: 'wirePin', pinNumber: 15, deviceType: 'pot', id: 'vol' });

    expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
    expect(wiring.postMessage).not.toHaveBeenCalled();
    expect(controls.postMessage).not.toHaveBeenCalled();
  });
});

describe('setPeripheralEnabled conflict rejection (FR-DEV-13)', () => {
  let fsMock: Record<string, ReturnType<typeof vi.fn>>;
  let promisesMock: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    managerInstances.length = 0;
    fsMock = (await import('fs')) as unknown as Record<string, ReturnType<typeof vi.fn>>;
    promisesMock = fsMock['promises'] as unknown as Record<string, ReturnType<typeof vi.fn>>;
    promisesMock['access']!.mockImplementation((p: unknown) => {
      const fp = String(p);
      if (fp.endsWith('CMakeLists.txt') || fp.endsWith('.cpp')) return Promise.resolve();
      return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    });
    promisesMock['readdir']!.mockResolvedValue(['effect.cpp']);
    (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = [
      { uri: { fsPath: '/proj' } },
    ];
    (vscode.workspace.applyEdit as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  });

  afterEach(() => {
    (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = undefined;
  });

  function resolveProvider(viewId: string): { handler: (msg: unknown) => Promise<void> | void; postMessage: ReturnType<typeof vi.fn> } {
    const registerCalls = (vscode.window.registerWebviewViewProvider as ReturnType<typeof vi.fn>).mock.calls;
    const entry = registerCalls.find((c: unknown[]) => c[0] === viewId);
    const provider = entry?.[1] as { resolveWebviewView: (view: unknown) => void };
    const postMessage = vi.fn();
    const mockView = {
      webview: {
        html: '', options: {},
        onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
        postMessage,
        asWebviewUri: vi.fn((u: unknown) => u),
        cspSource: '',
      },
      visible: true,
      onDidDispose: vi.fn((_cb: () => void) => ({ dispose: vi.fn() })),
      onDidChangeVisibility: vi.fn((_cb: () => void) => ({ dispose: vi.fn() })),
      show: vi.fn(),
    };
    provider.resolveWebviewView(mockView);
    const handler = (mockView.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      (msg: unknown) => Promise<void> | void;
    return { handler, postMessage };
  }

  function flushMicrotasks(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  it('refuses to enable sdcard when a hand-wired control occupies one of its pins, without mutating the file', async () => {
    // D5 carries SDMMC1_CMD — a LED hand-wired there blocks SD Card. The
    // handler reads oldText via doc.getText() (openTextDocument), not
    // fs.readFile — the latter only feeds unrelated view-refresh reads.
    const source = [
      '// ds-ide:controls:begin',
      '// ds-ide: id=led1, kind=led, pin=5',
      '// ds-ide:controls:end',
    ].join('\n');
    (vscode.workspace.openTextDocument as ReturnType<typeof vi.fn>).mockResolvedValue({
      getText: vi.fn(() => source),
      lineCount: source.split('\n').length,
      lineAt: vi.fn((n: number) => ({ range: { end: { line: n, character: source.split('\n')[n]!.length } } })),
      save: vi.fn(async () => true),
    });
    const { activate: act } = await import('../../extension');
    const ctx = makeContext();
    act(ctx);
    await flushMicrotasks();
    const wiring = resolveProvider('ds-ide.wiringEditor');
    wiring.postMessage.mockClear();

    await wiring.handler({ command: 'setPeripheralEnabled', peripheralId: 'sdcard', enabled: true });

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringMatching(/D5.*led1/is));
    expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
    expect(wiring.postMessage).not.toHaveBeenCalled();
  });

  it('enables sdcard when no conflicting occupant exists', async () => {
    const source = 'int main() {}\n';
    (vscode.workspace.openTextDocument as ReturnType<typeof vi.fn>).mockResolvedValue({
      getText: vi.fn(() => source),
      lineCount: 1,
      lineAt: vi.fn((n: number) => ({ range: { end: { line: n, character: 0 } } })),
      save: vi.fn(async () => true),
    });
    const { activate: act } = await import('../../extension');
    const ctx = makeContext();
    act(ctx);
    await flushMicrotasks();
    const wiring = resolveProvider('ds-ide.wiringEditor');
    wiring.postMessage.mockClear();

    await wiring.handler({ command: 'setPeripheralEnabled', peripheralId: 'sdcard', enabled: true });

    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(vscode.workspace.applyEdit).toHaveBeenCalled();
    expect(wiring.postMessage).toHaveBeenCalledWith(expect.objectContaining({ command: 'peripherals' }));
  });

  // The gap a manual test caught: onWirePin never checked a new control's
  // pin against enabled bus peripherals at all — only setPeripheralEnabled
  // checked conflicts, and only in the "enabling a peripheral" direction.
  // Wiring a button onto D3 (SDMMC1_D1, inside SD Card's footprint) or D8
  // (SPI1_SCK, inside OLED's) silently succeeded with no warning.
  it('refuses to wire a button onto a pin already occupied by an enabled bus peripheral (sdcard)', async () => {
    const source = [
      '// ds-ide:peripherals:begin',
      '  SdmmcHandler ds_ide_sd; FatFSInterface ds_ide_fatfs;',
      '// ds-ide:peripherals:end',
    ].join('\n');
    (vscode.workspace.openTextDocument as ReturnType<typeof vi.fn>).mockResolvedValue({
      getText: vi.fn(() => source),
      lineCount: source.split('\n').length,
      lineAt: vi.fn((n: number) => ({ range: { end: { line: n, character: source.split('\n')[n]!.length } } })),
      save: vi.fn(async () => true),
    });
    const { activate: act } = await import('../../extension');
    const ctx = makeContext();
    act(ctx);
    await flushMicrotasks();
    const wiring = resolveProvider('ds-ide.wiringEditor');
    wiring.postMessage.mockClear();

    // D3 = SDMMC1_D1, one of SD Card's six occupied pins.
    await wiring.handler({ command: 'wirePin', pinNumber: 3, deviceType: 'button', id: 'btn1' });

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringMatching(/D3.*SD Card/is));
    expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
    expect(wiring.postMessage).not.toHaveBeenCalled();
  });

  it('refuses to wire a control onto a pin occupied by an enabled multi-bus peripheral (oled)', async () => {
    const source = [
      '// ds-ide:peripherals:begin',
      '  OledDisplay<SSD130x4WireSpi128x64Driver> ds_ide_oled;',
      '// ds-ide:peripherals:end',
    ].join('\n');
    (vscode.workspace.openTextDocument as ReturnType<typeof vi.fn>).mockResolvedValue({
      getText: vi.fn(() => source),
      lineCount: source.split('\n').length,
      lineAt: vi.fn((n: number) => ({ range: { end: { line: n, character: source.split('\n')[n]!.length } } })),
      save: vi.fn(async () => true),
    });
    const { activate: act } = await import('../../extension');
    const ctx = makeContext();
    act(ctx);
    await flushMicrotasks();
    const wiring = resolveProvider('ds-ide.wiringEditor');
    wiring.postMessage.mockClear();

    // D8 = SPI1_SCK, one of OLED's four occupied pins on its default bus (SPI1).
    await wiring.handler({ command: 'wirePin', pinNumber: 8, deviceType: 'button', id: 'btn2' });

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringMatching(/D8.*OLED/is));
    expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
    expect(wiring.postMessage).not.toHaveBeenCalled();
  });

  it('still allows wiring a control onto a pin no enabled peripheral occupies', async () => {
    const source = [
      '// ds-ide:peripherals:begin',
      '  SdmmcHandler ds_ide_sd; FatFSInterface ds_ide_fatfs;',
      '// ds-ide:peripherals:end',
    ].join('\n');
    (vscode.workspace.openTextDocument as ReturnType<typeof vi.fn>).mockResolvedValue({
      getText: vi.fn(() => source),
      lineCount: source.split('\n').length,
      lineAt: vi.fn((n: number) => ({ range: { end: { line: n, character: source.split('\n')[n]!.length } } })),
      save: vi.fn(async () => true),
    });
    const { activate: act } = await import('../../extension');
    const ctx = makeContext();
    act(ctx);
    await flushMicrotasks();
    const wiring = resolveProvider('ds-ide.wiringEditor');
    wiring.postMessage.mockClear();

    // D15 is free — not part of SD Card's D1-D6 footprint.
    await wiring.handler({ command: 'wirePin', pinNumber: 15, deviceType: 'pot', id: 'vol' });

    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(vscode.workspace.applyEdit).toHaveBeenCalled();
  });
});

describe('placement drop (FR-UDM-7)', () => {
  let promisesMock: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    managerInstances.length = 0;
    const fsMock = (await import('fs')) as unknown as Record<string, ReturnType<typeof vi.fn>>;
    promisesMock = fsMock['promises'] as unknown as Record<string, ReturnType<typeof vi.fn>>;
    promisesMock['access']!.mockImplementation((p: unknown) => {
      const fp = String(p);
      if (fp.endsWith('CMakeLists.txt') || fp.endsWith('.cpp')) return Promise.resolve();
      return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    });
    promisesMock['readdir']!.mockResolvedValue(['effect.cpp']);
    (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = [
      { uri: { fsPath: '/proj' } },
    ];
    (vscode.workspace.applyEdit as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (vscode.window.showWarningMessage as ReturnType<typeof vi.fn>).mockResolvedValue('Append');
  });

  afterEach(() => {
    (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = undefined;
  });

  function useSource(source: string): void {
    (vscode.workspace.openTextDocument as ReturnType<typeof vi.fn>).mockResolvedValue({
      getText: vi.fn(() => source),
      lineCount: source.split('\n').length,
      lineAt: vi.fn((n: number) => ({ range: { end: { line: n, character: (source.split('\n')[n] ?? '').length } } })),
      save: vi.fn(async () => true),
    });
  }

  async function wiringHandler(): Promise<(msg: unknown) => Promise<void> | void> {
    const { activate: act } = await import('../../extension');
    act(makeContext());
    await new Promise((resolve) => setTimeout(resolve, 0));
    const registerCalls = (vscode.window.registerWebviewViewProvider as ReturnType<typeof vi.fn>).mock.calls;
    const provider = registerCalls.find((c: unknown[]) => c[0] === 'ds-ide.wiringEditor')?.[1] as
      { resolveWebviewView: (view: unknown) => void };
    const onDidReceiveMessage = vi.fn(() => ({ dispose: vi.fn() }));
    provider.resolveWebviewView({
      webview: { html: '', options: {}, onDidReceiveMessage, postMessage: vi.fn(), asWebviewUri: vi.fn((u: unknown) => u), cspSource: '' },
      visible: true,
      onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
      onDidChangeVisibility: vi.fn(() => ({ dispose: vi.fn() })),
      show: vi.fn(),
    });
    return (onDidReceiveMessage.mock.calls[0] as unknown[])[0] as (msg: unknown) => Promise<void> | void;
  }

  // The FR-UX-3 append path inserts every new marker block as one string.
  function writtenText(): string {
    const edit = (vscode.workspace.applyEdit as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      { insert: ReturnType<typeof vi.fn>; replace: ReturnType<typeof vi.fn> };
    return [...edit.insert.mock.calls, ...edit.replace.mock.calls].map(c => String(c[c.length - 1])).join('\n');
  }

  it('enables a multi-bus peripheral on the lane it was dropped on', async () => {
    useSource('int main() {}\n');
    const handler = await wiringHandler();
    await handler({ command: 'setPeripheralEnabled', peripheralId: 'oled', enabled: true, bus: 'I2C1' });
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(writtenText()).toContain('SSD130xI2c128x64Driver');
    expect(writtenText()).not.toContain('SSD130x4WireSpi128x64Driver');
  });

  it('checks conflicts against the dropped bus, not the default one', async () => {
    // D8 = SPI1_SCK: blocks OLED's default SPI1, but not I2C1 (D11/D12).
    useSource(['// ds-ide:controls:begin', '// ds-ide: id=btn1, kind=button, pin=8', '// ds-ide:controls:end', ''].join('\n'));
    const handler = await wiringHandler();
    await handler({ command: 'setPeripheralEnabled', peripheralId: 'oled', enabled: true, bus: 'I2C1' });
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(vscode.workspace.applyEdit).toHaveBeenCalled();
  });

  it('ignores a bus that is not one of the peripheral\'s candidates', async () => {
    useSource('int main() {}\n');
    const handler = await wiringHandler();
    await handler({ command: 'setPeripheralEnabled', peripheralId: 'oled', enabled: true, bus: 'USART1' });
    await handler({ command: 'setPeripheralEnabled', peripheralId: 'oled', enabled: true, bus: 42 });
    expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
  });

  it('allocates a multi-pin control\'s footprint exactly as the drag preview showed it', async () => {
    // Button on D5 and OLED on SPI1 (D7-D10): computeDropTargets previews
    // an RGB LED dropped on D4 as D4, D6, D11 — the host must write the same.
    useSource([
      '// ds-ide:controls:begin', '// ds-ide: id=btn1, kind=button, pin=5', '// ds-ide:controls:end',
      '// ds-ide:peripherals:begin', '  OledDisplay<SSD130x4WireSpi128x64Driver> ds_ide_oled;', '// ds-ide:peripherals:end', '',
    ].join('\n'));
    const handler = await wiringHandler();
    await handler({ command: 'wirePin', pinNumber: 4, deviceType: 'rgbled', id: 'rgb1' });
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(writtenText()).toContain('pins=4,6,11');
  });
});

describe('replace on conflict drop (FR-UDM-8)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    managerInstances.length = 0;
    const fsMock = (await import('fs')) as unknown as Record<string, ReturnType<typeof vi.fn>>;
    const promisesMock = fsMock['promises'] as unknown as Record<string, ReturnType<typeof vi.fn>>;
    promisesMock['access']!.mockImplementation((p: unknown) => {
      const fp = String(p);
      if (fp.endsWith('CMakeLists.txt') || fp.endsWith('.cpp')) return Promise.resolve();
      return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    });
    promisesMock['readdir']!.mockResolvedValue(['effect.cpp']);
    (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = [
      { uri: { fsPath: '/proj' } },
    ];
    (vscode.workspace.applyEdit as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (vscode.window.showWarningMessage as ReturnType<typeof vi.fn>).mockResolvedValue('Append');
  });

  afterEach(() => {
    (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = undefined;
  });

  function useSource(source: string): void {
    (vscode.workspace.openTextDocument as ReturnType<typeof vi.fn>).mockResolvedValue({
      getText: vi.fn(() => source),
      lineCount: source.split('\n').length,
      lineAt: vi.fn((n: number) => ({ range: { end: { line: n, character: (source.split('\n')[n] ?? '').length } } })),
      save: vi.fn(async () => true),
    });
  }

  async function wiringHandler(): Promise<(msg: unknown) => Promise<void> | void> {
    const { activate: act } = await import('../../extension');
    act(makeContext());
    await new Promise((resolve) => setTimeout(resolve, 0));
    const registerCalls = (vscode.window.registerWebviewViewProvider as ReturnType<typeof vi.fn>).mock.calls;
    const provider = registerCalls.find((c: unknown[]) => c[0] === 'ds-ide.wiringEditor')?.[1] as
      { resolveWebviewView: (view: unknown) => void };
    const onDidReceiveMessage = vi.fn(() => ({ dispose: vi.fn() }));
    provider.resolveWebviewView({
      webview: { html: '', options: {}, onDidReceiveMessage, postMessage: vi.fn(), asWebviewUri: vi.fn((u: unknown) => u), cspSource: '' },
      visible: true,
      onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
      onDidChangeVisibility: vi.fn(() => ({ dispose: vi.fn() })),
      show: vi.fn(),
    });
    return (onDidReceiveMessage.mock.calls[0] as unknown[])[0] as (msg: unknown) => Promise<void> | void;
  }

  function writtenText(): string {
    const edit = (vscode.workspace.applyEdit as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      { insert: ReturnType<typeof vi.fn>; replace: ReturnType<typeof vi.fn> };
    return [...edit.insert.mock.calls, ...edit.replace.mock.calls].map(c => String(c[c.length - 1])).join('\n');
  }

  const controls = (...lines: string[]): string =>
    ['// ds-ide:controls:begin', ...lines, '// ds-ide:controls:end', ''].join('\n');

  it('a control replaces a control in one edit', async () => {
    useSource(controls('// ds-ide: id=vol, kind=pot, pin=15'));
    const handler = await wiringHandler();
    await handler({ command: 'wirePin', pinNumber: 15, deviceType: 'button', id: 'bypass', replace: ['vol'] });
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(vscode.workspace.applyEdit).toHaveBeenCalledTimes(1);
    expect(writtenText()).toContain('id=bypass');
    expect(writtenText()).not.toContain('id=vol');
  });

  it('a peripheral replaces the controls on its lane in one edit', async () => {
    useSource(controls('// ds-ide: id=b1, kind=button, pin=11', '// ds-ide: id=l1, kind=led, pin=12'));
    const handler = await wiringHandler();
    await handler({ command: 'setPeripheralEnabled', peripheralId: 'oled', enabled: true, bus: 'I2C1', replace: ['b1', 'l1'] });
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(vscode.workspace.applyEdit).toHaveBeenCalledTimes(1);
    expect(writtenText()).toContain('SSD130xI2c128x64Driver');
    expect(writtenText()).not.toMatch(/id=b1|id=l1/);
  });

  it('rejects with formatRejection when the source changed underneath (stale replace)', async () => {
    // The webview asked to replace vol, but gain is on D15 now.
    useSource(controls('// ds-ide: id=gain, kind=pot, pin=15'));
    const handler = await wiringHandler();
    await handler({ command: 'wirePin', pinNumber: 15, deviceType: 'button', id: 'bypass', replace: ['vol'] });
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringMatching(/D15.*gain/s));
    expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
  });

  it('drops a malformed replace list', async () => {
    useSource(controls('// ds-ide: id=vol, kind=pot, pin=15'));
    const handler = await wiringHandler();
    await handler({ command: 'wirePin', pinNumber: 15, deviceType: 'button', id: 'bypass', replace: 'vol' });
    await handler({ command: 'wirePin', pinNumber: 15, deviceType: 'button', id: 'bypass', replace: ['bad id'] });
    await handler({ command: 'setPeripheralEnabled', peripheralId: 'oled', enabled: true, replace: [3] });
    expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
  });
});

describe('move by dragging (FR-UDM-9)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    managerInstances.length = 0;
    const fsMock = (await import('fs')) as unknown as Record<string, ReturnType<typeof vi.fn>>;
    const promisesMock = fsMock['promises'] as unknown as Record<string, ReturnType<typeof vi.fn>>;
    promisesMock['access']!.mockImplementation((p: unknown) => {
      const fp = String(p);
      if (fp.endsWith('CMakeLists.txt') || fp.endsWith('.cpp')) return Promise.resolve();
      return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    });
    promisesMock['readdir']!.mockResolvedValue(['effect.cpp']);
    (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = [
      { uri: { fsPath: '/proj' } },
    ];
    (vscode.workspace.applyEdit as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (vscode.window.showWarningMessage as ReturnType<typeof vi.fn>).mockResolvedValue('Append');
  });

  afterEach(() => {
    (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = undefined;
  });

  function useSource(source: string): void {
    (vscode.workspace.openTextDocument as ReturnType<typeof vi.fn>).mockResolvedValue({
      getText: vi.fn(() => source),
      lineCount: source.split('\n').length,
      lineAt: vi.fn((n: number) => ({ range: { end: { line: n, character: (source.split('\n')[n] ?? '').length } } })),
      save: vi.fn(async () => true),
    });
  }

  async function wiringHandler(): Promise<(msg: unknown) => Promise<void> | void> {
    const { activate: act } = await import('../../extension');
    act(makeContext());
    await new Promise((resolve) => setTimeout(resolve, 0));
    const registerCalls = (vscode.window.registerWebviewViewProvider as ReturnType<typeof vi.fn>).mock.calls;
    const provider = registerCalls.find((c: unknown[]) => c[0] === 'ds-ide.wiringEditor')?.[1] as
      { resolveWebviewView: (view: unknown) => void };
    const onDidReceiveMessage = vi.fn(() => ({ dispose: vi.fn() }));
    provider.resolveWebviewView({
      webview: { html: '', options: {}, onDidReceiveMessage, postMessage: vi.fn(), asWebviewUri: vi.fn((u: unknown) => u), cspSource: '' },
      visible: true,
      onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
      onDidChangeVisibility: vi.fn(() => ({ dispose: vi.fn() })),
      show: vi.fn(),
    });
    return (onDidReceiveMessage.mock.calls[0] as unknown[])[0] as (msg: unknown) => Promise<void> | void;
  }

  function writtenText(): string {
    const edit = (vscode.workspace.applyEdit as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      { insert: ReturnType<typeof vi.fn>; replace: ReturnType<typeof vi.fn> };
    return [...edit.insert.mock.calls, ...edit.replace.mock.calls].map(c => String(c[c.length - 1])).join('\n');
  }

  const controls = (...lines: string[]): string =>
    ['// ds-ide:controls:begin', ...lines, '// ds-ide:controls:end', ''].join('\n');

  it('re-places a control on the dropped pin, keeping its id and kind, in one edit', async () => {
    useSource(controls('// ds-ide: id=vol, kind=pot, pin=15'));
    const handler = await wiringHandler();
    await handler({ command: 'moveControl', id: 'vol', pinNumber: 20 });
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(vscode.workspace.applyEdit).toHaveBeenCalledTimes(1);
    expect(writtenText()).toMatch(/id=vol, kind=pot, pin=20/);
    expect(writtenText()).not.toMatch(/pin=15/);
  });

  it('a multi-pin control\'s own pins count as free', async () => {
    useSource(controls('RgbLed rgb1; // ds-ide: id=rgb1, kind=rgbled, pin=15, pins=15,16,17'));
    const handler = await wiringHandler();
    await handler({ command: 'moveControl', id: 'rgb1', pinNumber: 16 });
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(writtenText()).toContain('pins=16,17,18');
  });

  it('a move onto an occupied pin replaces the occupant in the same edit', async () => {
    useSource(controls('// ds-ide: id=vol, kind=pot, pin=15', '// ds-ide: id=gain, kind=pot, pin=16'));
    const handler = await wiringHandler();
    await handler({ command: 'moveControl', id: 'vol', pinNumber: 16, replace: ['gain'] });
    expect(vscode.workspace.applyEdit).toHaveBeenCalledTimes(1);
    expect(writtenText()).toMatch(/id=vol, kind=pot, pin=16/);
    expect(writtenText()).not.toContain('id=gain');
  });

  it('a move without replace onto an occupied pin is rejected, leaving the source untouched', async () => {
    useSource(controls('// ds-ide: id=vol, kind=pot, pin=15', '// ds-ide: id=gain, kind=pot, pin=16'));
    const handler = await wiringHandler();
    await handler({ command: 'moveControl', id: 'vol', pinNumber: 16 });
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringMatching(/D16.*gain/s));
    expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
  });

  it('moving a control that is no longer in the source warns and changes nothing', async () => {
    useSource(controls('// ds-ide: id=gain, kind=pot, pin=16'));
    const handler = await wiringHandler();
    await handler({ command: 'moveControl', id: 'vol', pinNumber: 20 });
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('vol'));
    expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
  });

  it('dropping a placed peripheral on another lane moves it to that bus', async () => {
    useSource(['// ds-ide:peripherals:begin', '  OledDisplay<SSD130x4WireSpi128x64Driver> ds_ide_oled;', '// ds-ide:peripherals:end', ''].join('\n'));
    const handler = await wiringHandler();
    await handler({ command: 'setPeripheralEnabled', peripheralId: 'oled', enabled: true, bus: 'I2C1' });
    expect(vscode.workspace.applyEdit).toHaveBeenCalledTimes(1);
    expect(writtenText()).toContain('SSD130xI2c128x64Driver');
    expect(writtenText()).not.toContain('SSD130x4WireSpi128x64Driver');
  });
});

// ── FR-UX-3: a configured effectSource outside the workspace is refused ──

describe('effectSource containment (FR-UX-3)', () => {
  let fsMock: Record<string, ReturnType<typeof vi.fn>>;
  let promisesMock: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    managerInstances.length = 0;
    fsMock = (await import('fs')) as unknown as Record<string, ReturnType<typeof vi.fn>>;
    promisesMock = fsMock['promises'] as unknown as Record<string, ReturnType<typeof vi.fn>>;
    promisesMock['access']!.mockResolvedValue(undefined);
    promisesMock['readdir']!.mockResolvedValue([]);
    promisesMock['readFile']!.mockResolvedValue('');
    (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = [
      { uri: { fsPath: '/proj' } },
    ];
    (vscode.workspace.getConfiguration as ReturnType<typeof vi.fn>).mockReturnValue({
      get: vi.fn((key: string) => key === 'effectSource' ? '/etc/passwd' : undefined),
    });
  });

  afterEach(() => {
    (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = undefined;
    // getConfiguration's mockReturnValue (unlike the other mocks reset via
    // vi.clearAllMocks() in every describe's beforeEach) persists across
    // describes until explicitly replaced — leaving 'effectSource' pointing
    // at '/etc/passwd' broke every later describe's findEffectSource() calls
    // silently, since they don't set their own getConfiguration override.
    (vscode.workspace.getConfiguration as ReturnType<typeof vi.fn>).mockReturnValue({ get: vi.fn() });
  });

  function flushMicrotasks(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  it('shows an actionable error instead of silently using an effectSource path outside the workspace', async () => {
    const { activate: act } = await import('../../extension');
    const ctx = makeContext();
    act(ctx);
    await flushMicrotasks();

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringMatching(/effectSource.*outside the workspace/i),
    );
    expect(promisesMock['access']).not.toHaveBeenCalled();
  });
});

// ── FR-IPC-7: single deploy coordinator, no divergent post-deploy replay ──

describe('deploy sequencing via DeployCoordinator (FR-IPC-7)', () => {
  let fsMock: Record<string, ReturnType<typeof vi.fn>>;
  let promisesMock: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    managerInstances.length = 0;
    fsMock = (await import('fs')) as unknown as Record<string, ReturnType<typeof vi.fn>>;
    promisesMock = fsMock['promises'] as unknown as Record<string, ReturnType<typeof vi.fn>>;
    promisesMock['access']!.mockImplementation((p: unknown) => {
      const fp = String(p);
      if (fp.endsWith('CMakeLists.txt') || fp.endsWith('.cpp')) return Promise.resolve();
      return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    });
    promisesMock['readdir']!.mockResolvedValue(['effect.cpp']);
    promisesMock['readFile']!.mockImplementation((p: unknown) => {
      const fp = String(p);
      if (fp.endsWith('.cpp')) return Promise.resolve('// ds-ide:controls\n// ds-ide:pot vol 15\n');
      if (fp.endsWith('controllers.yaml')) return Promise.resolve('pots: []\nbuttons: []\nleds: []\n');
      return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    });
    (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = [
      { uri: { fsPath: '/proj' } },
    ];
    // Reset to the global default shape (see src/__mocks__/vscode.ts) —
    // openTextDocument's mockResolvedValue persists across tests otherwise,
    // so a prior test's override (e.g. an OLED-enabled source) would
    // silently leak into this one (FR-DEV-15).
    (vscode.workspace.openTextDocument as ReturnType<typeof vi.fn>).mockResolvedValue({
      getText: () => '',
      lineCount: 1,
      lineAt: (n: number) => ({ range: { end: { line: n, character: 0 } } }),
      save: async () => true,
    });
  });

  afterEach(() => {
    (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = undefined;
  });

  function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  function getCommand(id: string): ((...args: unknown[]) => unknown) | undefined {
    const calls = (vscode.commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
    return calls.find((c: unknown[]) => c[0] === id)?.[1] as ((...args: unknown[]) => unknown) | undefined;
  }

  interface ManagerSpies {
    build: ReturnType<typeof vi.fn>;
    deploy: ReturnType<typeof vi.fn>;
    sendControlSnapshot: ReturnType<typeof vi.fn>;
    sendSine: ReturnType<typeof vi.fn>;
    sendAudioMode: ReturnType<typeof vi.fn>;
    sendAudioDevice: ReturnType<typeof vi.fn>;
  }

  it('ds-ide.deploy replays pot+button/sine/audioMode/audioDevice state after a successful deploy (FR-DEV-1)', async () => {
    const { activate: act } = await import('../../extension');
    const ctx = makeContext();
    act(ctx);
    await flush();
    const mgr = managerInstances[0]! as unknown as ManagerSpies;
    const deployCmd = getCommand('ds-ide.deploy')!;
    await deployCmd();
    expect(mgr.sendControlSnapshot).toHaveBeenCalled();
    expect(mgr.sendSine).toHaveBeenCalled();
    expect(mgr.sendAudioMode).toHaveBeenCalled();
    expect(mgr.sendAudioDevice).toHaveBeenCalled();
  });

  it('ds-ide.deploy opens the OLED viewer when the deployed effect has OLED enabled (FR-DEV-15)', async () => {
    (vscode.workspace.openTextDocument as ReturnType<typeof vi.fn>).mockResolvedValue({
      getText: vi.fn(() => [
        '// ds-ide:peripherals:begin',
        '  OledDisplay<SSD130x4WireSpi128x64Driver> ds_ide_oled;',
        '// ds-ide:peripherals:end',
      ].join('\n')),
      lineCount: 3,
      lineAt: vi.fn((n: number) => ({ range: { end: { line: n, character: 0 } } })),
      save: vi.fn(async () => true),
    });
    const { activate: act } = await import('../../extension');
    const ctx = makeContext();
    act(ctx);
    await flush();
    const deployCmd = getCommand('ds-ide.deploy')!;
    await deployCmd();
    await flush();
    const calls = (vscode.window.createWebviewPanel as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some((c: unknown[]) => c[0] === 'daisy-oled')).toBe(true);
  });

  it('ds-ide.deploy does not open the OLED viewer when the deployed effect has no OLED enabled', async () => {
    const { activate: act } = await import('../../extension');
    const ctx = makeContext();
    act(ctx);
    await flush();
    const deployCmd = getCommand('ds-ide.deploy')!;
    await deployCmd();
    await flush();
    const calls = (vscode.window.createWebviewPanel as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some((c: unknown[]) => c[0] === 'daisy-oled')).toBe(false);
  });

  it('ds-ide.debug replays the same post-deploy state sequence via the shared coordinator', async () => {
    const { activate: act } = await import('../../extension');
    const ctx = makeContext();
    act(ctx);
    await flush();
    const mgr = managerInstances[0]! as unknown as ManagerSpies;
    const debugCmd = getCommand('ds-ide.debug')!;
    await debugCmd();
    expect(mgr.sendControlSnapshot).toHaveBeenCalled();
    expect(mgr.sendSine).toHaveBeenCalled();
    expect(mgr.sendAudioMode).toHaveBeenCalled();
    expect(mgr.sendAudioDevice).toHaveBeenCalled();
  });

  it('ds-ide.buildAndDeploy builds first, then replays the same post-deploy state sequence', async () => {
    const { activate: act } = await import('../../extension');
    const ctx = makeContext();
    act(ctx);
    await flush();
    const mgr = managerInstances[0]! as unknown as ManagerSpies;
    const cmd = getCommand('ds-ide.buildAndDeploy')!;
    await cmd();
    expect(mgr.build).toHaveBeenCalled();
    expect(mgr.sendControlSnapshot).toHaveBeenCalled();
    expect(mgr.sendAudioMode).toHaveBeenCalled();
  });

  it('ds-ide.build/buildAndDeploy/deploy/debug report progress via a cancellable withProgress notification (FR-EXT-16)', async () => {
    const { activate: act } = await import('../../extension');
    const ctx = makeContext();
    act(ctx);
    await flush();

    (vscode.window.withProgress as ReturnType<typeof vi.fn>).mockClear();

    for (const id of ['ds-ide.build', 'ds-ide.buildAndDeploy', 'ds-ide.deploy', 'ds-ide.debug']) {
      await getCommand(id)!();
    }

    // Each also reports on the Daisy view (FR-TRN-4) — that location has no
    // cancel button; the notification is the cancellable one.
    const notifications = (vscode.window.withProgress as ReturnType<typeof vi.fn>).mock.calls
      .map(([options]) => options).filter((o) => o.location === vscode.ProgressLocation.Notification);
    expect(notifications.length).toBeGreaterThanOrEqual(4);
    for (const options of notifications) {
      expect(options).toMatchObject({ cancellable: true });
    }
  });

  it('ds-ide.deploy sets the state item to deploying, then back to stopped when deploy fails', async () => {
    const { activate: act } = await import('../../extension');
    const ctx = makeContext();
    act(ctx);
    await flush();
    const mgr = managerInstances[0]! as unknown as ManagerSpies;
    let duringDeploy = '';
    const statusBar = (vscode.window.createStatusBarItem as ReturnType<typeof vi.fn>).mock.results[0]?.value as { text: string };
    mgr.deploy.mockImplementationOnce(() => { duringDeploy = statusBar.text; return Promise.reject(new Error('boom')); });
    const deployCmd = getCommand('ds-ide.deploy')!;
    await deployCmd();
    expect(duringDeploy).toContain('deploying');
    expect(statusBar.text).toContain('stopped');
  });

  it('shows the state items once the workspace is known to be a Daisy project (FR-TRN-5)', async () => {
    const { activate: act } = await import('../../extension');
    act(makeContext());
    const results = (vscode.window.createStatusBarItem as ReturnType<typeof vi.fn>).mock.results.map((r) => r.value);
    for (const item of results) expect(item.show).not.toHaveBeenCalled();
    // this suite's workspace has an effect.cpp → a Daisy project
    await vi.waitFor(() => {
      for (const item of results) expect(item.show).toHaveBeenCalled();
    });
  });

  it('a failed build publishes the buildFailed transport phase (FR-TRN-4)', async () => {
    const { activate: act } = await import('../../extension');
    act(makeContext());
    await flush();
    const mgr = managerInstances[0]! as unknown as ManagerSpies;
    mgr.build.mockRejectedValueOnce(new Error('build failed'));
    await getCommand('ds-ide.buildAndDeploy')!();
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('setContext', 'ds-ide.transportPhase', 'building');
    expect(vscode.commands.executeCommand).toHaveBeenLastCalledWith('setContext', 'ds-ide.transportPhase', 'buildFailed');
  });

  it('a successful build + deploy publishes building → deploying → running (FR-TRN-4)', async () => {
    const { activate: act } = await import('../../extension');
    act(makeContext());
    await flush();
    (vscode.commands.executeCommand as ReturnType<typeof vi.fn>).mockClear();
    await getCommand('ds-ide.buildAndDeploy')!();
    const phases = (vscode.commands.executeCommand as ReturnType<typeof vi.fn>).mock.calls
      .filter((c) => c[0] === 'setContext' && c[1] === 'ds-ide.transportPhase').map((c) => c[2]);
    expect(phases).toEqual(['building', 'deploying', 'running']);
  });

  it('ds-ide.buildAndDeploy does not deploy when the build step fails', async () => {
    const { activate: act } = await import('../../extension');
    const ctx = makeContext();
    act(ctx);
    await flush();
    const mgr = managerInstances[0]! as unknown as ManagerSpies;
    mgr.build.mockRejectedValueOnce(new Error('build failed'));
    const cmd = getCommand('ds-ide.buildAndDeploy')!;
    await cmd();
    expect(mgr.sendControlSnapshot).not.toHaveBeenCalled();
  });
});

// ── FR-UX-4: multi-root workspace folder selection ──

describe('multi-root workspace folder selection (FR-UX-4)', () => {
  function makeStatefulContext(): vscode.ExtensionContext {
    const store: Record<string, unknown> = {};
    return {
      subscriptions: [],
      extensionPath: '/ext',
      extensionUri: { fsPath: '/ext' },
      workspaceState: {
        get: (key: string, defaultValue?: unknown) => (key in store ? store[key] : defaultValue),
        update: (key: string, value: unknown) => { store[key] = value; return Promise.resolve(); },
        keys: () => Object.keys(store),
      },
    } as unknown as vscode.ExtensionContext;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    managerInstances.length = 0;
    (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = [
      { uri: { fsPath: '/a' }, name: 'a' },
      { uri: { fsPath: '/b' }, name: 'b' },
    ];
  });

  afterEach(() => {
    (vscode.workspace as unknown as Record<string, unknown>)['workspaceFolders'] = undefined;
  });

  it('shows an info message naming the currently-active folder, with a Select Folder action', async () => {
    const { activate: act } = await import('../../extension');
    act(makeStatefulContext());

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining("operating on 'a'"),
      'Select Folder…',
    );
  });

  it('ds-ide.selectActiveFolder persists the chosen folder so it wins on the next resolution', async () => {
    (vscode.window.showQuickPick as ReturnType<typeof vi.fn>).mockImplementation(
      async (items: Array<{ folder: { uri: { fsPath: string } } }>) => items[1],
    );
    const { activate: act } = await import('../../extension');
    const ctx = makeStatefulContext();
    act(ctx);

    const calls = (vscode.commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
    const selectCmd = calls.find((c: unknown[]) => c[0] === 'ds-ide.selectActiveFolder')?.[1] as () => Promise<void>;
    await selectCmd();

    expect(ctx.workspaceState.get('ds-ide.activeFolder')).toBe('/b');
  });
});

// ── FR-UDM-4: Reveal in code ─────────────────────────────────────────────────

describe('findDeviceDeclarationLine (FR-UDM-4)', () => {
  const SRC = [
    '#include "daisy_seed.h"',                                            // 0
    '// ds-ide:controls:begin',                                           // 1
    '  AdcChannelConfig adc_cfg[1];',                                     // 2
    '  // ds-ide: id=vol, kind=pot, pin=15',                              // 3
    '  RgbLed rgb1; // ds-ide: id=rgb1, kind=rgbled, pin=20, pins=20/21/22', // 4
    '  Switch vol2; // ds-ide: id=vol2, kind=button, pin=5',              // 5
    '// ds-ide:controls:end',                                             // 6
    '// ds-ide:peripherals:begin',                                        // 7
    oledCodegen.declLine('I2C1'),                                        // 8
    '// ds-ide:peripherals:end',                                          // 9
  ].join('\n');

  it('finds a control\'s annotated declaration inside the controls block', () => {
    expect(findDeviceDeclarationLine(SRC, 'vol')).toEqual({ line: 3 });
    expect(findDeviceDeclarationLine(SRC, 'rgb1')).toEqual({ line: 4 });
    // `vol` must not match `vol2`'s annotation and vice versa
    expect(findDeviceDeclarationLine(SRC, 'vol2')).toEqual({ line: 5 });
  });

  it('finds a bus peripheral\'s declaration inside the peripherals block', () => {
    expect(findDeviceDeclarationLine(SRC, 'oled')).toEqual({ line: 8 });
  });

  it('reports not-found for an unknown id, a disabled peripheral or a hand-deleted annotation', () => {
    expect(findDeviceDeclarationLine(SRC, 'nope')).toBe('not-found');
    expect(findDeviceDeclarationLine(SRC, 'sdcard')).toBe('not-found');
    expect(findDeviceDeclarationLine(SRC.replace('// ds-ide: id=vol, kind=pot, pin=15', '// hand edited'), 'vol')).toBe('not-found');
  });

  it('refuses to locate anything inside a corrupted (duplicated) marker block', () => {
    const dup = SRC.replace('// ds-ide:controls:end', '// ds-ide:controls:end\n// ds-ide:controls:end');
    expect(findDeviceDeclarationLine(dup, 'vol')).toBe('ambiguous');
  });

  it('ignores a matching annotation outside the marker block', () => {
    const outside = SRC + '\n  // ds-ide: id=ghost, kind=pot, pin=16';
    expect(findDeviceDeclarationLine(outside, 'ghost')).toBe('not-found');
  });
});

describe('revealDeviceInCode (FR-UDM-4)', () => {
  const SRC = ['// ds-ide:controls:begin', '  Switch btn1; // ds-ide: id=btn1, kind=button, pin=5', '// ds-ide:controls:end'].join('\n');

  beforeEach(() => {
    vi.clearAllMocks();
    (vscode.workspace.openTextDocument as ReturnType<typeof vi.fn>).mockResolvedValue({
      getText: () => SRC,
      lineAt: (n: number) => ({ text: SRC.split('\n')[n]!, range: { end: new vscode.Position(n, SRC.split('\n')[n]!.length) } }),
    });
  });

  it('opens the effect source and selects + reveals the declaration line', async () => {
    const editor = { selection: undefined as unknown, revealRange: vi.fn() };
    (vscode.window.showTextDocument as ReturnType<typeof vi.fn>).mockResolvedValue(editor);
    await revealDeviceInCode('/proj/effect.cpp', 'btn1');
    expect(vscode.window.showTextDocument).toHaveBeenCalled();
    const sel = editor.selection as vscode.Selection & { anchorLine: number; activeLine: number };
    expect(sel.anchorLine).toBe(1);
    expect(sel.activeLine).toBe(1);
    expect(editor.revealRange).toHaveBeenCalled();
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });

  it('warns naming the device and reveals nothing when the declaration is missing', async () => {
    await revealDeviceInCode('/proj/effect.cpp', 'ghost');
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('ghost'));
    expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
  });

  it('warns with the peripheral\'s label when its declaration is missing', async () => {
    await revealDeviceInCode('/proj/effect.cpp', 'oled');
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('OLED'));
    expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
  });
});
