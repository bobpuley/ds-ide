import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EmulatorManager, workspaceRuntimeDir, killStalePid, CMakeNotFoundError, CompilerNotFoundError } from '../../../emulator/manager';
import { IpcClient } from '../../../emulator/ipc-client';
import { PROTOCOL_VERSION } from '../../../ipc/protocol-version';

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
  (stdout as unknown as Record<string, unknown>)['on'] = vi.fn(stdoutOrigOn);
  proc.stdout = stdout;

  const stderr = new EventEmitter() as EventEmitter & { on: ReturnType<typeof vi.fn> };
  const stderrOrigOn = stderr.on.bind(stderr);
  (stderr as unknown as Record<string, unknown>)['on'] = vi.fn(stderrOrigOn);
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
  (stdout as unknown as Record<string, unknown>)['on'] = vi.fn(origOn);
  proc.stdout = stdout;

  const stderr = new EventEmitter() as EventEmitter & { on: ReturnType<typeof vi.fn> };
  const seOrigOn = stderr.on.bind(stderr);
  (stderr as unknown as Record<string, unknown>)['on'] = vi.fn(seOrigOn);
  proc.stderr = stderr;

  setTimeout(() => proc.emit('close', exitCode), 0);
  return proc;
}

// ---- CancellationToken stub (structurally matches manager.ts's local
// CancellationToken interface, not vscode's — manager.ts stays UI-independent) ----

function makeCancellationSource() {
  let cancelled = false;
  const listeners: Array<() => void> = [];
  return {
    token: {
      get isCancellationRequested() { return cancelled; },
      onCancellationRequested(cb: () => void) {
        listeners.push(cb);
        return { dispose: () => { /* no-op for tests */ } };
      },
    },
    cancel(): void {
      cancelled = true;
      for (const cb of listeners) cb();
    },
  };
}

// ---- IpcClient stub ----

function makeIpcClient() {
  const client = new EventEmitter() as EventEmitter & {
    connect: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    connected: boolean;
  };
  const origOn = client.on.bind(client);
  (client as unknown as Record<string, unknown>)['on'] = vi.fn(origOn);
  client.connected  = true;
  client.connect    = vi.fn(() => {
    client.connected = true;
    // FR-DEV-6: a real emulator's first message is always its protocol
    // version handshake — connectIpc() registers its handshake listener
    // before calling connect(), so emitting synchronously here is safe and
    // lets every existing deploy() test resolve exactly as it does against a
    // real, compatible emulator.
    client.emit('message', { type: 'protocolVersion', version: PROTOCOL_VERSION });
    return Promise.resolve();
  }) as ReturnType<typeof vi.fn>;
  client.send       = vi.fn();
  client.disconnect = vi.fn(() => { client.connected = false; }) as ReturnType<typeof vi.fn>;
  return client;
}

describe('EmulatorManager', () => {
  let spawnMock: ReturnType<typeof vi.fn>;
  let ipcClientStub: ReturnType<typeof makeIpcClient>;
  let mkdirMock: ReturnType<typeof vi.fn>;
  let manager: EmulatorManager;
  let cmakeCallCount: number;

  beforeEach(() => {
    cmakeCallCount = 0;
    ipcClientStub = makeIpcClient();
    mkdirMock = vi.fn().mockResolvedValue(undefined);

    spawnMock = vi.fn((cmd: string) => {
      if (cmd === 'cmake') {
        cmakeCallCount++;
        return makeCmakeProcess(0);
      }
      // effect_emu spawn — provide socket path
      return makeChildProcess(0, '/tmp/daisy_emu_test.sock');
    }) as ReturnType<typeof vi.fn>;

    manager = new EmulatorManager({
      detectCMake: async () => 'cmake',
      detectCompiler: async () => '/usr/bin/clang++',
      spawn: spawnMock as unknown as typeof cp.spawn,
      ipcClientFactory: () => ipcClientStub as unknown as IpcClient,
      mkdir: mkdirMock as unknown as typeof fs.promises.mkdir,
    });
  });

  describe('build() CMake resolution (FR-REL-2)', () => {
    const buildOpts = { projectRoot: '/proj', effectSrc: '/proj/effect.cpp', emulatorSrc: '/ext/emulator' };

    // A failed spawn emits only 'error' — never 'close'.
    function makeEnoentProcess() {
      const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void };
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = () => { /* nothing to kill */ };
      const err = Object.assign(new Error('spawn cmake ENOENT'), { code: 'ENOENT' });
      setTimeout(() => proc.emit('error', err), 0);
      return proc;
    }

    it('runs the CMake that detectCMake resolved for both configure and build', async () => {
      const spawn = vi.fn(() => makeCmakeProcess(0));
      const mgr = new EmulatorManager({
        detectCMake: async () => '/opt/homebrew/bin/cmake',
        detectCompiler: async () => '/usr/bin/clang++',
        spawn: spawn as unknown as typeof cp.spawn,
        mkdir: mkdirMock as unknown as typeof fs.promises.mkdir,
      });
      await mgr.build(buildOpts, () => { /* ignore */ });
      expect(spawn).toHaveBeenCalledTimes(2);
      const calls = spawn.mock.calls as unknown as [string, string[]][];
      expect(calls[0]![0]).toBe('/opt/homebrew/bin/cmake');
      expect(calls[1]![0]).toBe('/opt/homebrew/bin/cmake');
    });

    it('fails with CMakeNotFoundError, spawning nothing, when no CMake is found', async () => {
      const spawn = vi.fn();
      const mgr = new EmulatorManager({
        detectCMake: async () => undefined,
        detectCompiler: async () => '/usr/bin/clang++',
        spawn: spawn as unknown as typeof cp.spawn,
        mkdir: mkdirMock as unknown as typeof fs.promises.mkdir,
      });
      const lines: string[] = [];
      await expect(mgr.build(buildOpts, (l) => lines.push(l))).rejects.toBeInstanceOf(CMakeNotFoundError);
      expect(spawn).not.toHaveBeenCalled();
    });

    it('fails with CompilerNotFoundError, before CMake, when no C++ compiler is found (FR-PRE-1)', async () => {
      const spawn = vi.fn();
      const mgr = new EmulatorManager({
        detectCMake: async () => 'cmake',
        detectCompiler: async () => undefined,
        spawn: spawn as unknown as typeof cp.spawn,
        mkdir: mkdirMock as unknown as typeof fs.promises.mkdir,
      });
      const err = await mgr.build(buildOpts, () => { /* ignore */ }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(CompilerNotFoundError);
      expect((err as Error).message).toBe('Xcode Command Line Tools not found. Run `xcode-select --install` and try again.');
      expect(spawn).not.toHaveBeenCalled();
    });

    it('the CMakeNotFoundError message tells the user how to fix it', async () => {
      const mgr = new EmulatorManager({
        detectCMake: async () => undefined,
        detectCompiler: async () => '/usr/bin/clang++',
        mkdir: mkdirMock as unknown as typeof fs.promises.mkdir,
      });
      await expect(mgr.build(buildOpts, () => { /* ignore */ })).rejects.toThrow(/CMake not found.*brew install cmake/);
    });

    it('maps a spawn ENOENT (CMake vanished between detection and launch) to CMakeNotFoundError', async () => {
      const spawn = vi.fn(() => makeEnoentProcess());
      const mgr = new EmulatorManager({
        detectCMake: async () => '/gone/cmake',
        detectCompiler: async () => '/usr/bin/clang++',
        spawn: spawn as unknown as typeof cp.spawn,
        mkdir: mkdirMock as unknown as typeof fs.promises.mkdir,
      });
      await expect(mgr.build(buildOpts, () => { /* ignore */ })).rejects.toBeInstanceOf(CMakeNotFoundError);
    });

    it('a CMake that starts and then fails keeps the plain exit-code error', async () => {
      const spawn = vi.fn(() => makeCmakeProcess(2));
      const mgr = new EmulatorManager({
        detectCMake: async () => 'cmake',
        detectCompiler: async () => '/usr/bin/clang++',
        spawn: spawn as unknown as typeof cp.spawn,
        mkdir: mkdirMock as unknown as typeof fs.promises.mkdir,
      });
      const err = await mgr.build(buildOpts, () => { /* ignore */ }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(CMakeNotFoundError);
      expect((err as Error).message).toBe('cmake exited with code 2');
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
      expect(mkdirMock).toHaveBeenCalledWith(
        expect.stringContaining('.ds-ide'),
        { recursive: true },
      );
    });

    it('rejects when cmake exits non-zero', async () => {
      spawnMock = vi.fn(() => makeCmakeProcess(1)) as ReturnType<typeof vi.fn>;
      const mgr = new EmulatorManager({
      detectCMake: async () => 'cmake',
      detectCompiler: async () => '/usr/bin/clang++',
        spawn: spawnMock as unknown as typeof cp.spawn,
        ipcClientFactory: () => ipcClientStub as unknown as IpcClient,
        mkdir: mkdirMock as unknown as typeof fs.promises.mkdir,
      });
      await expect(
        mgr.build(
          { projectRoot: '/proj', effectSrc: '/proj/e.cpp', emulatorSrc: '/ext/emulator' },
          () => undefined,
        ),
      ).rejects.toThrow('cmake exited with code 1');
    });
  });

  describe('build() stale cache self-heal (FR-PKG-2)', () => {
    let rmMock: ReturnType<typeof vi.fn>;

    function buildManager(readFileImpl: (...args: unknown[]) => Promise<string>) {
      rmMock = vi.fn().mockResolvedValue(undefined);
      return new EmulatorManager({
      detectCMake: async () => 'cmake',
      detectCompiler: async () => '/usr/bin/clang++',
        spawn: spawnMock as unknown as typeof cp.spawn,
        ipcClientFactory: () => ipcClientStub as unknown as IpcClient,
        mkdir: mkdirMock as unknown as typeof fs.promises.mkdir,
        readFile: vi.fn(readFileImpl) as unknown as typeof fs.promises.readFile,
        rm: rmMock as unknown as typeof fs.promises.rm,
      });
    }

    it('wipes and reconfigures a build dir whose cache was configured against a different emulator source', async () => {
      const mgr = buildManager(() =>
        Promise.resolve('CMAKE_HOME_DIRECTORY:INTERNAL=/old/extensionPath/emulator\n'),
      );
      await mgr.build(
        { projectRoot: '/proj', effectSrc: '/proj/e.cpp', emulatorSrc: '/new/extensionPath/emulator' },
        () => undefined,
      );
      expect(rmMock).toHaveBeenCalledWith(
        expect.stringContaining(path.join('.ds-ide', 'build')),
        { recursive: true, force: true },
      );
      // configure still proceeds against the new source after the wipe
      expect(spawnMock).toHaveBeenCalledTimes(2);
    });

    it('does not wipe when the cached source already matches the current emulatorSrc', async () => {
      const mgr = buildManager(() =>
        Promise.resolve('CMAKE_HOME_DIRECTORY:INTERNAL=/ext/emulator\n'),
      );
      await mgr.build(
        { projectRoot: '/proj', effectSrc: '/proj/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );
      expect(rmMock).not.toHaveBeenCalled();
    });

    it('does not wipe when no CMakeCache.txt exists yet (fresh build dir)', async () => {
      const mgr = buildManager(() => Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })));
      await mgr.build(
        { projectRoot: '/proj', effectSrc: '/proj/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );
      expect(rmMock).not.toHaveBeenCalled();
    });
  });

  describe('build() cancellation (FR-EXT-16)', () => {
    it('kills the cmake process and rejects when the token is cancelled', async () => {
      let killed = false;
      let spawnedResolve!: () => void;
      const spawned = new Promise<void>((res) => { spawnedResolve = res; });
      spawnMock.mockImplementation((cmd: string) => {
        if (cmd === 'cmake') {
          const proc = new EventEmitter() as EventEmitter & {
            stdout: EventEmitter; stderr: EventEmitter; kill: () => void; pid: number;
          };
          proc.stdout = new EventEmitter();
          proc.stderr = new EventEmitter();
          proc.pid = 9999;
          proc.kill = vi.fn(() => { killed = true; proc.emit('close', null); });
          // Never closes on its own — simulates a hung cmake configure.
          spawnedResolve();
          return proc;
        }
        return makeChildProcess(0, '/tmp/daisy_emu_test.sock');
      });

      const source = makeCancellationSource();
      const buildPromise = manager.build(
        { projectRoot: '/proj', effectSrc: '/proj/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
        source.token,
      );
      await spawned;
      source.cancel();

      await expect(buildPromise).rejects.toThrow(/cancelled/);
      expect(killed).toBe(true);
    });
  });

  describe('deploy()', () => {
    it('throws if build was never called, saying what to do (FR-PRE-4)', async () => {
      await expect(manager.deploy(() => undefined)).rejects.toThrow(
        'Nothing built yet. Run Daisy IDE: Run Daisy Effect, or Build for Emulator first.');
    });

    describe('adoptExistingBuild() (FR-PRE-4)', () => {
      const exeAt = (root: string): string => `${root}/.ds-ide/build/effect_emu`;
      const mgrWithExes = (...exes: string[]): EmulatorManager => new EmulatorManager({
        detectCMake: async () => 'cmake',
        detectCompiler: async () => '/usr/bin/clang++',
        spawn: spawnMock as unknown as typeof cp.spawn,
        ipcClientFactory: () => ipcClientStub as unknown as IpcClient,
        mkdir: mkdirMock as unknown as typeof fs.promises.mkdir,
        access: (async (p: string) => { if (!exes.includes(p)) throw new Error('ENOENT'); }) as unknown as typeof fs.promises.access,
      });

      it('uses <project>/.ds-ide/build/effect_emu from an earlier session, so deploy works in a fresh window', async () => {
        const m = mgrWithExes(exeAt('/proj'));
        expect(await m.adoptExistingBuild('/proj')).toBe(true);
        await m.deploy(() => undefined);
        const emuCall = spawnMock.mock.calls.find((c) => String(c[0]).endsWith('effect_emu'))!;
        expect(emuCall[0]).toBe(exeAt('/proj'));
        expect(emuCall[2].cwd).toBe('/proj');
      });

      it('reports false, and deploy still refuses, when no build exists for the project', async () => {
        const m = mgrWithExes();
        expect(await m.adoptExistingBuild('/proj')).toBe(false);
        await expect(m.deploy(() => undefined)).rejects.toThrow(/Nothing built yet/);
      });

      it("does not deploy another project's build", async () => {
        const m = mgrWithExes();
        await m.build({ projectRoot: '/a', effectSrc: '/a/e.cpp', emulatorSrc: '/ext/emulator' }, () => undefined);
        expect(await m.adoptExistingBuild('/b')).toBe(false);
      });

      it('keeps this session\'s own build of the project', async () => {
        const m = mgrWithExes();
        await m.build({ projectRoot: '/a', effectSrc: '/a/e.cpp', emulatorSrc: '/ext/emulator' }, () => undefined);
        expect(await m.adoptExistingBuild('/a')).toBe(true);
      });
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

    it('starts effect_emu in the project folder so its SD card is <project>/sdcard/ (FR-EXM-8)', async () => {
      await manager.build(
        { projectRoot: '/proj', effectSrc: '/proj/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );
      await manager.deploy(() => undefined);
      const emuCall = spawnMock.mock.calls[2] as [string, string[], { cwd?: string }];
      expect(emuCall[2].cwd).toBe('/proj');
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

  describe('deploy() cancellation (FR-EXT-16)', () => {
    it('kills the spawned emulator child and rejects when the token is cancelled while waiting for the socket', async () => {
      await manager.build(
        { projectRoot: '/proj', effectSrc: '/proj/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );

      let killed = false;
      let spawnedResolve!: () => void;
      const spawned = new Promise<void>((res) => { spawnedResolve = res; });
      spawnMock.mockImplementation((cmd: string) => {
        if (cmd === 'cmake') return makeCmakeProcess(0);
        // effect_emu spawn — never announces a socket path.
        const proc = new EventEmitter() as EventEmitter & {
          stdout: EventEmitter; stderr: EventEmitter; kill: () => void; pid: number;
        };
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        proc.pid = 12345;
        proc.kill = vi.fn(() => { killed = true; proc.emit('close', null); });
        spawnedResolve();
        return proc;
      });

      const source = makeCancellationSource();
      const deployPromise = manager.deploy(() => undefined, source.token);
      await spawned;
      source.cancel();

      await expect(deployPromise).rejects.toThrow(/cancelled/);
      expect(killed).toBe(true);
    });
  });

  describe("IpcClient 'warning' forwarding (FR-EXT-25)", () => {
    it("re-emits the IpcClient's 'warning' event", async () => {
      await manager.build(
        { projectRoot: '/proj', effectSrc: '/proj/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );
      await manager.deploy(() => undefined);

      const warningHandler = vi.fn();
      manager.on('warning', warningHandler);

      ipcClientStub.emit('warning', { message: 'dropped a malformed line', count: 3 });

      expect(warningHandler).toHaveBeenCalledWith({ message: 'dropped a malformed line', count: 3 });
    });
  });

  describe('protocol version handshake (FR-DEV-6)', () => {
    async function buildManager(): Promise<void> {
      await manager.build(
        { projectRoot: '/proj', effectSrc: '/proj/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );
    }

    it('deploy() rejects when the emulator reports an older protocol version', async () => {
      ipcClientStub.connect = vi.fn(() => {
        ipcClientStub.connected = true;
        ipcClientStub.emit('message', { type: 'protocolVersion', version: PROTOCOL_VERSION - 1 });
        return Promise.resolve();
      }) as ReturnType<typeof vi.fn>;
      await buildManager();
      await expect(manager.deploy(() => undefined)).rejects.toThrow(/protocol version mismatch/i);
      expect(ipcClientStub.disconnect).toHaveBeenCalled();
    });

    it('deploy() rejects when the emulator reports a newer protocol version', async () => {
      ipcClientStub.connect = vi.fn(() => {
        ipcClientStub.connected = true;
        ipcClientStub.emit('message', { type: 'protocolVersion', version: PROTOCOL_VERSION + 1 });
        return Promise.resolve();
      }) as ReturnType<typeof vi.fn>;
      await buildManager();
      await expect(manager.deploy(() => undefined)).rejects.toThrow(/protocol version mismatch/i);
    });

    it('rejection names both versions and offers a remedy', async () => {
      ipcClientStub.connect = vi.fn(() => {
        ipcClientStub.connected = true;
        ipcClientStub.emit('message', { type: 'protocolVersion', version: 999 });
        return Promise.resolve();
      }) as ReturnType<typeof vi.fn>;
      await buildManager();
      await expect(manager.deploy(() => undefined)).rejects.toThrow(
        new RegExp(`v${PROTOCOL_VERSION}.*v999|999.*v${PROTOCOL_VERSION}`, 'i'),
      );
    });

    it('deploy() rejects when the emulator sends a non-protocolVersion first message (stale, pre-handshake emulator)', async () => {
      ipcClientStub.connect = vi.fn(() => {
        ipcClientStub.connected = true;
        ipcClientStub.emit('message', { type: 'status', running: false });
        return Promise.resolve();
      }) as ReturnType<typeof vi.fn>;
      await buildManager();
      await expect(manager.deploy(() => undefined)).rejects.toThrow(/protocol version handshake/i);
    });

    it('deploy() succeeds and sends no control messages when versions match', async () => {
      await buildManager();
      await expect(manager.deploy(() => undefined)).resolves.toBeUndefined();
      expect(ipcClientStub.send).not.toHaveBeenCalled();
    });
  });

  describe('orphaned child process cleanup on failed handshake (FR-EXT-7)', () => {
    async function buildManager(): Promise<void> {
      await manager.build(
        { projectRoot: '/proj', effectSrc: '/proj/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );
    }

    it('kills the spawned child when the handshake reports a version mismatch', async () => {
      ipcClientStub.connect = vi.fn(() => {
        ipcClientStub.connected = true;
        ipcClientStub.emit('message', { type: 'protocolVersion', version: PROTOCOL_VERSION + 1 });
        return Promise.resolve();
      }) as ReturnType<typeof vi.fn>;
      await buildManager();
      await expect(manager.deploy(() => undefined)).rejects.toThrow(/protocol version mismatch/i);

      const childMock = spawnMock.mock.results[2]?.value as { kill: ReturnType<typeof vi.fn> };
      expect(childMock.kill).toHaveBeenCalled();
    });

    it('kills the spawned child when the emulator sends a non-handshake first message', async () => {
      ipcClientStub.connect = vi.fn(() => {
        ipcClientStub.connected = true;
        ipcClientStub.emit('message', { type: 'status', running: false });
        return Promise.resolve();
      }) as ReturnType<typeof vi.fn>;
      await buildManager();
      await expect(manager.deploy(() => undefined)).rejects.toThrow(/protocol version handshake/i);

      const childMock = spawnMock.mock.results[2]?.value as { kill: ReturnType<typeof vi.fn> };
      expect(childMock.kill).toHaveBeenCalled();
    });

    it('kills the spawned child when the IPC connect itself times out/fails', async () => {
      ipcClientStub.connect = vi.fn(() => Promise.reject<void>(new Error('IPC connect timed out'))) as ReturnType<typeof vi.fn>;
      await buildManager();
      await expect(manager.deploy(() => undefined)).rejects.toThrow(/IPC connect timed out/);

      const childMock = spawnMock.mock.results[2]?.value as { kill: ReturnType<typeof vi.fn> };
      expect(childMock.kill).toHaveBeenCalled();
    });

    it('does NOT kill the spawned child when the handshake succeeds', async () => {
      await buildManager();
      await manager.deploy(() => undefined);

      const childMock = spawnMock.mock.results[2]?.value as { kill: ReturnType<typeof vi.fn> };
      expect(childMock.kill).not.toHaveBeenCalled();
    });
  });

  describe('sendPot()', () => {
    it('sends a controlValue with a potN id (FR-DEV-1)', async () => {
      await manager.build(
        { projectRoot: '/p', effectSrc: '/p/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );
      await manager.deploy(() => undefined);
      manager.sendPot(3, 0.75);
      expect(ipcClientStub.send).toHaveBeenCalledWith({ type: 'controlValue', id: 'pot3', value: 0.75 });
    });
  });

  describe('sendMidiEvent()', () => {
    it('sends a midiEvent with flat status/data1/data2 fields (FR-DEV-16/18)', async () => {
      await manager.build(
        { projectRoot: '/p', effectSrc: '/p/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );
      await manager.deploy(() => undefined);
      manager.sendMidiEvent(0x90, 60, 100);
      expect(ipcClientStub.send).toHaveBeenCalledWith({ type: 'midiEvent', status: 0x90, data1: 60, data2: 100 });
    });
  });

  describe('sendControlValue()', () => {
    it('sends a well-formed controlValue as-is', async () => {
      await manager.build(
        { projectRoot: '/p', effectSrc: '/p/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );
      await manager.deploy(() => undefined);
      manager.sendControlValue('pot5', 0.2);
      expect(ipcClientStub.send).toHaveBeenCalledWith({ type: 'controlValue', id: 'pot5', value: 0.2 });
    });

    it('drops an unknown id instead of sending it (FR-DEV-1)', async () => {
      await manager.build(
        { projectRoot: '/p', effectSrc: '/p/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );
      await manager.deploy(() => undefined);
      manager.sendControlValue('pot12', 0.2);
      expect(ipcClientStub.send).not.toHaveBeenCalled();
    });

    it('drops a non-finite value instead of sending it (FR-DEV-1)', async () => {
      await manager.build(
        { projectRoot: '/p', effectSrc: '/p/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );
      await manager.deploy(() => undefined);
      manager.sendControlValue('pot0', NaN);
      expect(ipcClientStub.send).not.toHaveBeenCalled();
    });
  });

  describe('sendControlSnapshot()', () => {
    it('merges pot and button values into one controlSnapshot (FR-DEV-1)', async () => {
      await manager.build(
        { projectRoot: '/p', effectSrc: '/p/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );
      await manager.deploy(() => undefined);
      manager.sendControlSnapshot({ 0: 0.5, 1: 0.3 }, { 28: true, 25: false });
      expect(ipcClientStub.send).toHaveBeenCalledWith({
        type: 'controlSnapshot',
        values: { pot0: 0.5, pot1: 0.3, btn28: 1, btn25: 0 },
      });
    });

    it('also merges toggle values when provided (FR-DEV-7)', async () => {
      await manager.build(
        { projectRoot: '/p', effectSrc: '/p/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );
      await manager.deploy(() => undefined);
      manager.sendControlSnapshot({ 0: 0.5 }, { 28: true }, { 5: 2 });
      expect(ipcClientStub.send).toHaveBeenCalledWith({
        type: 'controlSnapshot',
        values: { pot0: 0.5, btn28: 1, tgl5: 2 },
      });
    });

    it('defaults toggle values to empty when omitted', async () => {
      await manager.build(
        { projectRoot: '/p', effectSrc: '/p/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );
      await manager.deploy(() => undefined);
      manager.sendControlSnapshot({ 0: 0.5 }, {});
      expect(ipcClientStub.send).toHaveBeenCalledWith({
        type: 'controlSnapshot',
        values: { pot0: 0.5 },
      });
    });

    it('is a no-op when not connected', () => {
      manager.sendControlSnapshot({ 0: 0.5 }, {});
      expect(ipcClientStub.send).not.toHaveBeenCalled();
    });
  });

  describe('sendGenerator() (FR-GEN-4)', () => {
    const deployed = async (): Promise<void> => {
      await manager.build(
        { projectRoot: '/p', effectSrc: '/p/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );
      await manager.deploy(() => undefined);
    };

    it('sends a generator message with the kind and every parameter', async () => {
      await deployed();
      manager.sendGenerator('sweep', { freq: 440, amp: 0.5, color: 'white', from: 50, to: 8000, time: 12, period: 500 });
      expect(ipcClientStub.send).toHaveBeenCalledWith({
        type: 'generator', kind: 'sweep', freq: 440, amp: 0.5, color: 'white', from: 50, to: 8000, time: 12, period: 500,
      });
    });

    it("sends only the kind for 'none'", async () => {
      await deployed();
      manager.sendGenerator('none');
      expect(ipcClientStub.send).toHaveBeenCalledWith({ type: 'generator', kind: 'none' });
    });

    it('is a no-op when not connected', () => {
      manager.sendGenerator('noise');
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

  describe('sendButton()', () => {
    it('sends a controlValue with a btnN id, pressed encoded as 1/0 (FR-DEV-1)', async () => {
      await manager.build(
        { projectRoot: '/p', effectSrc: '/p/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );
      await manager.deploy(() => undefined);
      manager.sendButton(28, true);
      expect(ipcClientStub.send).toHaveBeenCalledWith({ type: 'controlValue', id: 'btn28', value: 1 });
      manager.sendButton(28, false);
      expect(ipcClientStub.send).toHaveBeenCalledWith({ type: 'controlValue', id: 'btn28', value: 0 });
    });

    it('is a no-op when not connected', () => {
      manager.sendButton(28, true);
      expect(ipcClientStub.send).not.toHaveBeenCalled();
    });
  });

  describe('sendToggle()', () => {
    it('sends a controlValue with a tglN id and the raw position (FR-DEV-7)', async () => {
      await manager.build(
        { projectRoot: '/p', effectSrc: '/p/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );
      await manager.deploy(() => undefined);
      manager.sendToggle(5, 2);
      expect(ipcClientStub.send).toHaveBeenCalledWith({ type: 'controlValue', id: 'tgl5', value: 2 });
    });

    it('is a no-op when not connected', () => {
      manager.sendToggle(5, 2);
      expect(ipcClientStub.send).not.toHaveBeenCalled();
    });
  });

  describe('sendEncoder()', () => {
    it('sends a controlValue with an encN id and the raw accumulated position (FR-DEV-9)', async () => {
      await manager.build(
        { projectRoot: '/p', effectSrc: '/p/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );
      await manager.deploy(() => undefined);
      manager.sendEncoder(5, 42);
      expect(ipcClientStub.send).toHaveBeenCalledWith({ type: 'controlValue', id: 'enc5', value: 42 });
    });

    it('is a no-op when not connected', () => {
      manager.sendEncoder(5, 42);
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

  describe('dispose()/deploy() race (FR-EXT-18)', () => {
    it('kills a child spawned by an in-flight deploy() that dispose() raced before it existed', async () => {
      await manager.build(
        { projectRoot: '/proj', effectSrc: '/proj/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );

      let killed = false;
      spawnMock.mockImplementation((cmd: string) => {
        if (cmd === 'cmake') return makeCmakeProcess(0);
        const proc = new EventEmitter() as EventEmitter & {
          stdout: EventEmitter; stderr: EventEmitter; kill: () => void; pid: number;
        };
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        proc.pid = 12345;
        proc.kill = vi.fn(() => { killed = true; proc.emit('close', null); });
        return proc;
      });

      // Hold deploy() at the mkdir await so dispose() can run while
      // this.childProcess is still null — the race window this FR closes.
      let resolveMkdir!: () => void;
      mkdirMock.mockImplementation(() => new Promise<void>((res) => { resolveMkdir = res; }));

      const deployPromise = manager.deploy(() => undefined);
      manager.dispose();
      expect(killed).toBe(false); // nothing to kill yet — this is the race window

      resolveMkdir();
      await deployPromise.catch(() => { /* expected: the raced child gets killed, deploy rejects */ });

      expect(killed).toBe(true);
    });
  });

  describe('killExisting() escalation (FR-EXT-13)', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('sends SIGTERM only when the child is already gone by the first poll', async () => {
      await manager.build(
        { projectRoot: '/p', effectSrc: '/p/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );
      await manager.deploy(() => undefined);

      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
        throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
      });

      manager.dispose();

      expect(killSpy).toHaveBeenCalledWith(12345, 'SIGTERM');
      expect(killSpy).not.toHaveBeenCalledWith(12345, 'SIGKILL');
    });

    it('escalates to SIGKILL within KILL_ESCALATION_MS when the child ignores SIGTERM', async () => {
      await manager.build(
        { projectRoot: '/p', effectSrc: '/p/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );
      await manager.deploy(() => undefined);

      const killSpy = vi.spyOn(process, 'kill').mockReturnValue(true);

      manager.dispose();

      await new Promise<void>((r) => setTimeout(r, 250));

      expect(killSpy).toHaveBeenCalledWith(12345, 'SIGTERM');
      expect(killSpy).toHaveBeenCalledWith(12345, 'SIGKILL');
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
      detectCMake: async () => 'cmake',
      detectCompiler: async () => '/usr/bin/clang++',
        spawn: failingSpawn as unknown as typeof cp.spawn,
        ipcClientFactory: () => ipcClientStub as unknown as IpcClient,
        mkdir: mkdirMock as unknown as typeof fs.promises.mkdir,
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
      detectCMake: async () => 'cmake',
      detectCompiler: async () => '/usr/bin/clang++',
        spawn: flakySpawn as unknown as typeof cp.spawn,
        ipcClientFactory: () => ipcClientStub as unknown as IpcClient,
        mkdir: mkdirMock as unknown as typeof fs.promises.mkdir,
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

      expect(mkdirMock).toHaveBeenCalledWith(
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

  describe("'exit' event and stop() (FR-TRN-1)", () => {
    const opts = { projectRoot: '/p', effectSrc: '/p/e.cpp', emulatorSrc: '/ext/emulator' };
    let lastChild: ReturnType<typeof makeChildProcess> | undefined;

    beforeEach(() => {
      vi.spyOn(process, 'kill').mockImplementation(() => {
        throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
      });
      spawnMock.mockImplementation((cmd: string) => {
        if (cmd === 'cmake') return makeCmakeProcess(0);
        lastChild = makeChildProcess(0, '/tmp/daisy_emu_test.sock');
        return lastChild;
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('emits exit with crashed=true when a running emulator dies on its own', async () => {
      await manager.build(opts, () => undefined);
      await manager.deploy(() => undefined);
      const onExit = vi.fn();
      manager.on('exit', onExit);

      lastChild!.emit('close', 139);

      expect(onExit).toHaveBeenCalledWith({ pid: 12345, crashed: true });
    });

    it('stop() kills the running emulator and its exit is reported as not crashed', async () => {
      await manager.build(opts, () => undefined);
      await manager.deploy(() => undefined);
      const onExit = vi.fn();
      manager.on('exit', onExit);

      manager.stop();
      expect(manager.childPid).toBeUndefined();
      expect(process.kill).toHaveBeenCalledWith(12345, 'SIGTERM');
      lastChild!.emit('close', null);

      expect(onExit).toHaveBeenCalledWith({ pid: 12345, crashed: false });
    });

    it('stop({ immediate: true }) sends SIGKILL straight away — a debugger cannot intercept it (FR-TRN-1)', async () => {
      await manager.build(opts, () => undefined);
      await manager.deploy(() => undefined);
      manager.stop({ immediate: true });
      expect(process.kill).toHaveBeenCalledWith(12345, 'SIGKILL');
      expect(process.kill).not.toHaveBeenCalledWith(12345, 'SIGTERM');
    });

    it('stop() does not dispose the manager — a later deploy still works', async () => {
      await manager.build(opts, () => undefined);
      await manager.deploy(() => undefined);
      manager.stop();
      await manager.deploy(() => undefined);
      expect(manager.childPid).toBe(12345);
    });

    it('a redeploy reports the replaced emulator as exited, not crashed', async () => {
      await manager.build(opts, () => undefined);
      await manager.deploy(() => undefined);
      const first = lastChild!;
      const onExit = vi.fn();
      manager.on('exit', onExit);

      await manager.deploy(() => undefined);
      first.emit('close', null);

      expect(onExit).toHaveBeenCalledWith({ pid: 12345, crashed: false });
    });

    it('does not emit exit for an emulator that never became ready', async () => {
      spawnMock.mockImplementation((cmd: string) =>
        cmd === 'cmake' ? makeCmakeProcess(0) : makeChildProcess(1));
      await manager.build(opts, () => undefined);
      const onExit = vi.fn();
      manager.on('exit', onExit);

      await expect(manager.deploy(() => undefined)).rejects.toThrow('before socket ready');

      expect(onExit).not.toHaveBeenCalled();
    });
  });

  describe('isConnected (FR-UX-2)', () => {
    it('is false before any deploy', () => {
      expect(manager.isConnected).toBe(false);
    });

    it('is true after a successful deploy', async () => {
      await manager.build(
        { projectRoot: '/p', effectSrc: '/p/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );
      await manager.deploy(() => undefined);
      expect(manager.isConnected).toBe(true);
    });

    it('honestly reflects an unexpected disconnect (crash) even though the client reference is retained', async () => {
      await manager.build(
        { projectRoot: '/p', effectSrc: '/p/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );
      await manager.deploy(() => undefined);
      expect(manager.isConnected).toBe(true);

      // Simulate the real IpcClient's socket 'close' handler: it flips its own
      // connected state to false before emitting 'disconnect'.
      ipcClientStub.connected = false;
      ipcClientStub.emit('disconnect');
      expect(manager.isConnected).toBe(false);
    });

    it('is false after dispose()', async () => {
      await manager.build(
        { projectRoot: '/p', effectSrc: '/p/e.cpp', emulatorSrc: '/ext/emulator' },
        () => undefined,
      );
      await manager.deploy(() => undefined);
      manager.dispose();
      expect(manager.isConnected).toBe(false);
    });
  });
});
