import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { IpcClient } from '../../../emulator/ipc-client';
import * as net from 'net';

// --- Minimal net.Socket stub ---

function makeSocketStub() {
  const stub = new EventEmitter() as EventEmitter & {
    connect: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    destroyed: boolean;
  };
  stub.connect  = vi.fn((_opts: unknown, _cb?: () => void) => stub);
  stub.write    = vi.fn((_data: string) => true);
  stub.destroy  = vi.fn(() => { stub.destroyed = true; });
  stub.destroyed = false;
  return stub;
}

vi.mock('net', () => ({
  Socket: vi.fn(),
}));

describe('IpcClient', () => {
  let socketStub: ReturnType<typeof makeSocketStub>;

  beforeEach(() => {
    socketStub = makeSocketStub();
    vi.mocked(net.Socket).mockImplementation(() => socketStub as unknown as net.Socket);
  });

  it('connect resolves when socket emits connect', async () => {
    const client = new IpcClient();
    const promise = client.connect('/tmp/test.sock');
    socketStub.emit('connect');
    await expect(promise).resolves.toBeUndefined();
  });

  it('connect rejects when socket emits error before connect', async () => {
    const client = new IpcClient();
    const promise = client.connect('/tmp/test.sock');
    socketStub.emit('error', new Error('ENOENT'));
    await expect(promise).rejects.toThrow('ENOENT');
  });

  it('connect rejects within a bounded time when the socket never connects or errors (FR-IPC-1)', async () => {
    vi.useFakeTimers();
    try {
      const client = new IpcClient();
      const promise = client.connect('/tmp/test.sock', 5_000);
      const assertion = expect(promise).rejects.toThrow(/timed out/i);
      await vi.advanceTimersByTimeAsync(5_000);
      await assertion;
      expect(socketStub.destroy).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('connect does not reject from a stale timeout after connecting successfully', async () => {
    vi.useFakeTimers();
    try {
      const client = new IpcClient();
      const promise = client.connect('/tmp/test.sock', 5_000);
      socketStub.emit('connect');
      await promise;
      await vi.advanceTimersByTimeAsync(5_000);
      // no throw — the connect timer must have been cleared on success
    } finally {
      vi.useRealTimers();
    }
  });

  it('send writes JSON + newline to socket', async () => {
    const client = new IpcClient();
    const promise = client.connect('/tmp/test.sock');
    socketStub.emit('connect');
    await promise;

    client.send({ type: 'transport', action: 'start' });
    expect(socketStub.write).toHaveBeenCalledWith(
      JSON.stringify({ type: 'transport', action: 'start' }) + '\n',
    );
  });

  it('send is a no-op when not connected', () => {
    const client = new IpcClient();
    expect(() => client.send({ type: 'test' })).not.toThrow();
  });

  it('emits message for each complete JSON line received', async () => {
    const client = new IpcClient();
    const promise = client.connect('/tmp/test.sock');
    socketStub.emit('connect');
    await promise;

    const messages: unknown[] = [];
    client.on('message', (m) => messages.push(m));

    socketStub.emit('data', Buffer.from('{"type":"status","running":true}\n'));
    expect(messages).toEqual([{ type: 'status', running: true }]);
  });

  it('buffers partial lines and emits when newline arrives', async () => {
    const client = new IpcClient();
    const promise = client.connect('/tmp/test.sock');
    socketStub.emit('connect');
    await promise;

    const messages: unknown[] = [];
    client.on('message', (m) => messages.push(m));

    socketStub.emit('data', Buffer.from('{"type":"sco'));
    expect(messages).toHaveLength(0);
    socketStub.emit('data', Buffer.from('pe"}\n'));
    expect(messages).toEqual([{ type: 'scope' }]);
  });

  it('handles multiple messages in one data chunk', async () => {
    const client = new IpcClient();
    const promise = client.connect('/tmp/test.sock');
    socketStub.emit('connect');
    await promise;

    const messages: unknown[] = [];
    client.on('message', (m) => messages.push(m));

    socketStub.emit('data', Buffer.from('{"type":"a"}\n{"type":"b"}\n'));
    expect(messages).toEqual([{ type: 'a' }, { type: 'b' }]);
  });

  it('skips malformed JSON without throwing', async () => {
    const client = new IpcClient();
    const promise = client.connect('/tmp/test.sock');
    socketStub.emit('connect');
    await promise;

    const messages: unknown[] = [];
    client.on('message', (m) => messages.push(m));

    socketStub.emit('data', Buffer.from('not json\n{"type":"ok"}\n'));
    expect(messages).toEqual([{ type: 'ok' }]);
  });

  it('emits disconnect when socket closes', async () => {
    const client = new IpcClient();
    const promise = client.connect('/tmp/test.sock');
    socketStub.emit('connect');
    await promise;

    const disconnected = vi.fn();
    client.on('disconnect', disconnected);
    socketStub.emit('close');
    expect(disconnected).toHaveBeenCalledOnce();
  });

  it('disconnect destroys socket', async () => {
    const client = new IpcClient();
    const promise = client.connect('/tmp/test.sock');
    socketStub.emit('connect');
    await promise;

    client.disconnect();
    expect(socketStub.destroy).toHaveBeenCalledOnce();
  });

  it('emits error and clears partial when buffer exceeds 1 MB (FR-EQ-1)', async () => {
    const client = new IpcClient();
    const promise = client.connect('/tmp/test.sock');
    socketStub.emit('connect');
    await promise;

    const errors: Error[] = [];
    client.on('error', (e) => errors.push(e));

    // Feed slightly over 1 MB of data with no newline
    const chunk = Buffer.alloc((1 << 20) + 1, 0x41); // 1 MB + 1 byte of 'A'
    socketStub.emit('data', chunk);

    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toMatch(/overflow/i);
    // Verify internal buffer is cleared by sending a valid message after the overflow
    const messages: unknown[] = [];
    client.on('message', (m) => messages.push(m));
    socketStub.emit('data', Buffer.from('{"type":"ok"}\n'));
    expect(messages).toEqual([{ type: 'ok' }]);
  });
});
