import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventEmitter } from 'events';
import { IpcClient, IpcMessage } from './ipc-client';

const SOCKET_TIMEOUT_MS = 10_000;

function pidFilePath(buildDir: string): string {
  return path.join(buildDir, 'emu.pid');
}

async function killStalePid(buildDir: string): Promise<void> {
  const pidFile = pidFilePath(buildDir);
  try {
    const text = await fs.promises.readFile(pidFile, 'utf8');
    const pid = parseInt(text.trim(), 10);
    if (pid > 0) {
      process.kill(pid, 'SIGKILL');
      const deadline = Date.now() + 200;
      while (Date.now() < deadline) {
        try { process.kill(pid, 0); } catch { break; }
        await new Promise<void>((r) => setTimeout(r, 10));
      }
    }
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

export interface EmulatorManagerDeps {
  spawn?: typeof cp.spawn;
  ipcClientFactory?: () => IpcClient;
  mkdirSync?: typeof fs.mkdirSync;
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

  private readonly spawn: typeof cp.spawn;
  private readonly ipcClientFactory: () => IpcClient;
  private readonly mkdirSync: typeof fs.mkdirSync;

  constructor(deps: EmulatorManagerDeps = {}) {
    super();
    this.spawn = deps.spawn ?? cp.spawn;
    this.ipcClientFactory = deps.ipcClientFactory ?? (() => new IpcClient());
    this.mkdirSync = deps.mkdirSync ?? fs.mkdirSync;
  }

  async build(opts: BuildOptions, onOutput: (line: string) => void): Promise<void> {
    this.buildDir = path.join(opts.projectRoot, '.ds-ide', 'build');
    this.mkdirSync(this.buildDir, { recursive: true });

    const configureArgs = [
      '-S', opts.emulatorSrc,
      '-B', this.buildDir,
      `-DEFFECT_SRC=${opts.effectSrc}`,
    ];
    if (opts.daisySpDir) {
      configureArgs.push(`-DDAISYSP_DIR=${opts.daisySpDir}`);
    }

    await this.runProcess('cmake', configureArgs, onOutput);
    await this.runProcess('cmake', ['--build', this.buildDir, '--', `-j${os.cpus().length}`], onOutput);
  }

  deploy(onOutput: (line: string) => void): Promise<void> {
    if (!this.buildDir) {
      return Promise.reject(new Error('Build before deploying'));
    }
    // Prevent two simultaneous effect_emu processes: coalesce on the in-flight promise.
    if (this.deployLock) return this.deployLock;

    const exePath = path.join(this.buildDir, 'effect_emu');
    this.socketPath = `/tmp/daisy_emu_${Date.now()}.sock`;
    const socketPath = this.socketPath;

    // Kill any process left over from a previous session, waiting up to 200 ms
    // for it to exit before spawning a new one (FR-EMU-3).
    const deployPromise = killStalePid(this.buildDir)
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
              reject(new Error(`Emulator exited with code ${code ?? 'null'} before socket ready`));
            }
            // Guard: only clear the reference if it still points to this child,
            // not to a new child spawned by a subsequent deploy.
            if (this.childProcess === child) this.childProcess = null;
          });
        });
      });

    this.deployLock = deployPromise;
    deployPromise.finally(() => { this.deployLock = null; });
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

  sendPot(channel: number, value: number): void {
    this.ipcClient?.send({ type: 'pot', channel, value });
  }

  sendPotSnapshot(values: Record<number, number>): void {
    this.ipcClient?.send({ type: 'potSnapshot', values });
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
    this.ipcClient?.send({ type: 'button', gpioPin, pressed });
  }

  // M10: full button-state replay after (re)deploy (FR-CT-11).
  sendButtonSnapshot(values: Record<number, boolean>): void {
    this.ipcClient?.send({ type: 'buttonSnapshot', values });
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

  dispose(): void {
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
    client.on('disconnect', () => {
      if (!this.intentionalDisconnect) this.emit('disconnect');
    });
    await client.connect(socketPath);
  }

  private killExisting(): void {
    this.intentionalDisconnect = true;  // suppress the subsequent disconnect event
    if (this.childProcess) {
      this.childProcess.kill();
      this.childProcess = null;
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

  private runProcess(cmd: string, args: string[], onOutput: (line: string) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = this.spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });

      const handleOutput = (data: Buffer): void => {
        for (const line of data.toString('utf8').split('\n')) {
          if (line.trim()) onOutput(line);
        }
      };

      proc.stdout?.on('data', handleOutput);
      proc.stderr?.on('data', handleOutput);
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`${cmd} exited with code ${code ?? 'null'}`));
      });
    });
  }
}
