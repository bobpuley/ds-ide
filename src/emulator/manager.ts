import * as cp from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventEmitter } from 'events';
import { IpcClient, IpcMessage, IpcWarning, CONNECT_TIMEOUT_MS } from './ipc-client';
import { potControlId, buttonControlId, toggleControlId, encoderControlId, narrowControlValue, narrowControlSnapshot } from '../ipc/control-values';
import { PROTOCOL_VERSION } from '../ipc/protocol-version';

const SOCKET_TIMEOUT_MS = 10_000;
// Grace period between SIGTERM and SIGKILL escalation when reclaiming a
// stale emulator process (FR-EXT-2) or terminating the manager's own live
// child (FR-EXT-13).
const KILL_ESCALATION_MS = 200;

// SIGTERM first, escalating to SIGKILL only if `pid` is still alive after a
// short grace period. Never throws — safe to call fire-and-forget.
async function escalateKill(pid: number): Promise<void> {
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

// True if `pid` is currently running an effect_emu process. Used to verify
// identity before signaling a PID recorded in emu.pid, since PIDs are reused
// by the OS after the original process exits — e.g. across a reboot, where a
// stale emu.pid could otherwise point at an unrelated, unrecognizable
// process (FR-EXT-2).
function isEffectEmuProcess(pid: number, execFileFn: typeof cp.execFile): Promise<boolean> {
  return new Promise((resolve) => {
    execFileFn('ps', ['-p', String(pid), '-o', 'comm='], (err, stdout) => {
      if (err) { resolve(false); return; }
      resolve(String(stdout).trim().endsWith('effect_emu'));
    });
  });
}

export async function killStalePid(buildDir: string, execFileFn: typeof cp.execFile): Promise<void> {
  const pidFile = pidFilePath(buildDir);
  try {
    const text = await fs.promises.readFile(pidFile, 'utf8');
    const pid = parseInt(text.trim(), 10);
    if (pid > 0 && await isEffectEmuProcess(pid, execFileFn)) {
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

export interface EmulatorManagerDeps {
  spawn?: typeof cp.spawn;
  ipcClientFactory?: () => IpcClient;
  mkdir?: typeof fs.promises.mkdir;
  execFile?: typeof cp.execFile;
}

export class EmulatorManager extends EventEmitter {
  private childProcess: cp.ChildProcess | null = null;
  private ipcClient: IpcClient | null = null;
  private buildDir = '';
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

  constructor(deps: EmulatorManagerDeps = {}) {
    super();
    this.spawn = deps.spawn ?? cp.spawn;
    this.ipcClientFactory = deps.ipcClientFactory ?? (() => new IpcClient());
    this.mkdir = deps.mkdir ?? fs.promises.mkdir;
    this.execFile = deps.execFile ?? cp.execFile;
  }

  async build(opts: BuildOptions, onOutput: (line: string) => void, token?: CancellationToken): Promise<void> {
    this.buildDir = path.join(opts.projectRoot, '.ds-ide', 'build');
    await this.mkdir(this.buildDir, { recursive: true });

    const configureArgs = [
      '-S', opts.emulatorSrc,
      '-B', this.buildDir,
      `-DEFFECT_SRC=${opts.effectSrc}`,
    ];
    if (opts.daisySpDir) {
      configureArgs.push(`-DDAISYSP_DIR=${opts.daisySpDir}`);
    }

    await this.runProcess('cmake', configureArgs, onOutput, token);
    await this.runProcess('cmake', ['--build', this.buildDir, '--', `-j${os.cpus().length}`], onOutput, token);
  }

  deploy(onOutput: (line: string) => void, token?: CancellationToken): Promise<void> {
    if (!this.buildDir) {
      return Promise.reject(new Error('Build before deploying'));
    }
    // Prevent two simultaneous effect_emu processes: coalesce on the in-flight promise.
    if (this.deployLock) return this.deployLock;

    const exePath = path.join(this.buildDir, 'effect_emu');
    // Socket lives under a per-workspace directory with a randomized filename
    // component, not a predictable global-/tmp path (FR-EXT-2).
    const runtimeDir = workspaceRuntimeDir(this.buildDir);

    // mkdir (not mkdirSync) so this doesn't block the Extension Host; the
    // deployLock below is still assigned synchronously so concurrent deploy()
    // calls coalesce onto the same promise regardless (FR-QA-EXT-7).
    const deployPromise = this.mkdir(runtimeDir, { recursive: true, mode: 0o700 }).then(() => {
      this.socketPath = path.join(runtimeDir, `emu-${crypto.randomBytes(4).toString('hex')}.sock`);
      const socketPath = this.socketPath;

      // Kill any process left over from a previous session, waiting up to 200 ms
      // for it to exit before spawning a new one (FR-EMU-3). Identity-checked
      // and SIGTERM-first (FR-EXT-2).
      return killStalePid(this.buildDir, this.execFile)
        .catch(() => { /* ignore stale-pid errors */ })
        .then(() => {
          this.killExisting();

          const child = this.spawn(exePath, [socketPath], { stdio: ['ignore', 'pipe', 'pipe'] });
          this.childProcess = child;

          return new Promise<void>((resolve, reject) => {
            let resolved = false;
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
                  clearTimeout(timeout);
                  cancelSub?.dispose();
                  // Persist PID so a future session can clean up this process
                  if (child.pid !== undefined) void writePid(this.buildDir, child.pid);
                  void this.connectIpc(match[1]!).then(resolve).catch(reject);
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
              void clearPid(this.buildDir);
              if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                cancelSub?.dispose();
                reject(new Error(`Emulator exited with code ${code ?? 'null'} before socket ready`));
              }
              // Guard: only clear the reference if it still points to this child,
              // not to a new child spawned by a subsequent deploy.
              if (this.childProcess === child) this.childProcess = null;
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

  dispose(): void {
    this.disposed = true;
    this.killExisting();
    this.ipcClient?.disconnect();
    this.ipcClient = null;
  }

  private async connectIpc(socketPath: string): Promise<void> {
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
    const handshake = this.awaitProtocolHandshake(client, socketPath);
    try {
      await client.connect(socketPath);
      await handshake;
    } catch (err) {
      // FR-EXT-7: the effect_emu child was already spawned before this
      // handshake began — without this, a failed connect/handshake (timeout,
      // malformed/version-mismatched response) leaves it orphaned until the
      // next stale-PID reaper or an explicit dispose().
      if (this.childProcess) {
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
  private awaitProtocolHandshake(client: IpcClient, socketPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        client.off('message', onMessage);
        client.disconnect();
        reject(new Error(
          `emulator at ${socketPath} did not send a protocol version handshake within ${CONNECT_TIMEOUT_MS}ms`,
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

  private killExisting(): void {
    this.intentionalDisconnect = true;  // suppress the subsequent disconnect event
    if (this.childProcess) {
      const pid = this.childProcess.pid;
      this.childProcess = null;
      // SIGTERM → wait KILL_ESCALATION_MS → SIGKILL, matching killStalePid's
      // escalation so a child that ignores/misses SIGTERM (e.g. blocked in a
      // native audio callback) is still force-terminated (FR-EXT-13).
      if (pid) void escalateKill(pid);
    }
    if (this.ipcClient) {
      this.ipcClient.disconnect();
      this.ipcClient = null;
    }
    if (this.socketPath) {
      void fs.promises.unlink(this.socketPath).catch(() => { /* ignore if already gone */ });
      this.socketPath = null;
    }
    if (this.buildDir) void clearPid(this.buildDir);
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
