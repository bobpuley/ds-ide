import * as assert from 'assert';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { IpcClient, IpcMessage } from '../../emulator/ipc-client';

// Exercises the real IpcClient against a real Unix domain socket (a
// realistically faked emulator: it speaks the same newline-delimited JSON
// framing the real effect_emu process does, without needing the actual
// binary). This is the same code path that dropped MIDI messages in M62 —
// IpcClient.onData() -> parseIpcMessage() in src/ipc/narrow.ts — exercised
// here against the real narrower, not a mock (FR-TEST-2).
suite('IPC round-trip: real socket, real schema narrower', () => {
  let socketPath: string;
  let server: net.Server;

  setup(async () => {
    socketPath = path.join(os.tmpdir(), `ds-ide-e2e-ipc-${process.pid}-${Date.now()}.sock`);
    await fs.promises.rm(socketPath, { force: true });
    server = net.createServer();
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  });

  teardown(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.promises.rm(socketPath, { force: true });
  });

  test('a midiRx line survives parseIpcMessage() and is emitted as a message event', async () => {
    const sentPayload = { type: 'midiRx', status: 144, data1: 60, data2: 100, channel: 0, midiType: 9 };
    server.on('connection', (conn) => {
      conn.write(JSON.stringify(sentPayload) + '\n');
    });

    const client = new IpcClient();
    try {
      await client.connect(socketPath);

      const received = await new Promise<IpcMessage>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timed out waiting for midiRx message')), 5000);
        client.on('message', (msg) => {
          clearTimeout(timer);
          resolve(msg);
        });
      });

      assert.deepStrictEqual(received, sentPayload);
    } finally {
      client.disconnect();
    }
  });
});
