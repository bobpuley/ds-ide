import * as cp from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventEmitter } from 'events';
import { IpcClient, IpcMessage, IpcWarning, CONNECT_TIMEOUT_MS } from './ipc-client';
import { parseAnnounce, formatIpcAddress } from './ipc-address';
import { potControlId, buttonControlId, toggleControlId, encoderControlId, narrowControlValue, narrowControlSnapshot } from '../ipc/control-values';
import type { ScopeCaptureRequest } from '../ipc/narrow';
import { PROTOCOL_VERSION } from '../ipc/protocol-version';
import { detectCMake, detectCxxCompiler, cmakeNotFoundMessage, cxxCompilerNotFoundMessage } from '../hardware/toolchain';
import type { GeneratorId, GeneratorParams } from '../webview/scope/scope-generators';

const SOCKET_TIMEOUT_MS = 10_000;
// Grace period between SIGTERM and SIGKILL escalation when reclaiming a
// stale emulator process (FR-EXT-2) or terminating the manager's own live
// child (FR-EXT-13).
const KILL_ESCALATION_MS = 200;
// FR-WIN-IPC-3: how long a child gets to exit on its own after the IPC
// shutdown message (audio stop, recorder flush, telemetry drain) before the
// SIGTERM → SIGKILL escalation above (TerminateProcess on Windows).
export const SHUTDOWN_GRACE_MS = 2_000;

// SIGTERM first, escalating to SIGKILL only if `pid` is still alive after a
// short grace period. Never throws — safe to call fire-and-forget.
async function escalateKill(pid: number, immediate = false): Promise<void> {
  if (immediate) {
    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
    return;
  }
  try { process.kill(pid, 'SIGTERM'); } catch { return; }
  const deadline = Date.now() + KILL_ESCALATION_MS;
  let alive = true;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); } catch { alive = false; break; }
    await new Promise<void>((r) => setTimeout(r, 10));
  }
  if (alive) {
    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  }
}

function pidFilePath(buildDir: string): string {
  return path.join(buildDir, 'emu.pid');
}

// Per-workspace scratch directory for the emulator's IPC socket, keyed by a
// hash of buildDir (itself unique per project) rather than the project's own
// (possibly deeply-nested and long) path — UNIX domain socket paths are
// capped at ~103 bytes, and os.tmpdir() is typically short and fixed-length
// regardless of where the project lives (FR-EXT-2).
export function workspaceRuntimeDir(buildDir: string): string {
  const hash = crypto.createHash('sha256').update(buildDir).digest('hex').slice(0, 10);
  return path.join(os.tmpdir(), `ds-ide-${hash}`);
}

// Remove stale UNIX socket files left by a previous crashed session of
// *this* workspace only — scoped to its own runtime directory, never a
// global /tmp sweep that could sever another concurrently running VS Code
// window's live emulator socket (FR-EXT-2). Unix-socket transport only: on
// Windows the TCP transport leaves no files behind (FR-WIN-IPC-1). Never
// rejects.
export async function sweepStaleSockets(
  buildDir: string,
  platform: NodeJS.Platform,
  fsp: Pick<typeof fs.promises, 'readdir' | 'unlink'> = fs.promises,
): Promise<void> {
  if (platform === 'win32') return;
  const runtimeDir = workspaceRuntimeDir(buildDir);
  let entries: string[];
  try {
    entries = await fsp.readdir(runtimeDir);
  } catch {
    return; // directory may not exist yet
  }
  await Promise.all(entries
    .filter((entry) => entry.endsWith('.sock'))
    .map((entry) => fsp.unlink(path.join(runtimeDir, entry)).catch(() => { /* ignore already-gone */ })));
}

// True if `pid` is currently running an effect_emu process. Used to verify
// identity before signaling a PID recorded in emu.pid, since PIDs are reused
// by the OS after the original process exits — e.g. across a reboot, where a
// stale emu.pid could otherwise point at an unrelated, unrecognizable
// process (FR-EXT-2). FR-WIN-IPC-4: one function, per-platform query — `ps`
// on macOS/Linux, `tasklist` on Windows — matching the executable name
// exactly (a suffix match would accept e.g. "my_effect_emu"). Any query
// failure counts as "not ours", so nothing is ever signalled on doubt.
function isEffectEmuProcess(pid: number, execFileFn: typeof cp.execFile, platform: NodeJS.Platform): Promise<boolean> {
  return new Promise((resolve) => {
    if (platform === 'win32') {
      execFileFn('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], (err, stdout) => {
        if (err) { resolve(false); return; }
        // "effect_emu.exe","424242","Console","1","12,345 K" — or an INFO line.
        const row = /^"([^"]*)","(\d+)"/.exec(String(stdout).trim());
        resolve(!!row && row[1]!.toLowerCase() === 'effect_emu.exe' && row[2] === String(pid));
      });
      return;
    }
    execFileFn('ps', ['-p', String(pid), '-o', 'comm='], (err, stdout) => {
      if (err) { resolve(false); return; }
      resolve(path.basename(String(stdout).trim()) === 'effect_emu');
    });
  });
}

export async function killStalePid(
  buildDir: string,
  execFileFn: typeof cp.execFile,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  const pidFile = pidFilePath(buildDir);
  try {
    const text = (await fs.promises.readFile(pidFile, 'utf8')).trim();
    // Strict: parseInt would accept "123abc" as 123 (FR-WIN-IPC-4).
    const pid = /^\d+$/.test(text) ? Number(text) : 0;
    if (pid > 0 && await isEffectEmuProcess(pid, execFileFn, platform)) {
      // SIGTERM first, escalating to SIGKILL only if the process is still
      // alive after a short grace period (FR-EXT-2).
      await escalateKill(pid);
    }
    // A PID that doesn't identify as effect_emu (reused by an unrelated
    // process) is left alone entirely — only the stale pid file is cleared.
  } catch { /* pid file absent or process already gone */ }
  try { await fs.promises.unlink(pidFile); } catch { /* ignore */ }
}

async function writePid(buildDir: string, pid: number): Promise<void> {
  try { await fs.promises.writeFile(pidFilePath(buildDir), String(pid)); } catch { /* ignore */ }
}

async function clearPid(buildDir: string): Promise<void> {
  try { await fs.promises.unlink(pidFilePath(buildDir)); } catch { /* ignore */ }
}

// FR-WIN-IPC-3: an emulator stopped via the shutdown message can exit after a
// redeploy has already written the next emulator's PID — only clear the file
// while it still records `pid`. Never rejects.
export async function clearPidIfOwned(buildDir: string, pid: number): Promise<void> {
  try {
    const recorded = (await fs.promises.readFile(pidFilePath(buildDir), 'utf8')).trim();
    if (recorded === String(pid)) await fs.promises.unlink(pidFilePath(buildDir));
  } catch { /* no pid file, or already gone */ }
}

// Waits for a child that was sent the IPC shutdown message; escalates
// (SIGTERM → SIGKILL, TerminateProcess on Windows) only if it is still
// running after SHUTDOWN_GRACE_MS.
async function terminateUnlessExited(child: cp.ChildProcess, pid: number): Promise<void> {
  const exited = await new Promise<boolean>((resolve) => {
    if (child.exitCode != null || child.signalCode != null) return resolve(true);
    const timer = setTimeout(() => { child.off('exit', onExit); resolve(false); }, SHUTDOWN_GRACE_MS);
    const onExit = (): void => { clearTimeout(timer); resolve(true); };
    child.once('exit', onExit);
  });
  if (!exited) await escalateKill(pid);
}

export interface BuildOptions {
  projectRoot: string;
  effectSrc: string;
  daisySpDir?: string;
  emulatorSrc: string;
}

// Structurally compatible with vscode.CancellationToken (not imported here —
// this module stays UI-independent/headless-testable) so callers can pass a
// real one straight through (FR-EXT-16).
export interface CancellationToken {
  isCancellationRequested: boolean;
  onCancellationRequested(listener: () => void): { dispose(): void };
}

// FR-REL-2: CMake could not be found (or could not be started). Distinct from
// a CMake that ran and failed, which is a build error reported through the
// diagnostics path.
export class CMakeNotFoundError extends Error {
  constructor(platform: NodeJS.Platform = process.platform) {
    super(cmakeNotFoundMessage(platform));
    this.name = 'CMakeNotFoundError';
  }
}

// FR-PRE-1: no C++ compiler (the Xcode Command Line Tools are not installed).
export class CompilerNotFoundError extends Error {
  constructor(platform: NodeJS.Platform = process.platform) {
    super(cxxCompilerNotFoundMessage(platform));
    this.name = 'CompilerNotFoundError';
  }
}

// FR-PRE-4: shown when Deploy finds no build to deploy.
export const NOTHING_BUILT_MESSAGE =
  'Nothing built yet. Run Daisy IDE: Run Daisy Effect, or Build for Emulator first.';

function isSpawnNotFound(err: unknown): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT';
}

export interface EmulatorManagerDeps {
  detectCMake?: () => Promise<string | undefined>;
  detectCompiler?: () => Promise<string | undefined>;
  spawn?: typeof cp.spawn;
  ipcClientFactory?: () => IpcClient;
  mkdir?: typeof fs.promises.mkdir;
  execFile?: typeof cp.execFile;
  readFile?: typeof fs.promises.readFile;
  rm?: typeof fs.promises.rm;
  access?: typeof fs.promises.access;
  platform?: NodeJS.Platform;
}

// FR-WIN-BLD-5: Ninja is pinned on Windows (no MSBuild; the toolchain is
// clang/MinGW). Elsewhere CMake's default generator is kept as before.
export function cmakeConfigureArgs(
  opts: Pick<BuildOptions, 'emulatorSrc' | 'effectSrc' | 'daisySpDir'>,
  buildDir: string,
  platform: NodeJS.Platform,
): string[] {
  const args = ['-S', opts.emulatorSrc, '-B', buildDir, `-DEFFECT_SRC=${opts.effectSrc}`];
  if (opts.daisySpDir) args.push(`-DDAISYSP_DIR=${opts.daisySpDir}`);
  if (platform === 'win32') args.push('-G', 'Ninja');
  return args;
}

// `cmake --build -j N` is generator-neutral; the old `-- -jN` passed the flag
// straight to make/ninja and is invalid for other generators.
export function cmakeBuildArgs(buildDir: string, jobs: number): string[] {
  return ['--build', buildDir, '-j', String(Math.max(1, jobs))];
}

export function emulatorExecutableName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'effect_emu.exe' : 'effect_emu';
}

// FR-TRN-1: emitted once per emulator that became ready, when its process
// exits. `crashed` is false when the extension itself ended it (stop(),
// redeploy, dispose) — the run session uses this to end with its emulator.
export interface EmulatorExit {
  pid: number | undefined;
  crashed: boolean;
}

export class EmulatorManager extends EventEmitter {
  private childProcess: cp.ChildProcess | null = null;
  // Children the extension killed on purpose, so their exit isn't a crash.
  private readonly stoppedChildren = new WeakSet<cp.ChildProcess>();
  private ipcClient: IpcClient | null = null;
  private buildDir = '';
  // FR-EXM-8: the folder the effect was built from; the emulator runs in it so
  // its virtual SD card (a relative `sdcard/`) is <project>/sdcard/.
  private projectRoot = '';
  private socketPath: string | null = null;
  // Set to true before intentional kills (redeploy/dispose) so the disconnect
  // event is not forwarded to callers as an unexpected crash.
  private intentionalDisconnect = false;
  private lastKnownRunning: boolean | undefined = undefined;
  private deployLock: Promise<void> | null = null;
  // FR-EXT-18: dispose() can race an in-flight deploy() — set the instant
  // dispose() runs, checked right after deploy() assigns this.childProcess
  // so a child spawned in that race window is killed instead of orphaned.
  private disposed = false;

  private readonly spawn: typeof cp.spawn;
  private readonly ipcClientFactory: () => IpcClient;
  private readonly mkdir: typeof fs.promises.mkdir;
  private readonly execFile: typeof cp.execFile;
  private readonly readFile: typeof fs.promises.readFile;
  private readonly rm: typeof fs.promises.rm;
  private readonly access: typeof fs.promises.access;
  private readonly platform: NodeJS.Platform;
  private readonly detectCMake: () => Promise<string | undefined>;
  private readonly detectCompiler: () => Promise<string | undefined>;

  constructor(deps: EmulatorManagerDeps = {}) {
    super();
    // Looked up at call time, not captured here: the extension activates when a
    // Daisy project opens, so anything that replaces child_process.spawn later
    // (the e2e specs' process-boundary stub) must still be seen.
    this.spawn = deps.spawn ?? (((...args: Parameters<typeof cp.spawn>) => (cp.spawn as (...a: unknown[]) => cp.ChildProcess)(...args)) as typeof cp.spawn);
    this.ipcClientFactory = deps.ipcClientFactory ?? (() => new IpcClient());
    this.mkdir = deps.mkdir ?? fs.promises.mkdir;
    this.execFile = deps.execFile ?? cp.execFile;
    this.readFile = deps.readFile ?? fs.promises.readFile;
    this.rm = deps.rm ?? fs.promises.rm;
    this.access = deps.access ?? fs.promises.access;
    this.platform = deps.platform ?? process.platform;
    this.detectCMake = deps.detectCMake ?? (() => detectCMake());
    this.detectCompiler = deps.detectCompiler ?? (() => detectCxxCompiler());
  }

  async build(opts: BuildOptions, onOutput: (line: string) => void, token?: CancellationToken): Promise<void> {
    // FR-REL-2: resolve CMake first, so a missing one fails before the build
    // directory is touched.
    const cmake = await this.detectCMake();
    if (!cmake) throw new CMakeNotFoundError(this.platform);
    // FR-PRE-1: and a compiler, so CMake does not fail with a cryptic message.
    if (!await this.detectCompiler()) throw new CompilerNotFoundError(this.platform);

    this.projectRoot = opts.projectRoot;
    this.buildDir = path.join(opts.projectRoot, '.ds-ide', 'build');
    await this.healStaleCache(this.buildDir, opts.emulatorSrc);
    await this.mkdir(this.buildDir, { recursive: true });

    await this.runCMake(cmake, cmakeConfigureArgs(opts, this.buildDir, this.platform), onOutput, token);
    await this.runCMake(cmake, cmakeBuildArgs(this.buildDir, os.cpus().length), onOutput, token);
  }

  // The single-config location (Makefiles/Ninja) first; a multi-config
  // generator's default Debug/ subdirectory as a fallback.
  private async findExecutable(buildDir: string): Promise<string | undefined> {
    const name = emulatorExecutableName(this.platform);
    for (const candidate of [path.join(buildDir, name), path.join(buildDir, 'Debug', name)]) {
      try {
        await this.access(candidate);
        return candidate;
      } catch { /* try the next location */ }
    }
    return undefined;
  }

  // If no build exists the single-config path is returned so the spawn error
  // names it.
  private async resolveExecutable(buildDir: string): Promise<string> {
    return (await this.findExecutable(buildDir))
      ?? path.join(buildDir, emulatorExecutableName(this.platform));
  }

  // A spawn that fails with ENOENT means the resolved CMake is gone (removed
  // or moved after detection) — the same "not found" the user has to fix.
  private async runCMake(
    cmake: string,
    args: string[],
    onOutput: (line: string) => void,
    token?: CancellationToken,
  ): Promise<void> {
    try {
      await this.runProcess(cmake, args, onOutput, token);
    } catch (err) {
      throw isSpawnNotFound(err) ? new CMakeNotFoundError(this.platform) : err;
    }
  }

  // FR-PRE-4: a fresh window has built nothing itself, but the project may hold
  // a build from an earlier session. Uses it when it exists (or when this
  // session already built this project); never another project's build.
  async adoptExistingBuild(projectRoot: string): Promise<boolean> {
    const buildDir = path.join(projectRoot, '.ds-ide', 'build');
    if (!await this.findExecutable(buildDir)) {
      return this.buildDir !== '' && this.projectRoot === projectRoot;
    }
    this.projectRoot = projectRoot;
    this.buildDir = buildDir;
    return true;
  }

  deploy(onOutput: (line: string) => void, token?: CancellationToken): Promise<void> {
    if (!this.buildDir) {
      return Promise.reject(new Error(NOTHING_BUILT_MESSAGE));
    }
    // Prevent two simultaneous effect_emu processes: coalesce on the in-flight promise.
    if (this.deployLock) return this.deployLock;

    const buildDir = this.buildDir;
    const useTcp = this.platform === 'win32';
    // Socket lives under a per-workspace directory with a randomized filename
    // component, not a predictable global-/tmp path (FR-EXT-2). Unix-socket
    // transport only — Windows uses TCP loopback and has no socket file
    // (FR-WIN-IPC-1).
    const runtimeDir = workspaceRuntimeDir(this.buildDir);

    // mkdir (not mkdirSync) so this doesn't block the Extension Host; the
    // deployLock below is still assigned synchronously so concurrent deploy()
    // calls coalesce onto the same promise regardless (FR-QA-EXT-7).
    const prepared = useTcp
      ? Promise.resolve()
      : this.mkdir(runtimeDir, { recursive: true, mode: 0o700 }).then(() => undefined);
    const deployPromise = prepared.then(() => {
      this.socketPath = useTcp
        ? null
        : path.join(runtimeDir, `emu-${crypto.randomBytes(4).toString('hex')}.sock`);
      const spawnArgs = this.socketPath ? [this.socketPath] : ['--tcp'];
      // FR-WIN-IPC-2: a fresh per-session token for the TCP transport, sent
      // over stdin (never argv) and presented by the client on connect.
      const sessionToken = useTcp ? crypto.randomBytes(32).toString('hex') : undefined;

      // Kill any process left over from a previous session, waiting up to 200 ms
      // for it to exit before spawning a new one (FR-EMU-3). Identity-checked
      // and SIGTERM-first (FR-EXT-2).
      return killStalePid(this.buildDir, this.execFile, this.platform)
        .catch(() => { /* ignore stale-pid errors */ })
        // Resolved before killExisting() so kill → spawn stays synchronous.
        .then(() => this.resolveExecutable(buildDir))
        .then((exePath) => {
          this.killExisting();

          const child = this.spawn(exePath, spawnArgs, {
            cwd: this.projectRoot || undefined,
            stdio: [sessionToken ? 'pipe' : 'ignore', 'pipe', 'pipe'],
          });
          this.childProcess = child;
          if (sessionToken) {
            // EPIPE if the emulator died first — its exit is reported below.
            child.stdin?.on('error', () => { /* handled via 'close' */ });
            child.stdin?.write(`${sessionToken}\n`);
            child.stdin?.end();
          }

          return new Promise<void>((resolve, reject) => {
            let resolved = false;
            let ready = false;
            const timeout = setTimeout(() => {
              if (!resolved) {
                reject(new Error(`Emulator did not announce socket path within ${SOCKET_TIMEOUT_MS / 1000}s`));
              }
            }, SOCKET_TIMEOUT_MS);

            // FR-EXT-16: lets a caller abort a deploy that's hung waiting for
            // the socket-path announcement/handshake, killing the spawned
            // child rather than leaving the promise pending indefinitely.
            const cancelSub = token?.onCancellationRequested(() => {
              if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                child.kill();
                reject(new Error('deploy cancelled'));
              }
            });

            const onStdout = (data: Buffer): void => {
              const text = data.toString('utf8');
              for (const line of text.split('\n')) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                onOutput(trimmed);
                const match = trimmed.match(/^DAISY_EMU_SOCKET:(.+)$/);
                if (match && !resolved) {
                  resolved = true;
                  ready = true;
                  clearTimeout(timeout);
                  cancelSub?.dispose();
                  // Persist PID so a future session can clean up this process
                  if (child.pid !== undefined) void writePid(this.buildDir, child.pid);
                  void this.connectIpc(match[1]!, sessionToken).then(resolve).catch(reject);
                }
              }
            };

            const onError = (err: Error): void => {
              if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                cancelSub?.dispose();
                reject(err);
              }
            };

            child.stdout?.on('data', onStdout);
            child.stderr?.on('data', (data: Buffer) => onOutput(data.toString('utf8').trim()));
            child.on('error', onError);
            child.on('close', (code) => {
              if (child.pid !== undefined) void clearPidIfOwned(buildDir, child.pid);
              if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                cancelSub?.dispose();
                reject(new Error(`Emulator exited with code ${code ?? 'null'} before socket ready`));
              }
              // Guard: only clear the reference if it still points to this child,
              // not to a new child spawned by a subsequent deploy.
              if (this.childProcess === child) this.childProcess = null;
              if (ready) {
                const exit: EmulatorExit = { pid: child.pid, crashed: !this.stoppedChildren.has(child) };
                this.emit('exit', exit);
              }
            });

            // FR-EXT-18: dispose() may have run during the mkdir/killStalePid
            // await above, before this.childProcess existed for it to kill —
            // it found nothing and had no way to reach this child. Catch that
            // race here (now that the close listener above is wired, so the
            // resulting exit is actually observed) instead of orphaning it.
            if (this.disposed) child.kill();
          });
        });
    });

    this.deployLock = deployPromise;
    // .finally() returns a new promise that adopts deployPromise's rejection.
    // Nothing else observes that derived promise (callers await deployPromise
    // itself, returned below), so a failed deploy would otherwise surface as
    // an unhandledRejection on every failure (FR-EXT-1). The no-op .catch()
    // observes it without changing deployPromise's own rejection behavior.
    deployPromise.finally(() => { this.deployLock = null; }).catch(() => { /* observed; see above */ });
    return deployPromise;
  }

  sendTransport(action: 'start' | 'stop'): void {
    this.ipcClient?.send({ type: 'transport', action });
    // Explicit stop resets the running flag so the next scope burst after
    // sendTransport('start') will re-synthesize the running:true status event.
    if (action === 'stop') this.lastKnownRunning = false;
  }

  sendSine(freq: number, amplitude: number): void {
    this.ipcClient?.send({ type: 'sine', freq, amplitude });
  }

  /**
   * Select an input generator (FR-GEN-4). 'none' hands the input stage back to the host
   * input or WAV; Sine uses sendSine() instead.
   */
  sendGenerator(kind: GeneratorId | 'none', params?: GeneratorParams): void {
    this.ipcClient?.send({
      type: 'generator', kind,
      ...(params && {
        freq: params.freq, amp: params.amp, color: params.color,
        from: params.from, to: params.to, time: params.time, period: params.period,
      }),
    });
  }

  // FR-DEV-1: pot/potSnapshot/button/buttonSnapshot collapse into
  // controlValue/controlSnapshot on the wire — device identity lives in the
  // id field (potN / btnN for now) rather than the message kind.
  sendPot(channel: number, value: number): void {
    this.sendControlValue(potControlId(channel), value);
  }

  sendControlValue(id: string, value: number): void {
    const msg = narrowControlValue(id, value);
    if (!msg) {
      console.warn(`ds-ide: dropped invalid controlValue (id=${id}, value=${value})`);
      return;
    }
    this.ipcClient?.send({ type: 'controlValue', id: msg.id, value: msg.value });
  }

  // Post-(re)deploy control-state replay (FR-CT-11) — one controlSnapshot
  // carrying every pot's, button's and toggle's current value, rather than a
  // separate *Snapshot message per device type. toggleValues defaults to {}
  // so the debug-attach path (which only ever replayed pot state) doesn't
  // need to change (FR-DEV-7).
  sendControlSnapshot(
    potValues: Record<number, number>,
    buttonValues: Record<number, boolean>,
    toggleValues: Record<number, number> = {},
  ): void {
    const values: Record<string, number> = {};
    for (const [channel, value] of Object.entries(potValues)) {
      values[potControlId(Number(channel))] = value;
    }
    for (const [gpioPin, pressed] of Object.entries(buttonValues)) {
      values[buttonControlId(Number(gpioPin))] = pressed ? 1 : 0;
    }
    for (const [gpioPin, position] of Object.entries(toggleValues)) {
      values[toggleControlId(Number(gpioPin))] = position;
    }
    const narrowed = narrowControlSnapshot(values);
    if (!narrowed) {
      console.warn('ds-ide: dropped invalid controlSnapshot');
      return;
    }
    this.ipcClient?.send({ type: 'controlSnapshot', values: narrowed });
  }

  // FR-DEV-16/18: the first *inbound* peripheral message — a note played on
  // the virtual keyboard or forwarded by the host MIDI bridge, travelling
  // extension -> emulator. Flat numeric fields (not a byte array):
  // ipc_server.cpp's json_get has no array parser, and every other numeric
  // field on this wire (value, freq, amplitude, ...) is already flat.
  sendMidiEvent(status: number, data1: number, data2: number): void {
    this.ipcClient?.send({ type: 'midiEvent', status, data1, data2 });
  }

  sendAudioMode(mode: 'simulated' | 'realtime'): void {
    this.ipcClient?.send({ type: 'audioMode', mode });
  }

  sendAudioDevice(sampleRate: number, bufferSize: number): void {
    this.ipcClient?.send({ type: 'audioDevice', sampleRate, bufferSize });
  }

  // M9: select a WAV file as the input source. An empty path deactivates WAV
  // input and the runtime reverts to the sine generator.
  sendWavFile(path: string, loop: boolean): void {
    this.ipcClient?.send({ type: 'wavFile', path, loop });
  }

  // M10: virtual button press/release, keyed by Daisy GPIO pin number.
  sendButton(gpioPin: number, pressed: boolean): void {
    this.sendControlValue(buttonControlId(gpioPin), pressed ? 1 : 0);
  }

  // FR-DEV-7: virtual toggle-switch position (0, 1, 2), keyed by Daisy GPIO pin number.
  sendToggle(gpioPin: number, position: number): void {
    this.sendControlValue(toggleControlId(gpioPin), position);
  }

  // FR-DEV-9: virtual encoder's accumulated position (wrapped into
  // [0, ENCODER_POSITION_MODULUS)), keyed by its primary (A-channel) pin —
  // not persisted/replayed like pot/button/toggle (see registry.ts's comment
  // on encoder's value semantics; no workspaceState store for it).
  sendEncoder(gpioPin: number, position: number): void {
    this.sendControlValue(encoderControlId(gpioPin), position);
  }

  // FR-SCI-14c: arm / cancel one full-rate, emulator-side triggered capture; the reply
  // arrives as a `scope_capture` message.
  sendScopeCapture(req: ScopeCaptureRequest): void {
    this.ipcClient?.send({ type: 'scopeCapture', ...req });
  }

  // M15: master output volume (0.0–1.0) — scales emulator output before CoreAudio write.
  sendOutputVolume(volume: number): void {
    this.ipcClient?.send({ type: 'outputVolume', volume });
  }

  // M14: session recording
  sendRecordStart(filePath: string): void {
    this.ipcClient?.send({ type: 'recordStart', path: filePath });
  }

  sendRecordStop(): void {
    this.ipcClient?.send({ type: 'recordStop' });
  }

  sendReplayStart(filePath: string): void {
    this.ipcClient?.send({ type: 'replayStart', path: filePath });
  }

  sendReplayStop(): void {
    this.ipcClient?.send({ type: 'replayStop' });
  }

  get childPid(): number | undefined {
    return this.childProcess?.pid;
  }

  // Reflects the IpcClient's own live socket state, not just whether we still
  // hold a reference to it — an unexpected disconnect clears the client's
  // socket internally but the 'disconnect' handler above does not null out
  // this.ipcClient, so callers must check the underlying connection honestly
  // rather than trusting a stale reference (FR-UX-2).
  get isConnected(): boolean {
    return this.ipcClient?.connected ?? false;
  }

  // FR-TRN-1: ends the running emulator without disposing the manager, so a
  // run session's Stop can kill it and a later deploy still works.
  // `immediate` skips SIGTERM: with lldb attached, SIGTERM is caught and
  // pauses the process (VS Code then jumps into the shim) instead of ending it.
  stop(opts: { immediate?: boolean } = {}): void {
    this.killExisting(opts.immediate ?? false);
  }

  dispose(): void {
    this.disposed = true;
    this.killExisting();
    this.ipcClient?.disconnect();
    this.ipcClient = null;
  }

  private async connectIpc(announced: string, sessionToken?: string): Promise<void> {
    this.intentionalDisconnect = false;  // new live connection — reset flag
    this.lastKnownRunning = undefined;   // fresh connection — unknown until first status
    const client = this.ipcClientFactory();
    this.ipcClient = client;
    // Synthesize status:{running:true} when scope data arrives after status:{running:false}.
    // The emulator sends running:false on connect but never sends running:true explicitly —
    // it simply starts sending scope/spectrum data when audio is active.
    // lastKnownRunning is a class field so sendTransport('stop') can reset it between
    // stop and the next start, keeping the synthesis logic correct across restarts.
    let lastStatusMsg: IpcMessage | null = null;
    client.on('message', (msg: IpcMessage) => {
      if (msg['type'] === 'status') {
        this.lastKnownRunning = !!msg['running'];
        lastStatusMsg = msg;
      } else if (msg['type'] === 'scope' || msg['type'] === 'spectrum') {
        if (this.lastKnownRunning === false) {
          this.lastKnownRunning = true;
          this.emit('message', { ...(lastStatusMsg ?? {}), type: 'status', running: true });
        }
      }
      this.emit('message', msg);
    });
    client.on('error', (err: Error) => this.emit('error', err));
    // FR-EXT-25: mirrors the 'error'/'disconnect' forwarding above — dropped
    // or malformed IPC traffic was previously visible only via console.warn,
    // invisible to anything outside the extension host's dev console.
    client.on('warning', (warning: IpcWarning) => this.emit('warning', warning));
    client.on('disconnect', () => {
      if (!this.intentionalDisconnect) this.emit('disconnect');
    });
    // FR-DEV-6: register the handshake listener before connect() so it can
    // never miss a message delivered synchronously with (or immediately
    // after) the connection completing.
    try {
      // FR-WIN-IPC-1: a malformed announce fails here and still kills the child.
      const address = parseAnnounce(announced, this.platform);
      const handshake = this.awaitProtocolHandshake(client, formatIpcAddress(address));
      if (address.kind === 'tcp') await client.connect(address, undefined, sessionToken);
      else await client.connect(address);
      await handshake;
    } catch (err) {
      // FR-EXT-7: the effect_emu child was already spawned before this
      // handshake began — without this, a failed connect/handshake (timeout,
      // malformed/version-mismatched response) leaves it orphaned until the
      // next stale-PID reaper or an explicit dispose().
      if (this.childProcess) {
        this.stoppedChildren.add(this.childProcess);
        this.childProcess.kill();
        this.childProcess = null;
      }
      throw err;
    }
  }

  // FR-DEV-6: the emulator's very first message on a new connection is a
  // protocolVersion handshake — reject before the session is considered
  // usable (and before any control message is ever exchanged) if it's
  // missing, malformed, or doesn't match this extension's own version.
  // Reuses IpcClient's own connect-phase timeout budget rather than adding a
  // second one.
  private awaitProtocolHandshake(client: IpcClient, addressLabel: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        client.off('message', onMessage);
        client.disconnect();
        reject(new Error(
          `emulator at ${addressLabel} did not send a protocol version handshake within ${CONNECT_TIMEOUT_MS}ms`,
        ));
      }, CONNECT_TIMEOUT_MS);

      const onMessage = (msg: IpcMessage): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        client.off('message', onMessage);

        if (msg['type'] !== 'protocolVersion') {
          client.disconnect();
          reject(new Error(
            `emulator's first message was "${String(msg['type'])}", not a protocol version ` +
            `handshake — the emulator binary is likely from an incompatible, older ds-ide ` +
            `build. Rebuild the emulator (ds-ide: Build for Emulator) to fix.`,
          ));
          return;
        }

        const remoteVersion = msg['version'];
        if (remoteVersion !== PROTOCOL_VERSION) {
          client.disconnect();
          reject(new Error(
            `protocol version mismatch — extension expects v${PROTOCOL_VERSION}, emulator ` +
            `reports v${String(remoteVersion)}. Rebuild the emulator (ds-ide: Build for ` +
            `Emulator) or reinstall the extension so both sides match.`,
          ));
          return;
        }

        resolve();
      };

      client.on('message', onMessage);
    });
  }

  private killExisting(immediate = false): void {
    this.intentionalDisconnect = true;  // suppress the subsequent disconnect event
    const client = this.ipcClient;
    this.ipcClient = null;
    if (this.childProcess) {
      const child = this.childProcess;
      const pid = child.pid;
      this.stoppedChildren.add(child);
      this.childProcess = null;
      if (pid && !immediate && client?.connected) {
        // FR-WIN-IPC-3: ask the emulator to exit on its own first (on
        // Windows, killing it skips the recorder flush entirely); terminate
        // only if it is still running after the grace period. An `immediate`
        // stop skips this — a debugger-paused process can't read the message.
        client.sendAndClose({ type: 'shutdown' });
        void terminateUnlessExited(child, pid);
        // The pid file stays until the child's own 'close' (clearPidIfOwned):
        // if the extension host dies mid-grace, the next session can still
        // reclaim a wedged emulator.
        return this.finishKill({ keepPid: true });
      }
      // SIGTERM → wait KILL_ESCALATION_MS → SIGKILL, matching killStalePid's
      // escalation so a child that ignores/misses SIGTERM (e.g. blocked in a
      // native audio callback) is still force-terminated (FR-EXT-13).
      if (pid) void escalateKill(pid, immediate);
    }
    client?.disconnect();
    this.finishKill();
  }

  private finishKill(opts: { keepPid?: boolean } = {}): void {
    if (this.socketPath) {
      void fs.promises.unlink(this.socketPath).catch(() => { /* ignore if already gone */ });
      this.socketPath = null;
    }
    if (this.buildDir && !opts.keepPid) void clearPid(this.buildDir);
  }

  // FR-PKG-2: <project>/.ds-ide/build persists indefinitely while emulatorSrc
  // (the extension's own emulator/ path passed to `cmake -S`) can change
  // across a dev-host-checkout-vs-installed-extension switch or an extension
  // version upgrade — a stale cache then makes CMake's configure step fail
  // outright with "the source ... does not match the source ... used to
  // generate cache". Detect that mismatch here and wipe the build dir so the
  // subsequent mkdir+configure below reconfigures fresh, automatically and
  // with no user confirmation (2026-08-26 decision).
  private async healStaleCache(buildDir: string, emulatorSrc: string): Promise<void> {
    let cacheText: string;
    try {
      cacheText = await this.readFile(path.join(buildDir, 'CMakeCache.txt'), 'utf8') as string;
    } catch {
      return; // no cache yet — nothing to heal
    }
    const match = cacheText.match(/^CMAKE_HOME_DIRECTORY:INTERNAL=(.*)$/m);
    if (!match) return;
    const cachedSrc = match[1]!.trim();
    if (path.resolve(cachedSrc) === path.resolve(emulatorSrc)) return;
    await this.rm(buildDir, { recursive: true, force: true });
  }

  private runProcess(
    cmd: string,
    args: string[],
    onOutput: (line: string) => void,
    token?: CancellationToken,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = this.spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });

      const handleOutput = (data: Buffer): void => {
        for (const line of data.toString('utf8').split('\n')) {
          if (line.trim()) onOutput(line);
        }
      };

      proc.stdout?.on('data', handleOutput);
      proc.stderr?.on('data', handleOutput);
      // FR-EXT-16: a hung cmake configure/build otherwise leaves the
      // command's promise pending forever with no way to abort it.
      const cancelSub = token?.onCancellationRequested(() => proc.kill());
      proc.on('error', (err) => { cancelSub?.dispose(); reject(err); });
      proc.on('close', (code) => {
        cancelSub?.dispose();
        if (token?.isCancellationRequested) {
          reject(new Error(`${cmd} cancelled`));
        } else if (code === 0) {
          resolve();
        } else {
          reject(new Error(`${cmd} exited with code ${code ?? 'null'}`));
        }
      });
    });
  }
}
