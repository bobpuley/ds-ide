import * as assert from 'assert';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { IpcClient, IpcMessage } from '../../emulator/ipc-client';
import type { IpcAddress } from '../../emulator/ipc-address';

// Exercises the real IpcClient against a real socket (a realistically faked
// emulator: it speaks the same newline-delimited JSON framing the real effect_emu
// process does, without needing the actual binary). The transport is the one the
// platform uses: a Unix domain socket on macOS, TCP loopback on Windows
// (FR-WIN-IPC-1). This is the same code path that dropped MIDI messages in M62 —
// IpcClient.onData() -> parseIpcMessage() in src/ipc/narrow.ts — exercised
// here against the real narrower, not a mock (FR-TEST-2).
suite('IPC round-trip: real socket, real schema narrower', () => {
  const useTcp = process.platform === 'win32';
  let socketPath: string;
  let address: IpcAddress;
  let server: net.Server;

  setup(async () => {
    socketPath = path.join(os.tmpdir(), `ds-ide-e2e-ipc-${process.pid}-${Date.now()}.sock`);
    server = net.createServer();
    if (useTcp) {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      address = { kind: 'tcp', host: '127.0.0.1', port: (server.address() as net.AddressInfo).port };
    } else {
      await fs.promises.rm(socketPath, { force: true });
      await new Promise<void>((resolve) => server.listen(socketPath, resolve));
      address = { kind: 'unix', path: socketPath };
    }
  });

  teardown(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (!useTcp) await fs.promises.rm(socketPath, { force: true });
  });

  test('a midiRx line survives parseIpcMessage() and is emitted as a message event', async () => {
    const sentPayload = { type: 'midiRx', status: 144, data1: 60, data2: 100, channel: 0, midiType: 9 };
    const sessionToken = 'e2e-session-token';
    server.on('connection', (conn) => {
      if (!useTcp) {
        conn.write(JSON.stringify(sentPayload) + '\n');
        return;
      }
      // On TCP the first line from the client is the session hello (FR-WIN-IPC-2);
      // like the real emulator, answer only once it carries the right token.
      let buffered = '';
      let greeted = false;
      conn.on('data', (chunk) => {
        if (greeted) return;
        buffered += chunk.toString('utf8');
        const end = buffered.indexOf('\n');
        if (end === -1) return;
        greeted = true;
        const hello = JSON.parse(buffered.slice(0, end)) as { type?: string; token?: string };
        if (hello.type === 'hello' && hello.token === sessionToken) conn.write(JSON.stringify(sentPayload) + '\n');
        else conn.destroy();
      });
    });

    const client = new IpcClient();
    try {
      await client.connect(address, undefined, useTcp ? sessionToken : undefined);

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
