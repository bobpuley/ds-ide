import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { RunSessionAdapter, type RunSessionHost } from '../../../debug/run-session-adapter';
import type { EmulatorExit } from '../../../emulator/manager';
import type * as vscode from 'vscode';

type Dap = { type: string; seq: number; command?: string; event?: string; request_seq?: number; success?: boolean; body?: Record<string, unknown> };

function makeHost(pid: number | undefined = 4242) {
  const exits = new EventEmitter();
  let current: number | undefined = pid;
  const host = {
    currentEmulatorPid: vi.fn(() => current),
    stopEmulator: vi.fn(() => {
      const stopped = current;
      current = undefined;
      // Real manager: the killed child's close arrives later, as not-crashed.
      if (stopped !== undefined) queueMicrotask(() => exits.emit('exit', { pid: stopped, crashed: false }));
    }),
    onEmulatorExit: vi.fn((listener: (e: EmulatorExit) => void) => {
      exits.on('exit', listener);
      return { dispose: () => exits.off('exit', listener) };
    }),
    consumeLaunch: vi.fn((_config: Record<string, unknown>): boolean => true),
    rebuildAndDeploy: vi.fn(async (_mode: 'run' | 'debug', _token: vscode.CancellationToken): Promise<boolean> => { current = 7777; return true; }),
    attachDebugger: vi.fn(async (_pid: number): Promise<boolean> => true),
  } satisfies RunSessionHost;
  return {
    host,
    /** Simulate the emulator process ending (crash, or replaced by a new deploy). */
    exit(e: EmulatorExit, newPid?: number) { current = newPid; exits.emit('exit', e); },
    setPid(p: number | undefined) { current = p; },
    listenerCount: () => exits.listenerCount('exit'),
  };
}

function start(adapter: RunSessionAdapter) {
  const sent: Dap[] = [];
  adapter.onDidSendMessage((m) => sent.push(m as unknown as Dap));
  let seq = 0;
  const request = (command: string, args: Record<string, unknown> = {}) =>
    adapter.handleMessage({ type: 'request', command, seq: ++seq, arguments: args } as never);
  return { sent, request };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));
const events = (sent: Dap[], name: string) => sent.filter((m) => m.type === 'event' && m.event === name);
const response = (sent: Dap[], command: string) => sent.find((m) => m.type === 'response' && m.command === command);

describe('RunSessionAdapter (FR-TRN-1)', () => {
  let h: ReturnType<typeof makeHost>;
  let adapter: RunSessionAdapter;
  let io: ReturnType<typeof start>;

  beforeEach(() => {
    h = makeHost();
    adapter = new RunSessionAdapter(h.host);
    io = start(adapter);
  });

  it('answers initialize with success, no restart-request support, then sends initialized', async () => {
    io.request('initialize');
    await flush();
    const res = response(io.sent, 'initialize')!;
    expect(res.success).toBe(true);
    expect(res.body?.['supportsRestartRequest']).toBeFalsy();
    expect(events(io.sent, 'initialized')).toHaveLength(1);
  });

  it('stays alive after launch — no terminated event while the emulator runs', async () => {
    io.request('initialize');
    io.request('launch', { noDebug: true });
    io.request('configurationDone');
    await flush();
    await new Promise<void>((r) => setTimeout(r, 100));
    expect(response(io.sent, 'launch')!.success).toBe(true);
    expect(events(io.sent, 'terminated')).toHaveLength(0);
  });

  it('answers threads with an empty list', async () => {
    io.request('threads');
    await flush();
    expect(response(io.sent, 'threads')!.body).toEqual({ threads: [] });
  });

  describe('no orphans', () => {
    beforeEach(async () => {
      io.request('initialize');
      io.request('launch', { noDebug: true });
      await flush();
    });

    it('user stop (disconnect): stops the emulator, responds, then sends terminated once', async () => {
      io.request('disconnect');
      await flush();
      expect(h.host.stopEmulator).toHaveBeenCalledOnce();
      expect(response(io.sent, 'disconnect')!.success).toBe(true);
      expect(events(io.sent, 'terminated')).toHaveLength(1);
    });

    it('user stop (terminate request) also stops the emulator', async () => {
      io.request('terminate');
      await flush();
      expect(h.host.stopEmulator).toHaveBeenCalledOnce();
      expect(events(io.sent, 'terminated')).toHaveLength(1);
    });

    it('emulator crash: ends the session', async () => {
      h.exit({ pid: 4242, crashed: true });
      await flush();
      expect(events(io.sent, 'terminated')).toHaveLength(1);
      expect(h.host.stopEmulator).not.toHaveBeenCalled();
    });

    it('emulator normal exit: ends the session', async () => {
      h.exit({ pid: 4242, crashed: false });
      await flush();
      expect(events(io.sent, 'terminated')).toHaveLength(1);
    });

    it('window reload (adapter disposed while running): stops the emulator', () => {
      adapter.dispose();
      expect(h.host.stopEmulator).toHaveBeenCalledOnce();
      expect(h.listenerCount()).toBe(0);
    });

    it('second launch while running: the old session ends and never kills the new emulator', async () => {
      // The second launch redeploys: the manager replaces pid 4242 with 5151.
      h.exit({ pid: 4242, crashed: false }, 5151);
      await flush();
      expect(events(io.sent, 'terminated')).toHaveLength(1);

      io.request('disconnect');
      adapter.dispose();
      await flush();
      expect(h.host.stopEmulator).not.toHaveBeenCalled();
    });

    it('ignores the exit of an unrelated emulator', async () => {
      h.exit({ pid: 9999, crashed: true }, 4242);
      await flush();
      expect(events(io.sent, 'terminated')).toHaveLength(0);
    });

    it('stop followed by the killed emulator\'s exit sends terminated only once', async () => {
      io.request('disconnect');
      await flush();
      await flush();
      expect(events(io.sent, 'terminated')).toHaveLength(1);
    });

    it('dispose after a user stop does not stop anything again', async () => {
      io.request('disconnect');
      await flush();
      adapter.dispose();
      expect(h.host.stopEmulator).toHaveBeenCalledOnce();
    });
  });

  it('launch with no running emulator ends the session immediately', async () => {
    h.setPid(undefined);
    io.request('initialize');
    io.request('launch', { noDebug: true });
    await flush();
    expect(response(io.sent, 'launch')!.success).toBe(true);
    expect(events(io.sent, 'terminated')).toHaveLength(1);
  });

  it('ignores non-request messages', async () => {
    adapter.handleMessage({ type: 'event', event: 'x', seq: 1 } as never);
    await flush();
    expect(io.sent).toHaveLength(0);
  });
});

describe('RunSessionAdapter — Restart (FR-TRN-2)', () => {
  it('a fresh launch (config just resolved) does not rebuild', async () => {
    const h = makeHost();
    const io = start(new RunSessionAdapter(h.host));
    io.request('launch', { noDebug: true, __dsIdeLaunchId: 'a' });
    await flush();
    expect(h.host.consumeLaunch).toHaveBeenCalledWith(expect.objectContaining({ __dsIdeLaunchId: 'a' }));
    expect(h.host.rebuildAndDeploy).not.toHaveBeenCalled();
  });

  it('a relaunch (config already used — VS Code Restart) rebuilds + redeploys, then binds to the new emulator', async () => {
    const h = makeHost();
    h.host.consumeLaunch.mockReturnValue(false);
    const adapter = new RunSessionAdapter(h.host);
    const io = start(adapter);
    io.request('launch', { noDebug: true, __dsIdeLaunchId: 'a' });
    await flush();
    expect(h.host.rebuildAndDeploy).toHaveBeenCalledWith('run', expect.anything());
    expect(response(io.sent, 'launch')!.success).toBe(true);
    expect(events(io.sent, 'terminated')).toHaveLength(0);

    // bound to the redeployed emulator (7777), so a crash of it ends the session
    h.exit({ pid: 7777, crashed: true });
    await flush();
    expect(events(io.sent, 'terminated')).toHaveLength(1);
  });

  it('a build failure during Restart ends the session without binding', async () => {
    const h = makeHost(undefined);
    h.host.consumeLaunch.mockReturnValue(false);
    h.host.rebuildAndDeploy.mockResolvedValue(false);
    const io = start(new RunSessionAdapter(h.host));
    io.request('launch', { noDebug: true });
    await flush();
    expect(response(io.sent, 'launch')!.success).toBe(true);
    expect(events(io.sent, 'terminated')).toHaveLength(1);
  });

  it('Stop during a Restart rebuild cancels it and never binds the late emulator', async () => {
    const h = makeHost(undefined);
    h.host.consumeLaunch.mockReturnValue(false);
    let release!: (ok: boolean) => void;
    let seenToken: vscode.CancellationToken | undefined;
    h.host.rebuildAndDeploy.mockImplementation((_mode, token) => {
      seenToken = token;
      return new Promise<boolean>((r) => { release = r; });
    });
    const io = start(new RunSessionAdapter(h.host));
    io.request('launch', { noDebug: true });
    await flush();
    io.request('disconnect');
    await flush();
    expect(seenToken!.isCancellationRequested).toBe(true);

    // The deploy won the race anyway: the late emulator must not outlive the session.
    h.setPid(8888);
    release(true);
    await flush();
    expect(h.host.stopEmulator).toHaveBeenCalledOnce();
    expect(events(io.sent, 'terminated')).toHaveLength(1);
  });

  it('debug mode: after binding, attaches the debugger to the emulator PID', async () => {
    const h = makeHost();
    const io = start(new RunSessionAdapter(h.host));
    io.request('launch', {});
    await flush();
    expect(h.host.attachDebugger).toHaveBeenCalledWith(4242);
    expect(events(io.sent, 'terminated')).toHaveLength(0);
  });

  it('debug relaunch: rebuilds, then re-attaches to the new PID', async () => {
    const h = makeHost();
    h.host.consumeLaunch.mockReturnValue(false);
    const io = start(new RunSessionAdapter(h.host));
    io.request('launch', {});
    await flush();
    expect(h.host.rebuildAndDeploy).toHaveBeenCalledWith('debug', expect.anything());
    expect(h.host.attachDebugger).toHaveBeenCalledWith(7777);
  });

  it('run mode never attaches the debugger', async () => {
    const h = makeHost();
    start(new RunSessionAdapter(h.host)).request('launch', { noDebug: true });
    await flush();
    expect(h.host.attachDebugger).not.toHaveBeenCalled();
  });

  it('debug mode: a failed attach stops the emulator and ends the session', async () => {
    const h = makeHost();
    h.host.attachDebugger.mockResolvedValue(false);
    const io = start(new RunSessionAdapter(h.host));
    io.request('launch', {});
    await flush();
    expect(h.host.stopEmulator).toHaveBeenCalledOnce();
    expect(events(io.sent, 'terminated')).toHaveLength(1);
  });
});

describe('RunSessionAdapter — how the emulator is stopped', () => {
  it('run mode: a normal (graceful) stop', async () => {
    const h = makeHost();
    const io = start(new RunSessionAdapter(h.host));
    io.request('launch', { noDebug: true });
    await flush();
    io.request('disconnect');
    expect(h.host.stopEmulator).toHaveBeenCalledWith({ immediate: false });
  });

  it('debug mode: an immediate stop, so lldb does not catch SIGTERM and pause in the shim', async () => {
    const h = makeHost();
    const io = start(new RunSessionAdapter(h.host));
    io.request('launch', {});
    await flush();
    io.request('disconnect');
    expect(h.host.stopEmulator).toHaveBeenCalledWith({ immediate: true });
  });
});

