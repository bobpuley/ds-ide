import * as net from 'net';
import { EventEmitter } from 'events';
import { parseIpcMessage, IpcMessage } from '../ipc/narrow';

export type { IpcMessage };

export interface IpcWarning {
  message: string;
  /** Running count of this warning category since the client was constructed. */
  count: number;
}

export interface IIpcClient {
  connect(socketPath: string): Promise<void>;
  send(msg: IpcMessage): void;
  disconnect(): void;
  on(event: 'message', listener: (msg: IpcMessage) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: 'disconnect', listener: () => void): this;
  on(event: 'warning', listener: (warning: IpcWarning) => void): this;
}

const IPC_MAX_BUFFER = 1 << 20;  // 1 MB receive buffer ceiling
// A wedged emulator can announce its socket path but never accept the
// connection; without its own deadline here, connect() would hang forever
// and wedge the deploy lock along with it (FR-IPC-1). Exported so
// EmulatorManager's protocol-version handshake (FR-DEV-6) can reuse the same
// connect-phase budget rather than introducing a second timeout constant.
export const CONNECT_TIMEOUT_MS = 5_000;

export class IpcClient extends EventEmitter implements IIpcClient {
  private socket: net.Socket | null = null;
  private partial = '';
  private droppedSendCount = 0;
  private malformedLineCount = 0;

  private warn(message: string, count: number): void {
    console.warn(`ds-ide: ${message}`);
    this.emit('warning', { message, count } satisfies IpcWarning);
  }

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
    if (!this.socket || this.socket.destroyed) {
      this.droppedSendCount++;
      this.warn('dropped IPC send — socket not connected', this.droppedSendCount);
      return;
    }
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
      // Resynchronize to the next newline rather than discarding the whole
      // buffer — a valid message can arrive in the same chunk right after
      // the garbage that caused the overflow.
      const nlIndex = this.partial.indexOf('\n');
      this.partial = nlIndex === -1 ? '' : this.partial.slice(nlIndex + 1);
      this.emit('error', new Error('IPC receive buffer overflow: message exceeds 1 MB'));
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
        this.malformedLineCount++;
        this.warn(`dropped malformed IPC line (invalid JSON): ${line.slice(0, 200)}`, this.malformedLineCount);
        continue;
      }
      const msg = parseIpcMessage(parsed);
      if (msg) {
        this.emit('message', msg);
      } else {
        this.malformedLineCount++;
        this.warn(`dropped IPC message failing schema validation: ${line.slice(0, 200)}`, this.malformedLineCount);
      }
    }
  }
}
