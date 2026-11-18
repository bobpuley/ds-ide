import { describe, it, expect, vi } from 'vitest';
import { PassThrough } from 'stream';
import { EventEmitter as NodeEventEmitter } from 'events';
import {
  findLldbDap,
  DaisyDebugAdapterFactory,
  MuteOnBreakpointTracker,
  DaisyDebugAdapterTrackerFactory,
  FilteringLldbDapAdapter,
  isSpuriousDetachSigstop,
  type AudioModeCallback,
  type DapChildProcess,
} from '../../../debug/debug-adapter';
import * as vscode from 'vscode';
import { lldbDapNotFoundMessage, LLDB_DAP_NOT_FOUND_MESSAGE } from '../../../hardware/toolchain';

function frame(message: unknown): Buffer {
  const json = JSON.stringify(message);
  return Buffer.from(`Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`, 'utf8');
}

function makeFakeChild(): {
  child: DapChildProcess;
  stdout: PassThrough;
  stdin: PassThrough;
  kill: ReturnType<typeof vi.fn>;
} {
  const stdout = new PassThrough();
  const stdin = new PassThrough();
  const kill = vi.fn();
  const child = Object.assign(new NodeEventEmitter(), { stdout, stdin, kill }) as unknown as DapChildProcess;
  return { child, stdout, stdin, kill };
}

describe('findLldbDap()', () => {
  it('returns the xcrun result when lldb-dap is found via xcrun', async () => {
    const exists = vi.fn(() => Promise.resolve(true));
    const exec = vi.fn(() => Promise.resolve('/xcrun/path/lldb-dap\n'));

    const result = await findLldbDap(exists, exec, { platform: 'darwin' });
    expect(result).toBe('/xcrun/path/lldb-dap');
    expect(exec).toHaveBeenCalledWith('xcrun', ['--find', 'lldb-dap']);
  });

  it('falls back to CLT path when xcrun fails', async () => {
    const exec = vi.fn(() => Promise.reject(new Error('xcrun not found')));
    const exists = vi.fn((p: string) =>
      Promise.resolve(p === '/Library/Developer/CommandLineTools/usr/bin/lldb-dap'),
    );

    const result = await findLldbDap(exists, exec, { platform: 'darwin' });
    expect(result).toBe('/Library/Developer/CommandLineTools/usr/bin/lldb-dap');
  });

  it('falls back to /usr/bin/lldb-dap when CLT path is absent', async () => {
    const exec = vi.fn(() => Promise.reject(new Error('xcrun not found')));
    const exists = vi.fn((p: string) => Promise.resolve(p === '/usr/bin/lldb-dap'));

    const result = await findLldbDap(exists, exec, { platform: 'darwin' });
    expect(result).toBe('/usr/bin/lldb-dap');
  });

  it('returns undefined when no candidate exists and xcrun fails', async () => {
    const exec = vi.fn(() => Promise.reject(new Error('xcrun not found')));
    const exists = vi.fn(() => Promise.resolve(false));

    const result = await findLldbDap(exists, exec, { platform: 'darwin' });
    expect(result).toBeUndefined();
  });

  it('skips xcrun result when the path does not exist on disk', async () => {
    const exec = vi.fn(() => Promise.resolve('/xcrun/missing/lldb-dap\n'));
    const exists = vi.fn((p: string) =>
      Promise.resolve(p === '/Library/Developer/CommandLineTools/usr/bin/lldb-dap'),
    );

    const result = await findLldbDap(exists, exec, { platform: 'darwin' });
    expect(result).toBe('/Library/Developer/CommandLineTools/usr/bin/lldb-dap');
  });

  it('falls back to plain "which lldb-dap" when xcrun is unavailable (Linux) (FR-QA-EXT-9)', async () => {
    const exec = vi.fn((cmd: string, args: string[]) => {
      if (cmd === 'xcrun') return Promise.reject(new Error('xcrun: command not found'));
      if (cmd === 'which' && args[0] === 'lldb-dap') return Promise.resolve('/usr/bin/lldb-dap\n');
      return Promise.reject(new Error('not found'));
    });
    const exists = vi.fn(() => Promise.resolve(true));

    const result = await findLldbDap(exists, exec, { platform: 'linux' });
    expect(result).toBe('/usr/bin/lldb-dap');
  });

  it('falls back to a versioned lldb-dap-<N> binary on PATH when the unversioned name is absent (FR-QA-EXT-9)', async () => {
    const exec = vi.fn((cmd: string, args: string[]) => {
      if (cmd === 'xcrun') return Promise.reject(new Error('xcrun: command not found'));
      if (cmd === 'which' && args[0] === 'lldb-dap-18') return Promise.resolve('/usr/bin/lldb-dap-18\n');
      return Promise.reject(new Error('not found'));
    });
    const exists = vi.fn(() => Promise.resolve(true));

    const result = await findLldbDap(exists, exec, { platform: 'linux' });
    expect(result).toBe('/usr/bin/lldb-dap-18');
  });
});

describe('DaisyDebugAdapterFactory', () => {
  it('returns a DebugAdapterInlineImplementation wrapping a FilteringLldbDapAdapter when lldb-dap is found (FR-UX-7)', async () => {
    const factory = new DaisyDebugAdapterFactory(() => Promise.resolve('/usr/bin/lldb-dap'));
    const descriptor = await factory.createDebugAdapterDescriptor({} as vscode.DebugSession);
    expect(descriptor).toBeInstanceOf(vscode.DebugAdapterInlineImplementation);
    const inline = descriptor as unknown as { implementation: unknown };
    expect(inline.implementation).toBeInstanceOf(FilteringLldbDapAdapter);
  });

  it('shows an error and returns undefined when lldb-dap is not found', async () => {
    const factory = new DaisyDebugAdapterFactory(() => Promise.resolve(undefined), 'darwin');
    const descriptor = await factory.createDebugAdapterDescriptor({} as vscode.DebugSession);
    expect(descriptor).toBeUndefined();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringMatching(/lldb-dap not found.*xcode-select --install/),
    );
  });
});

describe('MuteOnBreakpointTracker', () => {
  function makeTracker(): { tracker: MuteOnBreakpointTracker; cb: ReturnType<typeof vi.fn> } {
    const cb = vi.fn() as ReturnType<typeof vi.fn>;
    const tracker = new MuteOnBreakpointTracker(cb as AudioModeCallback);
    return { tracker, cb };
  }

  it('sends simulated on stopped event', () => {
    const { tracker, cb } = makeTracker();
    tracker.onDidSendMessage!({ type: 'event', event: 'stopped' });
    expect(cb).toHaveBeenCalledWith('simulated');
  });

  it('sends realtime on continued event', () => {
    const { tracker, cb } = makeTracker();
    tracker.onDidSendMessage!({ type: 'event', event: 'continued' });
    expect(cb).toHaveBeenCalledWith('realtime');
  });

  it('sends realtime on exited event', () => {
    const { tracker, cb } = makeTracker();
    tracker.onDidSendMessage!({ type: 'event', event: 'exited' });
    expect(cb).toHaveBeenCalledWith('realtime');
  });

  it('sends realtime on terminated event', () => {
    const { tracker, cb } = makeTracker();
    tracker.onDidSendMessage!({ type: 'event', event: 'terminated' });
    expect(cb).toHaveBeenCalledWith('realtime');
  });

  it('ignores non-event messages', () => {
    const { tracker, cb } = makeTracker();
    tracker.onDidSendMessage!({ type: 'response', command: 'next' });
    expect(cb).not.toHaveBeenCalled();
  });

  it('ignores events with unrelated names', () => {
    const { tracker, cb } = makeTracker();
    tracker.onDidSendMessage!({ type: 'event', event: 'output' });
    expect(cb).not.toHaveBeenCalled();
  });

  it('ignores null and non-object messages', () => {
    const { tracker, cb } = makeTracker();
    tracker.onDidSendMessage!(null);
    tracker.onDidSendMessage!('string');
    tracker.onDidSendMessage!(42);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('DaisyDebugAdapterTrackerFactory', () => {
  it('creates a MuteOnBreakpointTracker for any session', () => {
    const cb = vi.fn() as ReturnType<typeof vi.fn>;
    const factory = new DaisyDebugAdapterTrackerFactory(cb as AudioModeCallback);
    const tracker = factory.createDebugAdapterTracker({} as vscode.DebugSession);
    expect(tracker).toBeInstanceOf(MuteOnBreakpointTracker);
  });

  it('the created tracker calls the provided callback', () => {
    const cb = vi.fn() as ReturnType<typeof vi.fn>;
    const factory = new DaisyDebugAdapterTrackerFactory(cb as AudioModeCallback);
    const tracker = factory.createDebugAdapterTracker({} as vscode.DebugSession) as MuteOnBreakpointTracker;
    tracker.onDidSendMessage!({ type: 'event', event: 'stopped' });
    expect(cb).toHaveBeenCalledWith('simulated');
  });
});

describe('isSpuriousDetachSigstop() (FR-UX-7)', () => {
  it('matches a stopped/exception event whose description mentions SIGSTOP', () => {
    expect(isSpuriousDetachSigstop({
      type: 'event', event: 'stopped', seq: 1,
      body: { reason: 'exception', description: 'signal SIGSTOP' },
    })).toBe(true);
  });

  it('matches when SIGSTOP appears only in the text field', () => {
    expect(isSpuriousDetachSigstop({
      type: 'event', event: 'stopped', seq: 1,
      body: { reason: 'exception', text: 'Exception has occurred: signal SIGSTOP' },
    })).toBe(true);
  });

  it('does not match a real exception unrelated to SIGSTOP', () => {
    expect(isSpuriousDetachSigstop({
      type: 'event', event: 'stopped', seq: 1,
      body: { reason: 'exception', description: 'EXC_BAD_ACCESS' },
    })).toBe(false);
  });

  it('does not match stopped events with other reasons', () => {
    for (const reason of ['breakpoint', 'step', 'pause', 'entry']) {
      expect(isSpuriousDetachSigstop({
        type: 'event', event: 'stopped', seq: 1,
        body: { reason, description: 'signal SIGSTOP' },
      })).toBe(false);
    }
  });

  it('does not match non-stopped events', () => {
    expect(isSpuriousDetachSigstop({ type: 'event', event: 'continued', seq: 1 })).toBe(false);
  });

  it('ignores null, non-object, and bodyless messages', () => {
    expect(isSpuriousDetachSigstop(null)).toBe(false);
    expect(isSpuriousDetachSigstop('string')).toBe(false);
    expect(isSpuriousDetachSigstop({ type: 'event', event: 'stopped', seq: 1 })).toBe(false);
  });
});

describe('FilteringLldbDapAdapter (FR-UX-7)', () => {
  it('relays a normal event to the client unchanged', () => {
    const { child, stdout } = makeFakeChild();
    const adapter = new FilteringLldbDapAdapter('/fake/lldb-dap', () => child);
    const received: unknown[] = [];
    adapter.onDidSendMessage((m) => received.push(m));

    const msg = { type: 'event', event: 'initialized', seq: 1 };
    stdout.emit('data', frame(msg));

    expect(received).toEqual([msg]);
  });

  it('drops the spurious detach-time SIGSTOP stopped/exception event', () => {
    const { child, stdout } = makeFakeChild();
    const adapter = new FilteringLldbDapAdapter('/fake/lldb-dap', () => child);
    const received: unknown[] = [];
    adapter.onDidSendMessage((m) => received.push(m));

    stdout.emit('data', frame({
      type: 'event', event: 'stopped', seq: 2,
      body: { reason: 'exception', description: 'signal SIGSTOP' },
    }));

    expect(received).toEqual([]);
  });

  it('still relays a genuine stopped/exception event unrelated to SIGSTOP', () => {
    const { child, stdout } = makeFakeChild();
    const adapter = new FilteringLldbDapAdapter('/fake/lldb-dap', () => child);
    const received: unknown[] = [];
    adapter.onDidSendMessage((m) => received.push(m));

    const msg = {
      type: 'event', event: 'stopped', seq: 3,
      body: { reason: 'exception', description: 'EXC_BAD_ACCESS' },
    };
    stdout.emit('data', frame(msg));

    expect(received).toEqual([msg]);
  });

  it('handles a DAP message split across multiple stdout chunks', () => {
    const { child, stdout } = makeFakeChild();
    const adapter = new FilteringLldbDapAdapter('/fake/lldb-dap', () => child);
    const received: unknown[] = [];
    adapter.onDidSendMessage((m) => received.push(m));

    const msg = { type: 'event', event: 'terminated', seq: 4 };
    const full = frame(msg);
    stdout.emit('data', full.subarray(0, 10));
    stdout.emit('data', full.subarray(10));

    expect(received).toEqual([msg]);
  });

  it('handles two DAP messages delivered in a single stdout chunk', () => {
    const { child, stdout } = makeFakeChild();
    const adapter = new FilteringLldbDapAdapter('/fake/lldb-dap', () => child);
    const received: unknown[] = [];
    adapter.onDidSendMessage((m) => received.push(m));

    const msg1 = { type: 'event', event: 'continued', seq: 5 };
    const msg2 = { type: 'event', event: 'exited', seq: 6 };
    stdout.emit('data', Buffer.concat([frame(msg1), frame(msg2)]));

    expect(received).toEqual([msg1, msg2]);
  });

  it('forwards client messages to the child stdin using DAP framing', () => {
    const { child, stdin } = makeFakeChild();
    const adapter = new FilteringLldbDapAdapter('/fake/lldb-dap', () => child);
    const written: Buffer[] = [];
    stdin.on('data', (chunk: Buffer) => written.push(chunk));

    const request = { type: 'request', command: 'disconnect', seq: 7 };
    adapter.handleMessage(request as unknown as vscode.DebugProtocolMessage);

    const sent = Buffer.concat(written).toString('utf8');
    expect(sent).toBe(
      `Content-Length: ${Buffer.byteLength(JSON.stringify(request))}\r\n\r\n${JSON.stringify(request)}`,
    );
  });

  it('kills the child process on dispose', () => {
    const { child, kill } = makeFakeChild();
    const adapter = new FilteringLldbDapAdapter('/fake/lldb-dap', () => child);
    adapter.dispose();
    expect(kill).toHaveBeenCalled();
  });

  it('shows an error message if the child process errors', () => {
    const { child } = makeFakeChild();
    new FilteringLldbDapAdapter('/fake/lldb-dap', () => child);
    (child as unknown as NodeEventEmitter).emit('error', new Error('boom'));
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('boom'),
    );
  });
});

// ── per-platform lldb-dap resolver (FR-WIN-DBG-1) ────────────────────────────
// Platform, environment and directory listings are injected, so the Windows
// cases run on any host.

const WIN_ENV = {
  ProgramFiles: 'C:\\Program Files',
  'ProgramFiles(x86)': 'C:\\Program Files (x86)',
  SystemDrive: 'C:',
  USERPROFILE: 'C:\\Users\\me',
  LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
};
const winEnv = {
  platform: 'win32' as const,
  env: WIN_ENV,
  listDir: async (): Promise<string[]> => { throw new Error('ENOENT'); },
};
const noExec = vi.fn(async (): Promise<string> => { throw new Error('not found'); });
const presentFiles = (...files: string[]) => vi.fn(async (p: string) => files.includes(p));

describe('findLldbDap() on Windows (FR-WIN-DBG-1)', () => {
  it('finds lldb-dap on PATH through where.exe, never asking xcrun', async () => {
    const exec = vi.fn(async (cmd: string) => {
      if (cmd === 'where.exe') return 'C:\\msys64\\clang64\\bin\\lldb-dap.exe\r\n';
      throw new Error('unexpected ' + cmd);
    });
    const result = await findLldbDap(presentFiles('C:\\msys64\\clang64\\bin\\lldb-dap.exe'), exec, winEnv);
    expect(result).toBe('C:\\msys64\\clang64\\bin\\lldb-dap.exe');
    expect(exec).toHaveBeenCalledWith('where.exe', ['lldb-dap']);
    expect(exec).not.toHaveBeenCalledWith('xcrun', expect.anything());
  });

  it.each([
    'C:\\Program Files\\LLVM\\bin\\lldb-dap.exe',
    'C:\\msys64\\clang64\\bin\\lldb-dap.exe',
  ])('finds the install at %s', async (exe) => {
    expect(await findLldbDap(presentFiles(exe), noExec, winEnv)).toBe(exe);
  });

  it('returns undefined when there is none', async () => {
    expect(await findLldbDap(presentFiles(), noExec, winEnv)).toBeUndefined();
  });
});

describe('lldb-dap not-found message per platform (FR-WIN-DBG-1)', () => {
  it('macOS keeps the Xcode Command Line Tools remedy', () => {
    expect(lldbDapNotFoundMessage('darwin')).toBe(LLDB_DAP_NOT_FOUND_MESSAGE);
    expect(lldbDapNotFoundMessage('darwin')).toMatch(/xcode-select --install/);
  });

  it('Linux names LLDB from the package manager, not Xcode', () => {
    const m = lldbDapNotFoundMessage('linux');
    expect(m).toMatch(/lldb-dap not found/);
    expect(m).toMatch(/lldb/i);
    expect(m).not.toMatch(/xcode/i);
  });

  it('Windows names LLVM / MSYS2 and PATH, not Xcode', () => {
    const m = lldbDapNotFoundMessage('win32');
    expect(m).toMatch(/lldb-dap not found/);
    expect(m).toMatch(/LLVM/);
    expect(m).toMatch(/MSYS2/);
    expect(m).toMatch(/PATH/);
    expect(m).not.toMatch(/xcode/i);
  });

  it('the factory shows the message of its platform when lldb-dap is missing', async () => {
    const factory = new DaisyDebugAdapterFactory(() => Promise.resolve(undefined), 'win32');
    await factory.createDebugAdapterDescriptor({} as vscode.DebugSession);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(lldbDapNotFoundMessage('win32'));
  });
});
