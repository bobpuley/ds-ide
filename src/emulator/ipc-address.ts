// FR-WIN-IPC-1: where the emulator's IPC server listens, as announced on its
// stdout by `DAISY_EMU_SOCKET:<value>` — a Unix domain socket path (macOS) or
// "127.0.0.1:<port>" (TCP loopback; the only transport on Windows).
export type IpcAddress =
  | { kind: 'unix'; path: string }
  | { kind: 'tcp'; host: string; port: number };

const TCP_ANNOUNCE = /^(\d{1,3}(?:\.\d{1,3}){3}):(\d*)$/;
const LOOPBACK_HOST = '127.0.0.1';

function malformed(value: string, why: string): Error {
  return new Error(`Malformed emulator announce "DAISY_EMU_SOCKET:${value}": ${why}`);
}

export function parseAnnounce(raw: string, platform: NodeJS.Platform): IpcAddress {
  const value = raw.trim();
  if (!value) throw malformed(value, 'empty address');

  const tcp = TCP_ANNOUNCE.exec(value);
  if (tcp) {
    const host = tcp[1]!;
    const portText = tcp[2]!;
    // The emulator binds loopback only; anything else is not ours to trust.
    if (host !== LOOPBACK_HOST) throw malformed(value, `TCP host must be loopback (${LOOPBACK_HOST})`);
    const port = /^\d{1,5}$/.test(portText) ? Number(portText) : NaN;
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw malformed(value, 'invalid TCP port');
    return { kind: 'tcp', host, port };
  }
  if (/^[^:/\\\s]+:\d+$/.test(value)) {
    // host:port-shaped but not a dotted-quad loopback address.
    throw malformed(value, `TCP host must be loopback (${LOOPBACK_HOST})`);
  }
  if (platform === 'win32') throw malformed(value, 'Windows uses the TCP transport only');
  return { kind: 'unix', path: value };
}

export function formatIpcAddress(address: IpcAddress): string {
  return address.kind === 'unix' ? address.path : `${address.host}:${address.port}`;
}
