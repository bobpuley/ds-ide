import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import * as vscode from 'vscode';
import path from 'path';

vi.mock('fs', () => {
  const promises = {
    readFile: vi.fn(() => Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))),
    access: vi.fn(() => Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))),
    readdir: vi.fn(() => Promise.resolve([])),
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
    constructor() {
      super();
      managerInstances.push(this);
    }
  }
  return { EmulatorManager: MockEmulatorManager };
});

// Import under test — vscode resolved from __mocks__ via vitest.config.ts alias.
import { activate, deactivate } from '../../extension';

function makeContext(): vscode.ExtensionContext {
  return {
    subscriptions: [],
    extensionPath: '/ext',
    workspaceState: {
      get: (_key: string, defaultValue?: unknown) => defaultValue,
      update: (_key: string, _value: unknown) => Promise.resolve(),
      keys: () => [],
    },
  } as unknown as vscode.ExtensionContext;
}

describe('extension', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    managerInstances.length = 0;
  });

  it('exports activate and deactivate', () => {
    expect(typeof activate).toBe('function');
    expect(typeof deactivate).toBe('function');
  });

  it('activate registers all commands', () => {
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
  });

  it('activate pushes disposables onto context.subscriptions', () => {
    const ctx = makeContext();
    activate(ctx);
    // diagnostics + 3 output channels + statusBar + daisy-debug descriptor factory + tracker factory + ds-ide descriptor factory + run config provider + 2 webview view providers + onDidSaveTextDocument + 11 commands + 1 manager/scope dispose + 2 debug session disposables
    expect((ctx.subscriptions as unknown[]).length).toBe(26);
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

  it('routes type:led manager messages to controlsViewProvider', () => {
    const ctx = makeContext();
    activate(ctx);
    const mgr = managerInstances[0]!;

    // Resolve the controls view so postLed has a webview to write to
    const regCalls = (vscode.window.registerWebviewViewProvider as ReturnType<typeof vi.fn>).mock.calls;
    const controlsEntry = regCalls.find((c: unknown[]) => c[0] === 'ds-ide.controlsEditor');
    const controlsProvider = controlsEntry?.[1] as { resolveWebviewView: (v: unknown) => void } | undefined;
    const view = { visible: true, webview: { options: {}, html: '', postMessage: vi.fn(), onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })) }, onDidChangeVisibility: vi.fn(() => ({ dispose: vi.fn() })) };
    controlsProvider?.resolveWebviewView(view as never);

    mgr.emit('message', { type: 'led', gpioPin: 23, lit: true });

    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'led', gpioPin: 23, lit: true }),
    );
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

// ── FR-VW-1: mutual exclusion between Controls and Wiring sidebar panels ─────

function makeWebviewView(initiallyVisible = false) {
  let _visible = initiallyVisible;
  const visHandlers: (() => void)[] = [];
  return {
    get visible() { return _visible; },
    webview: {
      options: {} as Record<string, unknown>,
      html: '',
      postMessage: vi.fn(),
      onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
    },
    onDidChangeVisibility: vi.fn((cb: () => void) => {
      visHandlers.push(cb);
      return { dispose: vi.fn() };
    }),
    _setVisible: (v: boolean) => {
      _visible = v;
      visHandlers.forEach(h => h());
    },
  };
}

describe('extension view exclusivity (FR-VW-1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    managerInstances.length = 0;
    (vscode.workspace as unknown as Record<string, unknown>).workspaceFolders = undefined;
    // executeCommand must return a Promise so the guard's .then()/.finally() chain works
    (vscode.commands.executeCommand as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  function setupBothProviders() {
    const ctx = makeContext();
    activate(ctx);
    const regCalls = (vscode.window.registerWebviewViewProvider as ReturnType<typeof vi.fn>).mock.calls;
    const controlsEntry  = regCalls.find((c: unknown[]) => c[0] === 'ds-ide.controlsEditor');
    const wiringEntry    = regCalls.find((c: unknown[]) => c[0] === 'ds-ide.wiringEditor');
    const controlsProvider = controlsEntry?.[1] as { resolveWebviewView: (v: unknown) => void } | undefined;
    const wiringProvider   = wiringEntry?.[1]   as { resolveWebviewView: (v: unknown) => void } | undefined;
    const controlsView = makeWebviewView(true);  // starts visible so sibling check passes
    const wiringView   = makeWebviewView(true);
    controlsProvider?.resolveWebviewView(controlsView as never);
    wiringProvider?.resolveWebviewView(wiringView as never);
    return { controlsView, wiringView };
  }

  // Drains all pending microtasks (and any microtasks they schedule).
  // Using setImmediate guarantees the event loop processes the full microtask queue
  // before resuming the test, even with chained awaits inside the implementation.
  const drainMicrotasks = () => new Promise<void>(resolve => setImmediate(resolve));

  it('issues focus+collapseSection+focus sequence when Controls becomes visible and Wiring is open', async () => {
    const { controlsView } = setupBothProviders();
    (vscode.commands.executeCommand as ReturnType<typeof vi.fn>).mockClear();

    controlsView._setVisible(true);
    await drainMicrotasks();

    const calls = (vscode.commands.executeCommand as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => c[0] as string);
    expect(calls).toContain('ds-ide.wiringEditor.focus');
    expect(calls).toContain('workbench.action.collapseSection');
    expect(calls).toContain('ds-ide.controlsEditor.focus');
    const wiringFocusIdx     = calls.indexOf('ds-ide.wiringEditor.focus');
    const collapseSectionIdx = calls.indexOf('workbench.action.collapseSection');
    const controlsFocusIdx   = calls.lastIndexOf('ds-ide.controlsEditor.focus');
    expect(wiringFocusIdx).toBeLessThan(collapseSectionIdx);
    expect(collapseSectionIdx).toBeLessThan(controlsFocusIdx);
  });

  it('issues focus+collapseSection+focus sequence when Wiring becomes visible and Controls is open', async () => {
    const { wiringView } = setupBothProviders();
    (vscode.commands.executeCommand as ReturnType<typeof vi.fn>).mockClear();

    wiringView._setVisible(true);
    await drainMicrotasks();

    const calls = (vscode.commands.executeCommand as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => c[0] as string);
    expect(calls).toContain('ds-ide.controlsEditor.focus');
    expect(calls).toContain('workbench.action.collapseSection');
    expect(calls).toContain('ds-ide.wiringEditor.focus');
    const controlsFocusIdx   = calls.indexOf('ds-ide.controlsEditor.focus');
    const collapseSectionIdx = calls.indexOf('workbench.action.collapseSection');
    const wiringFocusIdx     = calls.lastIndexOf('ds-ide.wiringEditor.focus');
    expect(controlsFocusIdx).toBeLessThan(collapseSectionIdx);
    expect(collapseSectionIdx).toBeLessThan(wiringFocusIdx);
  });

  it('does not trigger collapse sequence when sibling is already collapsed (not visible)', async () => {
    const ctx = makeContext();
    activate(ctx);
    const regCalls = (vscode.window.registerWebviewViewProvider as ReturnType<typeof vi.fn>).mock.calls;
    const controlsEntry = regCalls.find((c: unknown[]) => c[0] === 'ds-ide.controlsEditor');
    const wiringEntry   = regCalls.find((c: unknown[]) => c[0] === 'ds-ide.wiringEditor');
    const controlsProvider = controlsEntry?.[1] as { resolveWebviewView: (v: unknown) => void } | undefined;
    const wiringProvider   = wiringEntry?.[1]   as { resolveWebviewView: (v: unknown) => void } | undefined;
    const controlsView = makeWebviewView(false);
    const wiringView   = makeWebviewView(false); // already collapsed
    controlsProvider?.resolveWebviewView(controlsView as never);
    wiringProvider?.resolveWebviewView(wiringView as never);

    (vscode.commands.executeCommand as ReturnType<typeof vi.fn>).mockClear();
    controlsView._setVisible(true);
    await drainMicrotasks();

    const calls = (vscode.commands.executeCommand as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => c[0] as string);
    expect(calls).not.toContain('workbench.action.collapseSection');
  });

  it('guard prevents re-entrant collapse when view visibility changes during the command sequence', async () => {
    const { controlsView, wiringView } = setupBothProviders();

    let callCount = 0;
    (vscode.commands.executeCommand as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      // Simulate focus/collapse triggering visibility events — guard should block re-entry
      wiringView._setVisible(false);
      wiringView._setVisible(true);
      return Promise.resolve();
    });

    controlsView._setVisible(true);
    await drainMicrotasks();

    // 3-step sequence (focus sibling + collapseSection + refocus self);
    // guard must prevent any additional collapse from re-entrant visibility events
    expect(callCount).toBeLessThanOrEqual(3);
  });
});

// ── FR-CE-9 / FR-WE-11: initialize views on project open + refresh on save ──

describe('extension view initialization (FR-CE-9, FR-WE-11)', () => {
  let fsMock: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    managerInstances.length = 0;
    fsMock = (await import('fs')) as unknown as Record<string, ReturnType<typeof vi.fn>>;
    const promisesMock = fsMock['promises'] as Record<string, ReturnType<typeof vi.fn>>;
    promisesMock['access'].mockImplementation((p: unknown) => {
      const fp = String(p);
      if (fp.endsWith('CMakeLists.txt') || fp.endsWith('.cpp')) return Promise.resolve();
      return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    });
    promisesMock['readdir'].mockResolvedValue(['effect.cpp']);
    promisesMock['readFile'].mockImplementation((p: unknown) => {
      const fp = String(p);
      if (fp.endsWith('.cpp')) return Promise.resolve('// ds-ide:controls\n// ds-ide:pot vol 15\n');
      if (fp.endsWith('controllers.yaml')) return Promise.resolve('pots: []\nbuttons: []\nleds: []\n');
      return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    });
    (vscode.workspace as unknown as Record<string, unknown>).workspaceFolders = [
      { uri: { fsPath: '/proj' } },
    ];
  });

  afterEach(() => {
    (vscode.workspace as unknown as Record<string, unknown>).workspaceFolders = undefined;
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
    const promisesMock = fsMock['promises'] as Record<string, ReturnType<typeof vi.fn>>;
    promisesMock['readFile'].mockClear();
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
    const promisesMock = fsMock['promises'] as Record<string, ReturnType<typeof vi.fn>>;
    promisesMock['readFile'].mockClear();
    await saveCb({ uri: { fsPath: '/other/unrelated.txt' } });
    expect(promisesMock['readFile']).not.toHaveBeenCalled();
  });

  it('save cb reads controllers.yaml when yaml file is saved (FR-CE-9)', async () => {
    const { activate: act } = await import('../../extension');
    const ctx = makeContext();
    act(ctx);
    const saveCb = (vscode.workspace.onDidSaveTextDocument as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      ((doc: { uri: { fsPath: string } }) => Promise<void>);
    const promisesMock = fsMock['promises'] as Record<string, ReturnType<typeof vi.fn>>;
    promisesMock['readFile'].mockClear();
    await saveCb({ uri: { fsPath: path.join('/proj', 'controllers.yaml') } });
    expect(promisesMock['readFile']).toHaveBeenCalledWith(
      expect.stringMatching(/controllers\.yaml$/), expect.anything(),
    );
  });

  it('activate() completes setup synchronously without blocking on file reads (AC-66)', async () => {
    const { activate: act } = await import('../../extension');
    const promisesMock = fsMock['promises'] as Record<string, ReturnType<typeof vi.fn>>;
    // Make file reads never resolve — activate() must still return
    promisesMock['access'].mockReturnValue(new Promise(() => {}));
    promisesMock['readFile'].mockReturnValue(new Promise(() => {}));
    const ctx = makeContext();
    act(ctx);
    // All 26 subscriptions must be registered before any file reads complete
    expect((ctx.subscriptions as unknown[]).length).toBe(26);
  });
});
