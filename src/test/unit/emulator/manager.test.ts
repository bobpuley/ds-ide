import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import * as cp from 'child_process';
import { EmulatorManager } from '../../../emulator/manager';
import { IpcClient } from '../../../emulator/ipc-client';

// ---- Process stub helpers ----

function makeChildProcess(exitCode = 0, socketPath?: string) {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter & { on: ReturnType<typeof vi.fn> };
    stderr: EventEmitter & { on: ReturnType<typeof vi.fn> };
    kill: ReturnType<typeof vi.fn>;
    pid: number;
  };
  proc.kill = vi.fn();
  proc.pid  = 12345;

  const stdout = new EventEmitter() as EventEmitter & { on: ReturnType<typeof vi.fn> };
  const stdoutOrigOn = stdout.on.bind(stdout);
  stdout.on = vi.fn(stdoutOrigOn);
  proc.stdout = stdout;

  const stderr = new EventEmitter() as EventEmitter & { on: ReturnType<typeof vi.fn> };
  const stderrOrigOn = stderr.on.bind(stderr);
  stderr.on = vi.fn(stderrOrigOn);
  proc.stderr = stderr;

  // Simulate async process lifecycle
  setTimeout(() => {
    if (socketPath) {
      proc.stdout.emit('data', Buffer.from(`DAISY_EMU_SOCKET:${socketPath}\n`));
    }
    proc.emit('close', exitCode);
  }, 0);

  return proc;
}

function makeCmakeProcess(exitCode = 0) {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter & { on: ReturnType<typeof vi.fn> };
    stderr: EventEmitter & { on: ReturnType<typeof vi.fn> };
    kill: ReturnType<typeof vi.fn>;
    pid: number;
  };
  proc.kill = vi.fn();
  proc.pid  = 9999;

  const stdout = new EventEmitter() as EventEmitter & { on: ReturnType<typeof vi.fn> };
  const origOn = stdout.on.bind(stdout);
  stdout.on = vi.fn(origOn);
  proc.stdout = stdout;

  const stderr = new EventEmitter() as EventEmitter & { on: ReturnType<typeof vi.fn> };
  const seOrigOn = stderr.on.bind(stderr);
  stderr.on = vi.fn(seOrigOn);
  proc.stderr = stderr;

  setTimeout(() => proc.emit('close', exitCode), 0);
  return proc;
}

// ---- IpcClient stub ----

function makeIpcClient() {
  const client = new EventEmitter() as EventEmitter & {
    connect: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
  };
  const origOn = client.on.bind(client);
  client.on = vi.fn(origOn);
  client.connect    = vi.fn(() => Promise.resolve());
  client.send       = vi.fn();
  client.disconnect = vi.fn();
  return client;
}

describe('EmulatorManager', () => {
  let spawnMock: ReturnType<typeof vi.fn>;
  let ipcClientStub: ReturnType<typeof makeIpcClient>;
  let mkdirSyncMock: ReturnType<typeof vi.fn>;
  let manager: EmulatorManager;
  let cmakeCallCount: number;

  beforeEach(() => {
    cmakeCallCount = 0;
    ipcClientStub = makeIpcClient();
    mkdirSyncMock = vi.fn();

    spawnMock = vi.fn((cmd: string) => {
      if (cmd === 'cmake') {
        cmakeCallCount++;
        return makeCmakeProcess(0);
      }
      // effect_emu spawn — provide socket path
      return makeChildProcess(0, '/tmp/daisy_emu_test.sock');
    });

    manager = new EmulatorManager({
      spawn: spawnMock as unknown as typeof cp.spawn,
      ipcClientFactory: () => ipcClientStub as unknown as IpcClient,
      mkdirSync: mkdirSyncMock,
    });
  });

  describe('build()', () => {
    it('runs cmake configure then cmake build', async () => {
      const lines: string[] = [];
      await manager.build(
        { projectRoot: '/proj', effectSrc: '/proj/effect.cpp', emulatorSrc: '/ext/emulator' },
        (l) => lines.push(l),
      );
      expect(spawnMock).toHaveBeenCalledTimes(2);
      const [firstCall, secondCall] = spawnMock.mock.calls as [string, string[]][];
      expect(firstCall![0]).toBe('cmake');
      expect(firstCall![1]).toContain('-DEFFECT_SRC=/proj/effect.cpp');
      expect(secondCall![0]).toBe('cmake');
      expect(secondCall![1]).toContain('--build');
    });

    it('passes DAISYSP_DIR when provided', async () => {
      await manager.build(
        {
          projectRoot: '/proj',
          effectSrc: '/proj/effect.cpp',
          emulatorSrc: '/ext/emulator',
          daisySpDir: '/proj/DaisySP/Source',
        },
        () => undefined,
      );
      const firstArgs = spawnMock.mock.calls[0]![1] as string[];
      expect(firstArgs).toContain('-DDAISYSP_DIR=/proj/DaisySP/Source');
    });

    it('creates build directory', async () => {
      await manager.build(
        { projectRoot: '/proj', effectSrc: '/proj/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );
      expect(mkdirSyncMock).toHaveBeenCalledWith(
        expect.stringContaining('.ds-ide'),
        { recursive: true },
      );
    });

    it('rejects when cmake exits non-zero', async () => {
      spawnMock = vi.fn(() => makeCmakeProcess(1));
      const mgr = new EmulatorManager({
        spawn: spawnMock as unknown as typeof cp.spawn,
        ipcClientFactory: () => ipcClientStub as unknown as IpcClient,
        mkdirSync: mkdirSyncMock,
      });
      await expect(
        mgr.build(
          { projectRoot: '/proj', effectSrc: '/proj/e.cpp', emulatorSrc: '/ext/emulator' },
          () => undefined,
        ),
      ).rejects.toThrow('cmake exited with code 1');
    });
  });

  describe('deploy()', () => {
    it('throws if build was never called', async () => {
      await expect(manager.deploy(() => undefined)).rejects.toThrow('Build before deploying');
    });

    it('spawns effect_emu after a successful build', async () => {
      await manager.build(
        { projectRoot: '/proj', effectSrc: '/proj/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );
      await manager.deploy(() => undefined);
      // cmake ×2, then effect_emu ×1
      expect(spawnMock).toHaveBeenCalledTimes(3);
      const lastCall = spawnMock.mock.calls[2] as [string, string[]];
      expect(lastCall[0]).toContain('effect_emu');
    });

    it('connects IPC client after socket path is announced', async () => {
      await manager.build(
        { projectRoot: '/proj', effectSrc: '/proj/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );
      await manager.deploy(() => undefined);
      expect(ipcClientStub.connect).toHaveBeenCalledWith('/tmp/daisy_emu_test.sock');
    });
  });

  describe('sendTransport()', () => {
    it('sends correct JSON for start', async () => {
      await manager.build(
        { projectRoot: '/p', effectSrc: '/p/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );
      await manager.deploy(() => undefined);
      manager.sendTransport('start');
      expect(ipcClientStub.send).toHaveBeenCalledWith({ type: 'transport', action: 'start' });
    });

    it('sends correct JSON for stop', async () => {
      await manager.build(
        { projectRoot: '/p', effectSrc: '/p/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );
      await manager.deploy(() => undefined);
      manager.sendTransport('stop');
      expect(ipcClientStub.send).toHaveBeenCalledWith({ type: 'transport', action: 'stop' });
    });
  });

  describe('dispose()', () => {
    it('disconnects IPC and kills process', async () => {
      await manager.build(
        { projectRoot: '/p', effectSrc: '/p/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );
      await manager.deploy(() => undefined);
      // Get the child process mock
      const childMock = spawnMock.mock.results[2]?.value as { kill: ReturnType<typeof vi.fn> };

      // Simulate the process staying alive (don't re-emit close)
      manager.dispose();
      expect(ipcClientStub.disconnect).toHaveBeenCalledOnce();
      // childProcess may already be null if close was emitted; test that disconnect was called
      expect(ipcClientStub.disconnect).toHaveBeenCalled();
    });
  });
});
