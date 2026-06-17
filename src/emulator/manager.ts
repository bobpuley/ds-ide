import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { IpcClient, IpcMessage } from './ipc-client';

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
    await this.runProcess('cmake', ['--build', this.buildDir, '--', '-j4'], onOutput);
  }

  async deploy(onOutput: (line: string) => void): Promise<void> {
    if (!this.buildDir) {
      throw new Error('Build before deploying');
    }
    const exePath = path.join(this.buildDir, 'effect_emu');
    const socketPath = `/tmp/daisy_emu_${Date.now()}.sock`;

    this.killExisting();

    const child = this.spawn(exePath, [socketPath], { stdio: ['ignore', 'pipe', 'pipe'] });
    this.childProcess = child;

    return new Promise((resolve, reject) => {
      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          reject(new Error('Emulator did not announce socket path within 10s'));
        }
      }, 10000);

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
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          reject(new Error(`Emulator exited with code ${code ?? 'null'} before socket ready`));
        }
        this.childProcess = null;
      });
    });
  }

  sendTransport(action: 'start' | 'stop'): void {
    this.ipcClient?.send({ type: 'transport', action });
  }

  sendSine(freq: number, amplitude: number): void {
    this.ipcClient?.send({ type: 'sine', freq, amplitude });
  }

  sendPot(channel: number, value: number): void {
    this.ipcClient?.send({ type: 'pot', channel, value });
  }

  dispose(): void {
    this.killExisting();
    this.ipcClient?.disconnect();
    this.ipcClient = null;
  }

  private async connectIpc(socketPath: string): Promise<void> {
    const client = this.ipcClientFactory();
    this.ipcClient = client;
    client.on('message', (msg: IpcMessage) => this.emit('message', msg));
    client.on('error', (err: Error) => this.emit('error', err));
    client.on('disconnect', () => this.emit('disconnect'));
    await client.connect(socketPath);
  }

  private killExisting(): void {
    if (this.childProcess) {
      this.childProcess.kill();
      this.childProcess = null;
    }
    if (this.ipcClient) {
      this.ipcClient.disconnect();
      this.ipcClient = null;
    }
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
