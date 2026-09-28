import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import * as vscode from 'vscode';
import {
  TransportController, wireTransportEvents, isBuildSource, countErrors, TRANSPORT_PHASE_CONTEXT,
} from '../../../transport/transport-controller';

function session(type: string, configuration: Record<string, unknown> = {}, parentSession?: unknown) {
  return { type, configuration, parentSession } as unknown as vscode.DebugSession;
}

describe('TransportController', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('publishes the initial phase as the ds-ide.transportPhase context key', () => {
    new TransportController();
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('setContext', TRANSPORT_PHASE_CONTEXT, 'stopped');
  });

  it('dispatch reduces, fires onDidChange and republishes the phase when it changes', () => {
    const c = new TransportController();
    const seen = vi.fn();
    c.onDidChange(seen);
    c.dispatch({ type: 'buildStarted', mode: 'run' });
    expect(c.state.phase).toBe('building');
    expect(seen).toHaveBeenCalledWith(c.state);
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('setContext', TRANSPORT_PHASE_CONTEXT, 'building');
  });

  it('a no-op event fires nothing', () => {
    const c = new TransportController();
    const seen = vi.fn();
    c.onDidChange(seen);
    c.dispatch({ type: 'paused' });
    expect(seen).not.toHaveBeenCalled();
  });

  it('a change that keeps the phase fires onDidChange but does not republish the context key', () => {
    const c = new TransportController();
    c.dispatch({ type: 'sessionStarted', mode: 'run' });
    (vscode.commands.executeCommand as ReturnType<typeof vi.fn>).mockClear();
    const seen = vi.fn();
    c.onDidChange(seen);
    c.dispatch({ type: 'sourceSaved' });
    expect(seen).toHaveBeenCalledOnce();
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
  });

  describe('trackWork() / cancelWork() — the view\'s Cancel', () => {
    it('cancelWork cancels the token handed to the tracked task', async () => {
      const c = new TransportController();
      let token: vscode.CancellationToken | undefined;
      const done = c.trackWork(undefined, async (t) => { token = t; c.cancelWork(); return t.isCancellationRequested; });
      expect(await done).toBe(true);
      expect(token!.isCancellationRequested).toBe(true);
    });

    it('the caller\'s own token (the notification\'s Cancel) still cancels the task', async () => {
      const c = new TransportController();
      const outer = new vscode.CancellationTokenSource();
      const result = await c.trackWork(outer.token, async (t) => { outer.cancel(); return t.isCancellationRequested; });
      expect(result).toBe(true);
    });

    it('cancelWork with nothing in flight is a no-op', () => {
      expect(() => new TransportController().cancelWork()).not.toThrow();
    });
  });

  it('tracks the transport debug session for Stop', () => {
    const c = new TransportController();
    const s = session('ds-ide');
    c.session = s;
    expect(c.session).toBe(s);
  });
});

describe('wireTransportEvents()', () => {
  let c: TransportController;
  let emulator: EventEmitter;
  let disposables: vscode.Disposable[];
  const cb = <T>(fn: unknown): T => (fn as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as T;

  beforeEach(() => {
    vi.clearAllMocks();
    c = new TransportController();
    emulator = new EventEmitter();
    disposables = wireTransportEvents(c, {
      emulator,
      isProjectSource: (uri) => uri.fsPath.startsWith('/proj/') && isBuildSource(uri.fsPath),
    });
  });

  it('a ds-ide noDebug session start → running (run mode), and it becomes the tracked session', () => {
    const s = session('ds-ide', { noDebug: true });
    cb<(s: vscode.DebugSession) => void>(vscode.debug.onDidStartDebugSession)(s);
    expect(c.state).toMatchObject({ phase: 'running', mode: 'run' });
    expect(c.session).toBe(s);
  });

  it('a ds-ide debug session start → debugging', () => {
    cb<(s: vscode.DebugSession) => void>(vscode.debug.onDidStartDebugSession)(session('ds-ide', {}));
    expect(c.state).toMatchObject({ phase: 'debugging', mode: 'debug' });
  });

  it('a standalone daisy-debug session (ds-ide.debug command) counts as debugging', () => {
    cb<(s: vscode.DebugSession) => void>(vscode.debug.onDidStartDebugSession)(session('daisy-debug'));
    expect(c.state.phase).toBe('debugging');
  });

  it('a daisy-debug child of a ds-ide session is not reported twice', () => {
    const parent = session('ds-ide', { noDebug: true });
    const start = cb<(s: vscode.DebugSession) => void>(vscode.debug.onDidStartDebugSession);
    const end = cb<(s: vscode.DebugSession) => void>(vscode.debug.onDidTerminateDebugSession);
    start(parent);
    start(session('daisy-debug', {}, parent));
    end(session('daisy-debug', {}, parent));
    expect(c.state.phase).toBe('running');
    expect(c.session).toBe(parent);
  });

  it('unrelated debug sessions are ignored', () => {
    cb<(s: vscode.DebugSession) => void>(vscode.debug.onDidStartDebugSession)(session('node'));
    expect(c.state.phase).toBe('stopped');
  });

  it('the tracked session ending → stopped, and it is no longer tracked', () => {
    const s = session('ds-ide', { noDebug: true });
    cb<(s: vscode.DebugSession) => void>(vscode.debug.onDidStartDebugSession)(s);
    cb<(s: vscode.DebugSession) => void>(vscode.debug.onDidTerminateDebugSession)(s);
    expect(c.state.phase).toBe('stopped');
    expect(c.session).toBeUndefined();
  });

  describe('daisy-debug tracker (paused / resumed)', () => {
    function tracker(): vscode.DebugAdapterTracker {
      const call = (vscode.debug.registerDebugAdapterTrackerFactory as ReturnType<typeof vi.fn>).mock.calls
        .find((x) => x[0] === 'daisy-debug')!;
      return (call[1] as vscode.DebugAdapterTrackerFactory).createDebugAdapterTracker(session('daisy-debug')) as vscode.DebugAdapterTracker;
    }

    beforeEach(() => {
      cb<(s: vscode.DebugSession) => void>(vscode.debug.onDidStartDebugSession)(session('ds-ide', {}));
    });

    it('a stopped event → paused; a continued event → debugging', () => {
      const t = tracker();
      t.onDidSendMessage!({ type: 'event', event: 'stopped', body: { reason: 'breakpoint' } });
      expect(c.state.phase).toBe('paused');
      t.onDidSendMessage!({ type: 'event', event: 'continued', body: {} });
      expect(c.state.phase).toBe('debugging');
    });

    it.each(['continue', 'next', 'stepIn', 'stepOut'])('a %s request resumes (lldb-dap need not send continued)', (command) => {
      const t = tracker();
      t.onDidSendMessage!({ type: 'event', event: 'stopped', body: {} });
      t.onWillReceiveMessage!({ type: 'request', command, seq: 1 });
      expect(c.state.phase).toBe('debugging');
    });
  });

  it('saving a project build source while running → stale', () => {
    cb<(s: vscode.DebugSession) => void>(vscode.debug.onDidStartDebugSession)(session('ds-ide', { noDebug: true }));
    const save = cb<(d: { uri: { fsPath: string } }) => void>(vscode.workspace.onDidSaveTextDocument);
    save({ uri: { fsPath: '/elsewhere/x.cpp' } });
    save({ uri: { fsPath: '/proj/README.md' } });
    expect(c.state.stale).toBe(false);
    save({ uri: { fsPath: '/proj/effect.cpp' } });
    expect(c.state.stale).toBe(true);
  });

  it('emulator exit maps to exited / crashed', () => {
    const start = cb<(s: vscode.DebugSession) => void>(vscode.debug.onDidStartDebugSession);
    start(session('ds-ide', { noDebug: true }));
    emulator.emit('exit', { pid: 1, crashed: true });
    expect(c.state.phase).toBe('crashed');

    c.dispatch({ type: 'sessionStarted', mode: 'run' });
    emulator.emit('exit', { pid: 2, crashed: false });
    expect(c.state.phase).toBe('stopped');
  });

  it('disposing removes the emulator listener', () => {
    for (const d of disposables) d.dispose();
    expect(emulator.listenerCount('exit')).toBe(0);
  });
});

describe('isBuildSource()', () => {
  it.each(['a.c', 'a.cc', 'a.cpp', 'a.cxx', 'a.h', 'a.hh', 'a.hpp', 'A.CPP'])('%s is a build source', (f) => {
    expect(isBuildSource(`/p/${f}`)).toBe(true);
  });
  it.each(['a.md', 'controllers.yaml', 'Makefile', 'a.json'])('%s is not', (f) => {
    expect(isBuildSource(`/p/${f}`)).toBe(false);
  });
});

describe('countErrors()', () => {
  it('counts error-severity diagnostics across every file', () => {
    const entries: Array<[unknown, Array<{ severity: number }>]> = [
      ['a', [{ severity: vscode.DiagnosticSeverity.Error }, { severity: vscode.DiagnosticSeverity.Warning }]],
      ['b', [{ severity: vscode.DiagnosticSeverity.Error }]],
    ];
    const collection = {
      forEach: (fn: (uri: unknown, diags: Array<{ severity: number }>) => void) => entries.forEach(([u, d]) => fn(u, d)),
    } as unknown as vscode.DiagnosticCollection;
    expect(countErrors(collection)).toBe(2);
  });
});
