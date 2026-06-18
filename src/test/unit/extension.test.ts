import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import * as vscode from 'vscode';

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
    // diagnostics + statusBar + descriptor factory + tracker factory + 8 commands + 1 manager/scope dispose
    expect((ctx.subscriptions as unknown[]).length).toBe(13);
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

  it('registers a debug adapter descriptor factory for daisy-debug', () => {
    const ctx = makeContext();
    activate(ctx);
    expect(vscode.debug.registerDebugAdapterDescriptorFactory).toHaveBeenCalledWith(
      'daisy-debug',
      expect.anything(),
    );
  });

  it('registers a debug adapter tracker factory for daisy-debug (mute-on-breakpoint)', () => {
    const ctx = makeContext();
    activate(ctx);
    expect(vscode.debug.registerDebugAdapterTrackerFactory).toHaveBeenCalledWith(
      'daisy-debug',
      expect.anything(),
    );
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
