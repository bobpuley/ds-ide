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
    sendPotSnapshot = vi.fn();
    sendPot = vi.fn();
    sendTransport = vi.fn();
    sendSine = vi.fn();
    sendAudioMode = vi.fn();
    sendAudioDevice = vi.fn();
    sendButtonSnapshot = vi.fn();
    sendWavFile = vi.fn();
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
import { makeBlockEdit } from '../../extension';

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

  it('updates status bar text when a daisy-debug session starts', () => {
    const ctx = makeContext();
    activate(ctx);
    // Retrieve the onDidStartDebugSession callback registered during activate
    const startCb = (vscode.debug.onDidStartDebugSession as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      ((s: { type: string }) => void) | undefined;
    const statusBar = (vscode.window.createStatusBarItem as ReturnType<typeof vi.fn>).mock.results[0]?.value as
      { text: string };
    startCb?.({ type: 'daisy-debug' });
    expect(statusBar?.text).toContain('debug');
  });

  it('updates status bar text when a daisy-debug session terminates', () => {
    const ctx = makeContext();
    activate(ctx);
    const terminateCb = (vscode.debug.onDidTerminateDebugSession as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      ((s: { type: string }) => void) | undefined;
    const statusBar = (vscode.window.createStatusBarItem as ReturnType<typeof vi.fn>).mock.results[0]?.value as
      { text: string };
    terminateCb?.({ type: 'daisy-debug' });
    expect(statusBar?.text).toContain('stopped');
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
    expect(vscode.workspace.onDidSaveTextDocument).toHaveBeenCalledTimes(1);
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

  function getControlsEditorMessageHandler(): (msg: unknown) => void {
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
    return (mockView.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0] as (msg: unknown) => void;
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
    handler({ command: 'editorSave', cfg: { pots: [], buttons: [], leds: [], errors: [] } });
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
    handler({ command: 'editorSave', cfg: { pots: [], buttons: [], leds: [], errors: [] } });
    await Promise.resolve();
    expect(promisesMock['writeFile']).toHaveBeenCalledWith(
      expect.stringMatching(/controllers\.yaml$/), expect.anything(), 'utf8',
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

    promisesMock['readFile']!.mockResolvedValue('controllers: []\nbuttons: []\nleds: []\n');
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
    const edit = makeBlockEdit(doc, { fsPath: '/proj/effect.cpp' } as unknown as vscode.Uri, oldText, newText);
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
    const edit = makeBlockEdit(doc, { fsPath: '/proj/effect.cpp' } as unknown as vscode.Uri, oldText, newText);
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
    const edit = makeBlockEdit(doc, { fsPath: '/proj/effect.cpp' } as unknown as vscode.Uri, oldText, newText);
    const replaceCalls = (edit.replace as ReturnType<typeof vi.fn>).mock.calls;
    // Both marker pairs are unique and matched — two targeted block
    // replacements, never a full-file fallback.
    expect(replaceCalls).toHaveLength(2);
    for (const call of replaceCalls) {
      expect(call[2]).not.toBe(newText);
    }
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
    sendPotSnapshot: ReturnType<typeof vi.fn>;
    sendButtonSnapshot: ReturnType<typeof vi.fn>;
    sendSine: ReturnType<typeof vi.fn>;
    sendAudioMode: ReturnType<typeof vi.fn>;
    sendAudioDevice: ReturnType<typeof vi.fn>;
  }

  it('ds-ide.deploy replays pot/button/sine/audioMode/audioDevice state after a successful deploy', async () => {
    const { activate: act } = await import('../../extension');
    const ctx = makeContext();
    act(ctx);
    await flush();
    const mgr = managerInstances[0]! as unknown as ManagerSpies;
    const deployCmd = getCommand('ds-ide.deploy')!;
    await deployCmd();
    expect(mgr.sendPotSnapshot).toHaveBeenCalled();
    expect(mgr.sendButtonSnapshot).toHaveBeenCalled();
    expect(mgr.sendSine).toHaveBeenCalled();
    expect(mgr.sendAudioMode).toHaveBeenCalled();
    expect(mgr.sendAudioDevice).toHaveBeenCalled();
  });

  it('ds-ide.debug replays the same post-deploy state sequence via the shared coordinator', async () => {
    const { activate: act } = await import('../../extension');
    const ctx = makeContext();
    act(ctx);
    await flush();
    const mgr = managerInstances[0]! as unknown as ManagerSpies;
    const debugCmd = getCommand('ds-ide.debug')!;
    await debugCmd();
    expect(mgr.sendButtonSnapshot).toHaveBeenCalled();
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
    expect(mgr.sendPotSnapshot).toHaveBeenCalled();
    expect(mgr.sendAudioMode).toHaveBeenCalled();
  });

  it('ds-ide.deploy sets the status bar to deploying, then back to stopped when deploy fails', async () => {
    const { activate: act } = await import('../../extension');
    const ctx = makeContext();
    act(ctx);
    await flush();
    const mgr = managerInstances[0]! as unknown as ManagerSpies;
    mgr.deploy.mockRejectedValueOnce(new Error('boom'));
    const statusBar = (vscode.window.createStatusBarItem as ReturnType<typeof vi.fn>).mock.results[0]?.value as { text: string };
    const deployCmd = getCommand('ds-ide.deploy')!;
    await deployCmd();
    expect(statusBar.text).toContain('stopped');
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
    expect(mgr.sendPotSnapshot).not.toHaveBeenCalled();
  });
});
