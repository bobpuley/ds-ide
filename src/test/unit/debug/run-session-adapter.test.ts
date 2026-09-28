import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { RunSessionAdapter, type RunSessionHost } from '../../../debug/run-session-adapter';
import type { EmulatorExit } from '../../../emulator/manager';

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
