import * as net from 'net';
import { EventEmitter } from 'events';

export type IpcMessage = Record<string, unknown>;

export interface IIpcClient {
  connect(socketPath: string): Promise<void>;
  send(msg: IpcMessage): void;
  disconnect(): void;
  on(event: 'message', listener: (msg: IpcMessage) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: 'disconnect', listener: () => void): this;
}

const IPC_MAX_BUFFER = 1 << 20;  // 1 MB receive buffer ceiling

export class IpcClient extends EventEmitter implements IIpcClient {
  private socket: net.Socket | null = null;
  private partial = '';

  connect(socketPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = new net.Socket();
      this.socket = sock;

      sock.once('connect', () => {
        sock.on('data', (data: Buffer) => this.onData(data));
        sock.on('error', (err: Error) => this.emit('error', err));
        sock.on('close', () => {
          this.socket = null;
          this.partial = '';
          this.emit('disconnect');
        });
        resolve();
      });

      sock.once('error', reject);
      sock.connect({ path: socketPath });
    });
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
      try {
        const msg = JSON.parse(line) as IpcMessage;
        this.emit('message', msg);
      } catch {
        // ignore malformed lines
      }
    }
  }
}
