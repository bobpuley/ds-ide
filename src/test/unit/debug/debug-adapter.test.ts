import { describe, it, expect, vi } from 'vitest';
import {
  findLldbDap,
  DaisyDebugAdapterFactory,
  MuteOnBreakpointTracker,
  DaisyDebugAdapterTrackerFactory,
  type AudioModeCallback,
} from '../../../debug/debug-adapter';
import * as vscode from 'vscode';

describe('findLldbDap()', () => {
  it('returns the xcrun result when lldb-dap is found via xcrun', async () => {
    const exists = vi.fn(() => Promise.resolve(true));
    const exec = vi.fn(() => Promise.resolve('/xcrun/path/lldb-dap\n'));

    const result = await findLldbDap(exists, exec);
    expect(result).toBe('/xcrun/path/lldb-dap');
    expect(exec).toHaveBeenCalledWith('xcrun', ['--find', 'lldb-dap']);
  });

  it('falls back to CLT path when xcrun fails', async () => {
    const exec = vi.fn(() => Promise.reject(new Error('xcrun not found')));
    const exists = vi.fn((p: string) =>
      Promise.resolve(p === '/Library/Developer/CommandLineTools/usr/bin/lldb-dap'),
    );

    const result = await findLldbDap(exists, exec);
    expect(result).toBe('/Library/Developer/CommandLineTools/usr/bin/lldb-dap');
  });

  it('falls back to /usr/bin/lldb-dap when CLT path is absent', async () => {
    const exec = vi.fn(() => Promise.reject(new Error('xcrun not found')));
    const exists = vi.fn((p: string) => Promise.resolve(p === '/usr/bin/lldb-dap'));

    const result = await findLldbDap(exists, exec);
    expect(result).toBe('/usr/bin/lldb-dap');
  });

  it('returns undefined when no candidate exists and xcrun fails', async () => {
    const exec = vi.fn(() => Promise.reject(new Error('xcrun not found')));
    const exists = vi.fn(() => Promise.resolve(false));

    const result = await findLldbDap(exists, exec);
    expect(result).toBeUndefined();
  });

  it('skips xcrun result when the path does not exist on disk', async () => {
    const exec = vi.fn(() => Promise.resolve('/xcrun/missing/lldb-dap\n'));
    const exists = vi.fn((p: string) =>
      Promise.resolve(p === '/Library/Developer/CommandLineTools/usr/bin/lldb-dap'),
    );

    const result = await findLldbDap(exists, exec);
    expect(result).toBe('/Library/Developer/CommandLineTools/usr/bin/lldb-dap');
  });

  it('falls back to plain "which lldb-dap" when xcrun is unavailable (Linux) (FR-QA-EXT-9)', async () => {
    const exec = vi.fn((cmd: string, args: string[]) => {
      if (cmd === 'xcrun') return Promise.reject(new Error('xcrun: command not found'));
      if (cmd === 'which' && args[0] === 'lldb-dap') return Promise.resolve('/usr/bin/lldb-dap\n');
      return Promise.reject(new Error('not found'));
    });
    const exists = vi.fn(() => Promise.resolve(true));

    const result = await findLldbDap(exists, exec);
    expect(result).toBe('/usr/bin/lldb-dap');
  });

  it('falls back to a versioned lldb-dap-<N> binary on PATH when the unversioned name is absent (FR-QA-EXT-9)', async () => {
    const exec = vi.fn((cmd: string, args: string[]) => {
      if (cmd === 'xcrun') return Promise.reject(new Error('xcrun: command not found'));
      if (cmd === 'which' && args[0] === 'lldb-dap-18') return Promise.resolve('/usr/bin/lldb-dap-18\n');
      return Promise.reject(new Error('not found'));
    });
    const exists = vi.fn(() => Promise.resolve(true));

    const result = await findLldbDap(exists, exec);
    expect(result).toBe('/usr/bin/lldb-dap-18');
  });
});

describe('DaisyDebugAdapterFactory', () => {
  it('returns a DebugAdapterExecutable when lldb-dap is found', async () => {
    const factory = new DaisyDebugAdapterFactory(() => Promise.resolve('/usr/bin/lldb-dap'));
    const descriptor = await factory.createDebugAdapterDescriptor({} as vscode.DebugSession);
    expect(descriptor).toBeInstanceOf(vscode.DebugAdapterExecutable);
    const exe = descriptor as vscode.DebugAdapterExecutable;
    expect(exe.command).toBe('/usr/bin/lldb-dap');
  });

  it('shows an error and returns undefined when lldb-dap is not found', async () => {
    const factory = new DaisyDebugAdapterFactory(() => Promise.resolve(undefined));
    const descriptor = await factory.createDebugAdapterDescriptor({} as vscode.DebugSession);
    expect(descriptor).toBeUndefined();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('lldb-dap not found'),
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
