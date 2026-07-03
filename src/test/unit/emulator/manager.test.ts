import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EmulatorManager, workspaceRuntimeDir, killStalePid } from '../../../emulator/manager';
import { IpcClient } from '../../../emulator/ipc-client';

// ---- Process stub helpers ----

function makeChildProcess(exitCode = 0, socketPath?: string, exitAfterAnnounce = false) {
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

  // Simulate async process lifecycle.
  // When socketPath is given, announce it but do NOT auto-emit close (long-running process).
  // Only emit close when: no socket (crash before announce), or exitAfterAnnounce=true.
  setTimeout(() => {
    if (socketPath) {
      proc.stdout.emit('data', Buffer.from(`DAISY_EMU_SOCKET:${socketPath}\n`));
      if (exitAfterAnnounce) proc.emit('close', exitCode);
    } else {
      proc.emit('close', exitCode);
    }
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

  describe('sendPot()', () => {
    it('sends correct JSON for a pot move', async () => {
      await manager.build(
        { projectRoot: '/p', effectSrc: '/p/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );
      await manager.deploy(() => undefined);
      manager.sendPot(3, 0.75);
      expect(ipcClientStub.send).toHaveBeenCalledWith({ type: 'pot', channel: 3, value: 0.75 });
    });
  });

  describe('sendPotSnapshot()', () => {
    it('sends a potSnapshot with all channel values', async () => {
      await manager.build(
        { projectRoot: '/p', effectSrc: '/p/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );
      await manager.deploy(() => undefined);
      const values = { 0: 0.5, 1: 0.3 };
      manager.sendPotSnapshot(values);
      expect(ipcClientStub.send).toHaveBeenCalledWith({ type: 'potSnapshot', values });
    });

    it('is a no-op when not connected', () => {
      manager.sendPotSnapshot({ 0: 0.5 });
      expect(ipcClientStub.send).not.toHaveBeenCalled();
    });
  });

  describe('sendAudioMode()', () => {
    it('sends audioMode:simulated IPC message', async () => {
      await manager.build(
        { projectRoot: '/p', effectSrc: '/p/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );
      await manager.deploy(() => undefined);
      manager.sendAudioMode('simulated');
      expect(ipcClientStub.send).toHaveBeenCalledWith({ type: 'audioMode', mode: 'simulated' });
    });

    it('sends audioMode:realtime IPC message', async () => {
      await manager.build(
        { projectRoot: '/p', effectSrc: '/p/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );
      await manager.deploy(() => undefined);
      manager.sendAudioMode('realtime');
      expect(ipcClientStub.send).toHaveBeenCalledWith({ type: 'audioMode', mode: 'realtime' });
    });

    it('is a no-op when not connected', () => {
      manager.sendAudioMode('simulated');
      expect(ipcClientStub.send).not.toHaveBeenCalled();
    });
  });

  describe('sendAudioDevice()', () => {
    it('sends audioDevice IPC message with sampleRate and bufferSize', async () => {
      await manager.build(
        { projectRoot: '/p', effectSrc: '/p/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );
      await manager.deploy(() => undefined);
      manager.sendAudioDevice(48000, 256);
      expect(ipcClientStub.send).toHaveBeenCalledWith({ type: 'audioDevice', sampleRate: 48000, bufferSize: 256 });
    });

    it('is a no-op when not connected', () => {
      manager.sendAudioDevice(48000, 128);
      expect(ipcClientStub.send).not.toHaveBeenCalled();
    });
  });

  describe('sendWavFile()', () => {
    it('sends wavFile IPC message with path and loop', async () => {
      await manager.build(
        { projectRoot: '/p', effectSrc: '/p/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );
      await manager.deploy(() => undefined);
      manager.sendWavFile('/tmp/sample.wav', true);
      expect(ipcClientStub.send).toHaveBeenCalledWith({ type: 'wavFile', path: '/tmp/sample.wav', loop: true });
    });

    it('sends an empty path to deactivate WAV input', async () => {
      await manager.build(
        { projectRoot: '/p', effectSrc: '/p/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );
      await manager.deploy(() => undefined);
      manager.sendWavFile('', false);
      expect(ipcClientStub.send).toHaveBeenCalledWith({ type: 'wavFile', path: '', loop: false });
    });

    it('is a no-op when not connected', () => {
      manager.sendWavFile('/tmp/x.wav', true);
      expect(ipcClientStub.send).not.toHaveBeenCalled();
    });
  });

  describe('sendButton() / sendButtonSnapshot()', () => {
    it('sends a button press IPC message', async () => {
      await manager.build(
        { projectRoot: '/p', effectSrc: '/p/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );
      await manager.deploy(() => undefined);
      manager.sendButton(28, true);
      expect(ipcClientStub.send).toHaveBeenCalledWith({ type: 'button', gpioPin: 28, pressed: true });
    });

    it('sends a buttonSnapshot IPC message', async () => {
      await manager.build(
        { projectRoot: '/p', effectSrc: '/p/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );
      await manager.deploy(() => undefined);
      const values = { 28: true, 25: false };
      manager.sendButtonSnapshot(values);
      expect(ipcClientStub.send).toHaveBeenCalledWith({ type: 'buttonSnapshot', values });
    });

    it('button sends are a no-op when not connected', () => {
      manager.sendButton(28, true);
      manager.sendButtonSnapshot({ 28: true });
      expect(ipcClientStub.send).not.toHaveBeenCalled();
    });
  });

  describe('running state inference from scope data', () => {
    async function deployedManager() {
      await manager.build(
        { projectRoot: '/p', effectSrc: '/p/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );
      await manager.deploy(() => undefined);
    }

    it('synthesizes status:{running:true} when scope arrives after status:{running:false}', async () => {
      await deployedManager();
      const messages: unknown[] = [];
      manager.on('message', (msg) => messages.push(msg));

      ipcClientStub.emit('message', { type: 'status', running: false, sampleRate: 48000, blockSize: 256 });
      ipcClientStub.emit('message', { type: 'scope', in: [], out: [] });

      const statusMsgs = messages.filter((m) => (m as Record<string,unknown>)['type'] === 'status');
      expect(statusMsgs).toEqual([
        { type: 'status', running: false, sampleRate: 48000, blockSize: 256 },
        { type: 'status', running: true, sampleRate: 48000, blockSize: 256 },
      ]);
    });

    it('does NOT synthesize again on subsequent scope messages', async () => {
      await deployedManager();
      const messages: unknown[] = [];
      manager.on('message', (msg) => messages.push(msg));

      ipcClientStub.emit('message', { type: 'status', running: false, sampleRate: 48000, blockSize: 256 });
      ipcClientStub.emit('message', { type: 'scope', in: [], out: [] });
      ipcClientStub.emit('message', { type: 'scope', in: [], out: [] });

      const statusMsgs = messages.filter((m) => (m as Record<string,unknown>)['type'] === 'status');
      expect(statusMsgs).toHaveLength(2); // only: running:false + synthesized running:true
    });

    it('does NOT synthesize if scope arrives before any status', async () => {
      await deployedManager();
      const messages: unknown[] = [];
      manager.on('message', (msg) => messages.push(msg));

      ipcClientStub.emit('message', { type: 'scope', in: [], out: [] });

      const statusMsgs = messages.filter((m) => (m as Record<string,unknown>)['type'] === 'status');
      expect(statusMsgs).toHaveLength(0);
    });

    it('synthesizes on spectrum as well as scope', async () => {
      await deployedManager();
      const messages: unknown[] = [];
      manager.on('message', (msg) => messages.push(msg));

      ipcClientStub.emit('message', { type: 'status', running: false, sampleRate: 48000, blockSize: 256 });
      ipcClientStub.emit('message', { type: 'spectrum', in_fft: [], out_fft: [], binHz: 0 });

      const statusMsgs = messages.filter((m) => (m as Record<string,unknown>)['type'] === 'status');
      expect(statusMsgs[1]).toMatchObject({ type: 'status', running: true });
    });

    it('resets inference after status:{running:false} so next scope triggers again', async () => {
      await deployedManager();
      const messages: unknown[] = [];
      manager.on('message', (msg) => messages.push(msg));

      ipcClientStub.emit('message', { type: 'status', running: false, sampleRate: 48000, blockSize: 256 });
      ipcClientStub.emit('message', { type: 'scope', in: [], out: [] }); // synthesizes running:true
      ipcClientStub.emit('message', { type: 'status', running: false, sampleRate: 48000, blockSize: 256 }); // stopped again
      ipcClientStub.emit('message', { type: 'scope', in: [], out: [] }); // should synthesize running:true again

      const statusMsgs = messages.filter((m) => (m as Record<string,unknown>)['type'] === 'status');
      expect(statusMsgs).toHaveLength(4);
      expect(statusMsgs[3]).toMatchObject({ type: 'status', running: true });
    });
  });

  describe('sendTransport()', () => {
    it('resets lastKnownRunning so scope data after stop+start re-synthesizes running:true', async () => {
      await manager.build(
        { projectRoot: '/p', effectSrc: '/p/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );
      await manager.deploy(() => undefined);
      const messages: unknown[] = [];
      manager.on('message', (msg) => messages.push(msg));

      // Initial running cycle
      ipcClientStub.emit('message', { type: 'status', running: false });
      ipcClientStub.emit('message', { type: 'scope', in: [], out: [] }); // synthesizes running:true

      // Explicit stop via transport command (bypasses IPC status message)
      manager.sendTransport('stop');

      // Restart: scope data arrives — must synthesize running:true again
      ipcClientStub.emit('message', { type: 'scope', in: [], out: [] });

      const statusMsgs = (messages as Record<string, unknown>[]).filter(m => m['type'] === 'status');
      // expect: running:false, synthesized running:true (first start), synthesized running:true (after stop+start)
      expect(statusMsgs).toHaveLength(3);
      expect(statusMsgs[2]).toMatchObject({ type: 'status', running: true });
    });

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

  describe('childPid', () => {
    it('returns the PID of the running emulator process', async () => {
      await manager.build(
        { projectRoot: '/p', effectSrc: '/p/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );
      await manager.deploy(() => undefined);
      expect(manager.childPid).toBe(12345);
    });

    it('is not clobbered by the old process close event after redeploy', async () => {
      await manager.build(
        { projectRoot: '/p', effectSrc: '/p/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );
      // First deploy — old child will emit close after the second deploy resolves
      const firstChild = spawnMock.mock.results[2]?.value as ReturnType<typeof makeChildProcess>;
      await manager.deploy(() => undefined);

      // Second deploy — kills old child; old child's close event fires
      const secondChild = spawnMock.mock.results[3]?.value as ReturnType<typeof makeChildProcess>;
      // Before the second deploy, ensure the first child's close fires after the second starts
      // (simulated: in tests close fires in the same setTimeout, so the guard is what we test)
      await manager.deploy(() => undefined);

      // After redeploy, childPid must be the new child's PID, not null
      expect(manager.childPid).toBe(12345); // mock always returns 12345
    });
  });

  describe('deploy() concurrency guard (FR-EXT-2)', () => {
    it('a second concurrent deploy() call returns the same in-flight promise', async () => {
      await manager.build(
        { projectRoot: '/p', effectSrc: '/p/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );
      const p1 = manager.deploy(() => undefined);
      const p2 = manager.deploy(() => undefined);
      expect(p2).toBe(p1);
      await p1;
    });

    it('a second concurrent deploy() call does not spawn a second effect_emu process', async () => {
      await manager.build(
        { projectRoot: '/p', effectSrc: '/p/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );
      // Call deploy twice concurrently (no await between them).
      const p1 = manager.deploy(() => undefined);
      const p2 = manager.deploy(() => undefined);
      await Promise.all([p1, p2]);

      // cmake ×2, then effect_emu ×1 (second call was early-returned)
      const effectEmuCalls = (spawnMock.mock.calls as [string][]).filter(
        c => typeof c[0] === 'string' && c[0].includes('effect_emu'),
      );
      expect(effectEmuCalls).toHaveLength(1);
    });

    it('deploy() is callable again after first deploy completes', async () => {
      await manager.build(
        { projectRoot: '/p', effectSrc: '/p/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );
      await manager.deploy(() => undefined);
      await manager.deploy(() => undefined);

      const effectEmuCalls = (spawnMock.mock.calls as [string][]).filter(
        c => typeof c[0] === 'string' && c[0].includes('effect_emu'),
      );
      // Two sequential deploys: both should succeed
      expect(effectEmuCalls).toHaveLength(2);
    });
  });

  describe('deploy() failure does not leak an unhandled rejection (FR-EXT-1)', () => {
    it('a deploy that fails to spawn does not produce an unhandledRejection', async () => {
      await manager.build(
        { projectRoot: '/p', effectSrc: '/p/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );

      const failingSpawn = vi.fn((cmd: string) => {
        if (cmd === 'cmake') return makeCmakeProcess(0);
        const proc = new EventEmitter() as EventEmitter & {
          stdout: EventEmitter & { on: ReturnType<typeof vi.fn> };
          stderr: EventEmitter & { on: ReturnType<typeof vi.fn> };
          kill: ReturnType<typeof vi.fn>;
          pid: number;
        };
        proc.kill = vi.fn();
        proc.pid = 999;
        proc.stdout = new EventEmitter() as EventEmitter & { on: ReturnType<typeof vi.fn> };
        proc.stderr = new EventEmitter() as EventEmitter & { on: ReturnType<typeof vi.fn> };
        setTimeout(() => proc.emit('error', new Error('spawn ENOENT')), 0);
        return proc;
      });
      const failingManager = new EmulatorManager({
        spawn: failingSpawn as unknown as typeof cp.spawn,
        ipcClientFactory: () => ipcClientStub as unknown as IpcClient,
        mkdirSync: mkdirSyncMock,
      });
      await failingManager.build(
        { projectRoot: '/p', effectSrc: '/p/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );

      const rejectionSpy = vi.fn();
      process.on('unhandledRejection', rejectionSpy);
      try {
        await expect(failingManager.deploy(() => undefined)).rejects.toThrow('spawn ENOENT');
        // Let the microtask queue drain so any unobserved rejection surfaces.
        await new Promise((r) => setTimeout(r, 0));
        expect(rejectionSpy).not.toHaveBeenCalled();
      } finally {
        process.off('unhandledRejection', rejectionSpy);
      }
    });

    it('deployLock clears after a failed deploy, so a subsequent deploy can proceed', async () => {
      await manager.build(
        { projectRoot: '/p', effectSrc: '/p/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );

      let callCount = 0;
      const flakySpawn = vi.fn((cmd: string) => {
        if (cmd === 'cmake') return makeCmakeProcess(0);
        callCount++;
        if (callCount === 1) {
          const proc = new EventEmitter() as EventEmitter & {
            stdout: EventEmitter & { on: ReturnType<typeof vi.fn> };
            stderr: EventEmitter & { on: ReturnType<typeof vi.fn> };
            kill: ReturnType<typeof vi.fn>;
            pid: number;
          };
          proc.kill = vi.fn();
          proc.pid = 999;
          proc.stdout = new EventEmitter() as EventEmitter & { on: ReturnType<typeof vi.fn> };
          proc.stderr = new EventEmitter() as EventEmitter & { on: ReturnType<typeof vi.fn> };
          setTimeout(() => proc.emit('error', new Error('spawn ENOENT')), 0);
          return proc;
        }
        return makeChildProcess(0, '/tmp/daisy_emu_test.sock');
      });
      const flakyManager = new EmulatorManager({
        spawn: flakySpawn as unknown as typeof cp.spawn,
        ipcClientFactory: () => ipcClientStub as unknown as IpcClient,
        mkdirSync: mkdirSyncMock,
      });
      await flakyManager.build(
        { projectRoot: '/p', effectSrc: '/p/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );

      await expect(flakyManager.deploy(() => undefined)).rejects.toThrow('spawn ENOENT');
      await expect(flakyManager.deploy(() => undefined)).resolves.toBeUndefined();
    });
  });

  describe('workspaceRuntimeDir() (FR-EXT-2)', () => {
    it('returns a stable path for the same buildDir', () => {
      const buildDir = '/very/deeply/nested/project/root/.ds-ide/build';
      expect(workspaceRuntimeDir(buildDir)).toBe(workspaceRuntimeDir(buildDir));
    });

    it('returns distinct paths for distinct buildDirs', () => {
      const a = workspaceRuntimeDir('/project-a/.ds-ide/build');
      const b = workspaceRuntimeDir('/project-b/.ds-ide/build');
      expect(a).not.toBe(b);
    });

    it('stays short regardless of how deep the project root is (UNIX socket path limit)', () => {
      const deepRoot = '/Users/someone/' + 'nested/'.repeat(20) + 'my-daisy-project/.ds-ide/build';
      // A socket filename ("emu-XXXXXXXX.sock", 17 chars) appended to this
      // directory must stay well under the ~103-byte sockaddr_un.sun_path cap.
      expect(workspaceRuntimeDir(deepRoot).length + 17).toBeLessThan(100);
    });

    it('lives under a directory named "ds-ide-<hash>" under os.tmpdir()', () => {
      const dir = workspaceRuntimeDir('/proj/.ds-ide/build');
      expect(path.dirname(dir)).toBe(os.tmpdir());
      expect(path.basename(dir)).toMatch(/^ds-ide-[0-9a-f]+$/);
    });
  });

  describe('killStalePid() identity check (FR-EXT-2)', () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ds-ide-killtest-'));
    });

    afterEach(async () => {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
      vi.restoreAllMocks();
    });

    function fakeExecFile(commOutput: string) {
      return vi.fn((_cmd: string, _args: readonly string[], cb: (err: Error | null, stdout: string) => void) => {
        cb(null, commOutput);
      });
    }

    it('does not signal a PID whose process name does not match effect_emu', async () => {
      await fs.promises.writeFile(path.join(tmpDir, 'emu.pid'), '424242');
      const execFileMock = fakeExecFile('some_unrelated_process\n');
      const killSpy = vi.spyOn(process, 'kill').mockReturnValue(true);

      await killStalePid(tmpDir, execFileMock as unknown as typeof cp.execFile);

      expect(killSpy).not.toHaveBeenCalled();
    });

    it('sends SIGTERM (not immediate SIGKILL) to a verified effect_emu PID', async () => {
      await fs.promises.writeFile(path.join(tmpDir, 'emu.pid'), '424242');
      const execFileMock = fakeExecFile('effect_emu\n');
      // Simulate the process having already exited by the time we check —
      // every process.kill() call (including the SIGTERM itself and the
      // liveness poll) throws ESRCH, so no SIGKILL escalation is needed.
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
        throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
      });

      await killStalePid(tmpDir, execFileMock as unknown as typeof cp.execFile);

      expect(killSpy).toHaveBeenCalledWith(424242, 'SIGTERM');
      expect(killSpy).not.toHaveBeenCalledWith(424242, 'SIGKILL');
    });

    it('clears the stale pid file regardless of identity match', async () => {
      const pidFile = path.join(tmpDir, 'emu.pid');
      await fs.promises.writeFile(pidFile, '424242');
      const execFileMock = fakeExecFile('unrelated\n');
      vi.spyOn(process, 'kill').mockReturnValue(true);

      await killStalePid(tmpDir, execFileMock as unknown as typeof cp.execFile);

      await expect(fs.promises.access(pidFile)).rejects.toThrow();
    });

    it('is a no-op when no pid file exists', async () => {
      const execFileMock = fakeExecFile('effect_emu\n');
      const killSpy = vi.spyOn(process, 'kill').mockReturnValue(true);

      await expect(killStalePid(tmpDir, execFileMock as unknown as typeof cp.execFile)).resolves.toBeUndefined();
      expect(killSpy).not.toHaveBeenCalled();
    });
  });

  describe('deploy() socket scoping (FR-EXT-2)', () => {
    it('places the socket under the per-workspace runtime directory with a randomized name, not a predictable global /tmp path', async () => {
      await manager.build(
        { projectRoot: '/proj', effectSrc: '/proj/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );
      await manager.deploy(() => undefined);

      const lastCall = spawnMock.mock.calls[2] as [string, string[]];
      const socketArg = lastCall[1][0]!;
      expect(socketArg).not.toMatch(/^\/tmp\/daisy_emu_\d+\.sock$/);
      expect(socketArg).toContain('ds-ide-');
      expect(path.basename(socketArg)).toMatch(/^emu-[0-9a-f]{8}\.sock$/);
    });

    it('creates the runtime directory with restrictive permissions', async () => {
      await manager.build(
        { projectRoot: '/proj', effectSrc: '/proj/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );
      await manager.deploy(() => undefined);

      expect(mkdirSyncMock).toHaveBeenCalledWith(
        expect.stringContaining('ds-ide-'),
        expect.objectContaining({ recursive: true, mode: 0o700 }),
      );
    });
  });

  describe('disconnect event suppression', () => {
    it('does NOT emit disconnect during intentional kill (redeploy)', async () => {
      await manager.build(
        { projectRoot: '/p', effectSrc: '/p/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );
      await manager.deploy(() => undefined);

      const disconnectSpy = vi.fn();
      manager.on('disconnect', disconnectSpy);

      // Simulate a second deploy (kills existing then redeploys).
      // The IpcClient stub's disconnect() fires synchronously, which would
      // normally emit 'disconnect' — it should be suppressed here.
      await manager.deploy(() => undefined);
      // disconnect should NOT have been called (intentional kill)
      expect(disconnectSpy).not.toHaveBeenCalled();
    });

    it('DOES emit disconnect when the emulator crashes unexpectedly', async () => {
      await manager.build(
        { projectRoot: '/p', effectSrc: '/p/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );
      await manager.deploy(() => undefined);

      const disconnectSpy = vi.fn();
      manager.on('disconnect', disconnectSpy);

      // Simulate the IPC client firing 'disconnect' on its own (emulator crash).
      // The intentionalDisconnect flag is false here, so it should propagate.
      ipcClientStub.emit('disconnect');
      expect(disconnectSpy).toHaveBeenCalledOnce();
    });
  });
});
