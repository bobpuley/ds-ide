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
  stub.connect  = vi.fn((_opts: unknown, _cb?: () => void) => stub) as ReturnType<typeof vi.fn>;
  stub.write    = vi.fn((_data: string) => true) as ReturnType<typeof vi.fn>;
  stub.destroy  = vi.fn(() => { stub.destroyed = true; }) as ReturnType<typeof vi.fn>;
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

  it('emits a counted warning when send is dropped because the socket is absent (FR-QA-EXT-2)', () => {
    const client = new IpcClient();
    const warnings: Array<{ message: string; count: number }> = [];
    client.on('warning', (w) => warnings.push(w));

    client.send({ type: 'test' });
    client.send({ type: 'test' });

    expect(warnings).toHaveLength(2);
    expect(warnings[0]!.count).toBe(1);
    expect(warnings[1]!.count).toBe(2);
    expect(warnings[0]!.message).toMatch(/dropped/i);
  });

  it('emits a counted warning when send is dropped because the socket is destroyed (FR-QA-EXT-2)', async () => {
    const client = new IpcClient();
    const promise = client.connect('/tmp/test.sock');
    socketStub.emit('connect');
    await promise;
    socketStub.destroyed = true;

    const warnings: Array<{ message: string; count: number }> = [];
    client.on('warning', (w) => warnings.push(w));
    client.send({ type: 'test' });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.count).toBe(1);
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

    socketStub.emit('data', Buffer.from('{"type":"xru'));
    expect(messages).toHaveLength(0);
    socketStub.emit('data', Buffer.from('n","count":2}\n'));
    expect(messages).toEqual([{ type: 'xrun', count: 2 }]);
  });

  it('handles multiple messages in one data chunk', async () => {
    const client = new IpcClient();
    const promise = client.connect('/tmp/test.sock');
    socketStub.emit('connect');
    await promise;

    const messages: unknown[] = [];
    client.on('message', (m) => messages.push(m));

    socketStub.emit('data', Buffer.from('{"type":"status","running":true}\n{"type":"xrun","count":1}\n'));
    expect(messages).toEqual([{ type: 'status', running: true }, { type: 'xrun', count: 1 }]);
  });

  it('skips malformed JSON without throwing', async () => {
    const client = new IpcClient();
    const promise = client.connect('/tmp/test.sock');
    socketStub.emit('connect');
    await promise;

    const messages: unknown[] = [];
    client.on('message', (m) => messages.push(m));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    socketStub.emit('data', Buffer.from('not json\n{"type":"replayDone"}\n'));
    expect(messages).toEqual([{ type: 'replayDone' }]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/malformed IPC line/));
    warnSpy.mockRestore();
  });

  it('emits a counted warning event for malformed JSON lines (FR-QA-EXT-2)', async () => {
    const client = new IpcClient();
    const promise = client.connect('/tmp/test.sock');
    socketStub.emit('connect');
    await promise;

    const warnings: Array<{ message: string; count: number }> = [];
    client.on('warning', (w) => warnings.push(w));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    socketStub.emit('data', Buffer.from('not json\nalso not json\n'));

    expect(warnings).toHaveLength(2);
    expect(warnings[0]!.count).toBe(1);
    expect(warnings[1]!.count).toBe(2);
    warnSpy.mockRestore();
  });

  it('drops a well-formed JSON message that fails schema validation (FR-IPC-2)', async () => {
    const client = new IpcClient();
    const promise = client.connect('/tmp/test.sock');
    socketStub.emit('connect');
    await promise;

    const messages: unknown[] = [];
    client.on('message', (m) => messages.push(m));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    // Unknown type
    socketStub.emit('data', Buffer.from('{"type":"unknownEvilType","payload":"<script>x</script>"}\n'));
    // Known type, wrong field shape
    socketStub.emit('data', Buffer.from('{"type":"status","running":"not-a-boolean"}\n'));

    expect(messages).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/schema validation/));
    warnSpy.mockRestore();
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

  describe('connected (FR-UX-2)', () => {
    it('is false before connecting', () => {
      const client = new IpcClient();
      expect(client.connected).toBe(false);
    });

    it('is true once connected', async () => {
      const client = new IpcClient();
      const promise = client.connect('/tmp/test.sock');
      socketStub.emit('connect');
      await promise;
      expect(client.connected).toBe(true);
    });

    it('is false after an unexpected socket close', async () => {
      const client = new IpcClient();
      const promise = client.connect('/tmp/test.sock');
      socketStub.emit('connect');
      await promise;
      socketStub.emit('close');
      expect(client.connected).toBe(false);
    });

    it('is false after explicit disconnect()', async () => {
      const client = new IpcClient();
      const promise = client.connect('/tmp/test.sock');
      socketStub.emit('connect');
      await promise;
      client.disconnect();
      expect(client.connected).toBe(false);
    });
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
    socketStub.emit('data', Buffer.from('{"type":"replayDone"}\n'));
    expect(messages).toEqual([{ type: 'replayDone' }]);
  });

  it('resynchronizes to the next newline on overflow instead of discarding a trailing valid message (FR-QA-EXT-2)', async () => {
    const client = new IpcClient();
    const promise = client.connect('/tmp/test.sock');
    socketStub.emit('connect');
    await promise;

    const errors: Error[] = [];
    client.on('error', (e) => errors.push(e));
    const messages: unknown[] = [];
    client.on('message', (m) => messages.push(m));

    // Garbage well past the 1 MB ceiling, followed by a newline and a valid message
    // in the *same* chunk — the valid tail must survive the overflow reset.
    const garbage = Buffer.alloc((1 << 20) + 1, 0x41);
    const tail = Buffer.from('\n{"type":"replayDone"}\n');
    socketStub.emit('data', Buffer.concat([garbage, tail]));

    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toMatch(/overflow/i);
    expect(messages).toEqual([{ type: 'replayDone' }]);
  });
});
