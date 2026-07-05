import * as net from 'net';
import { EventEmitter } from 'events';
import { parseIpcMessage, IpcMessage } from '../ipc/narrow';

export type { IpcMessage };

export interface IIpcClient {
  connect(socketPath: string): Promise<void>;
  send(msg: IpcMessage): void;
  disconnect(): void;
  on(event: 'message', listener: (msg: IpcMessage) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: 'disconnect', listener: () => void): this;
}

const IPC_MAX_BUFFER = 1 << 20;  // 1 MB receive buffer ceiling
// A wedged emulator can announce its socket path but never accept the
// connection; without its own deadline here, connect() would hang forever
// and wedge the deploy lock along with it (FR-IPC-1).
const CONNECT_TIMEOUT_MS = 5_000;

export class IpcClient extends EventEmitter implements IIpcClient {
  private socket: net.Socket | null = null;
  private partial = '';

  connect(socketPath: string, timeoutMs = CONNECT_TIMEOUT_MS): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = new net.Socket();
      this.socket = sock;
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        sock.destroy();
        if (this.socket === sock) this.socket = null;
        reject(new Error(`IPC connect to ${socketPath} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      sock.once('connect', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        sock.on('data', (data: Buffer) => this.onData(data));
        sock.on('error', (err: Error) => this.emit('error', err));
        sock.on('close', () => {
          this.socket = null;
          this.partial = '';
          this.emit('disconnect');
        });
        resolve();
      });

      sock.once('error', (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
      sock.connect({ path: socketPath });
    });
  }

  get connected(): boolean {
    return this.socket !== null && !this.socket.destroyed;
  }

  send(msg: IpcMessage): void {
    if (!this.socket || this.socket.destroyed) return;
    this.socket.write(JSON.stringify(msg) + '\n');
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.partial = '';
  }

  private onData(data: Buffer): void {
    this.partial += data.toString('utf8');
    if (this.partial.length > IPC_MAX_BUFFER) {
      this.partial = '';
      this.emit('error', new Error('IPC receive buffer overflow: message exceeds 1 MB'));
      return;
    }
    let nl: number;
    while ((nl = this.partial.indexOf('\n')) !== -1) {
      const line = this.partial.slice(0, nl).trim();
      this.partial = this.partial.slice(nl + 1);
      if (!line) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        console.warn(`ds-ide: dropped malformed IPC line (invalid JSON): ${line.slice(0, 200)}`);
        continue;
      }
      const msg = parseIpcMessage(parsed);
      if (msg) {
        this.emit('message', msg);
      } else {
        console.warn(`ds-ide: dropped IPC message failing schema validation: ${line.slice(0, 200)}`);
      }
    }
  }
}
