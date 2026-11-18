import { describe, it, expect } from 'vitest';
import { parseAnnounce, formatIpcAddress } from '../../../emulator/ipc-address';

// FR-WIN-IPC-1: the DAISY_EMU_SOCKET:<value> announce is a Unix socket path
// (macOS) or "127.0.0.1:<port>" (TCP loopback, Windows).
describe('parseAnnounce (FR-WIN-IPC-1)', () => {
  it('parses a Unix socket path on macOS', () => {
    expect(parseAnnounce('/tmp/ds-ide-abc/emu-1234.sock', 'darwin'))
      .toEqual({ kind: 'unix', path: '/tmp/ds-ide-abc/emu-1234.sock' });
  });

  it('parses a TCP loopback host:port', () => {
    expect(parseAnnounce('127.0.0.1:50123', 'win32')).toEqual({ kind: 'tcp', host: '127.0.0.1', port: 50123 });
  });

  it('accepts a TCP announce on macOS too (effect_emu --tcp)', () => {
    expect(parseAnnounce('127.0.0.1:1', 'darwin')).toEqual({ kind: 'tcp', host: '127.0.0.1', port: 1 });
  });

  it('trims surrounding whitespace (CRLF from a Windows stdout)', () => {
    expect(parseAnnounce('127.0.0.1:50123\r', 'win32')).toEqual({ kind: 'tcp', host: '127.0.0.1', port: 50123 });
  });

  it.each(['127.0.0.1:0', '127.0.0.1:65536', '127.0.0.1:', '127.0.0.1:12ab'])(
    'rejects an out-of-range or non-numeric port: %s', (value) => {
      expect(() => parseAnnounce(value, 'win32')).toThrow(/malformed emulator announce/i);
    });

  it('rejects a non-loopback TCP host — the emulator only ever binds loopback', () => {
    expect(() => parseAnnounce('192.168.1.10:5000', 'win32')).toThrow(/loopback/i);
    expect(() => parseAnnounce('0.0.0.0:5000', 'darwin')).toThrow(/loopback/i);
  });

  it('keeps a Unix path that happens to contain a colon', () => {
    expect(parseAnnounce('/tmp/a:b.sock', 'darwin')).toEqual({ kind: 'unix', path: '/tmp/a:b.sock' });
  });

  it('rejects a named non-loopback host:port', () => {
    expect(() => parseAnnounce('localhost:5000', 'darwin')).toThrow(/loopback/i);
  });

  it('rejects an empty announce', () => {
    expect(() => parseAnnounce('', 'darwin')).toThrow(/malformed emulator announce/i);
    expect(() => parseAnnounce('   ', 'win32')).toThrow(/malformed emulator announce/i);
  });

  it('rejects a socket path on Windows, which has no Unix-socket transport', () => {
    expect(() => parseAnnounce('C:\\Temp\\emu.sock', 'win32')).toThrow(/malformed emulator announce/i);
  });
});

describe('formatIpcAddress', () => {
  it('formats both kinds for messages', () => {
    expect(formatIpcAddress({ kind: 'unix', path: '/tmp/x.sock' })).toBe('/tmp/x.sock');
    expect(formatIpcAddress({ kind: 'tcp', host: '127.0.0.1', port: 4242 })).toBe('127.0.0.1:4242');
  });
});
