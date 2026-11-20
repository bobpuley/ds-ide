import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { PassThrough, Writable } from 'stream';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { httpsDownload, type HttpGet } from '../../../toolchain/download';

// FR-WIN-TCH-4: the streaming HTTPS download. The transport is injected, so
// redirects, error statuses, cut connections and cancellation are all provoked
// without a network.

let dir: string;
let dest: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-ide-dl-')); dest = path.join(dir, 'out.zip'); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

interface Reply { status?: number; headers?: Record<string, string>; chunks?: Buffer[]; hold?: boolean; error?: NodeJS.ErrnoException }

/** A fake https.get: `replies[url]` decides what each URL answers. */
function fakeGet(replies: Record<string, Reply>): { get: HttpGet; requested: string[]; requests: Array<{ destroy: ReturnType<typeof vi.fn> }> } {
  const requested: string[] = [];
  const requests: Array<{ destroy: ReturnType<typeof vi.fn> }> = [];
  const get = ((url: string, _opts: unknown, cb: (res: unknown) => void) => {
    requested.push(url);
    const req = Object.assign(new EventEmitter(), { destroy: vi.fn() });
    requests.push(req);
    const reply = replies[url] ?? { status: 404 };
    process.nextTick(() => {
      if (reply.error) { req.emit('error', reply.error); return; }
      const res = Object.assign(new PassThrough(), {
        statusCode: reply.status ?? 200,
        headers: reply.headers ?? {},
      });
      cb(res);
      if (reply.hold) { res.write(reply.chunks?.[0] ?? Buffer.alloc(0)); return; }
      for (const c of reply.chunks ?? []) res.write(c);
      res.end();
    });
    return req;
  }) as unknown as HttpGet;
  return { get, requested, requests };
}

const noop = (): void => undefined;

describe('httpsDownload()', () => {
  it('streams the body to the destination file', async () => {
    const { get } = fakeGet({ 'https://a.example/x.zip': { chunks: [Buffer.from('hello '), Buffer.from('world')], headers: { 'content-length': '11' } } });
    await httpsDownload('https://a.example/x.zip', dest, noop, undefined, { get });
    expect(fs.readFileSync(dest, 'utf8')).toBe('hello world');
  });

  it('reports progress against the declared length', async () => {
    const { get } = fakeGet({ 'https://a.example/x.zip': { chunks: [Buffer.from('abc'), Buffer.from('defg')], headers: { 'content-length': '7' } } });
    const seen: Array<[number, number | undefined]> = [];
    await httpsDownload('https://a.example/x.zip', dest, (r, t) => seen.push([r, t]), undefined, { get });
    expect(seen.at(-1)).toEqual([7, 7]);
    expect(seen.every(([, t]) => t === 7)).toBe(true);
  });

  it('reports an unknown total when the server does not say', async () => {
    const { get } = fakeGet({ 'https://a.example/x.zip': { chunks: [Buffer.from('abc')] } });
    const seen: Array<[number, number | undefined]> = [];
    await httpsDownload('https://a.example/x.zip', dest, (r, t) => seen.push([r, t]), undefined, { get });
    expect(seen.at(-1)).toEqual([3, undefined]);
  });

  it('follows redirects (GitHub release assets redirect to a CDN), absolute and relative', async () => {
    const { get, requested } = fakeGet({
      'https://github.example/a.zip': { status: 302, headers: { location: 'https://cdn.example/path/a.zip?sig=1' } },
      'https://cdn.example/path/a.zip?sig=1': { status: 301, headers: { location: '/real/a.zip' } },
      'https://cdn.example/real/a.zip': { chunks: [Buffer.from('payload')] },
    });
    await httpsDownload('https://github.example/a.zip', dest, noop, undefined, { get });
    expect(fs.readFileSync(dest, 'utf8')).toBe('payload');
    expect(requested).toEqual(['https://github.example/a.zip', 'https://cdn.example/path/a.zip?sig=1', 'https://cdn.example/real/a.zip']);
  });

  it('refuses a redirect to plain HTTP', async () => {
    const { get, requested } = fakeGet({
      'https://a.example/x.zip': { status: 302, headers: { location: 'http://evil.example/x.zip' } },
    });
    await expect(httpsDownload('https://a.example/x.zip', dest, noop, undefined, { get })).rejects.toThrow(/https/i);
    expect(requested).toEqual(['https://a.example/x.zip']);
    expect(fs.existsSync(dest)).toBe(false);
  });

  it('refuses a plain HTTP URL outright', async () => {
    const { get, requested } = fakeGet({});
    await expect(httpsDownload('http://a.example/x.zip', dest, noop, undefined, { get })).rejects.toThrow(/https/i);
    expect(requested).toEqual([]);
  });

  it('gives up after too many redirects', async () => {
    const replies: Record<string, Reply> = {};
    for (let i = 0; i < 20; i++) replies[`https://a.example/${i}`] = { status: 302, headers: { location: `https://a.example/${i + 1}` } };
    const { get } = fakeGet(replies);
    await expect(httpsDownload('https://a.example/0', dest, noop, undefined, { get })).rejects.toThrow(/redirect/i);
  });

  it('rejects an HTTP error status, carrying the status', async () => {
    const { get } = fakeGet({ 'https://a.example/x.zip': { status: 404 } });
    const err = await httpsDownload('https://a.example/x.zip', dest, noop, undefined, { get }).catch((e: unknown) => e);
    expect((err as { status?: number }).status).toBe(404);
    expect(fs.existsSync(dest)).toBe(false);
  });

  it('rejects with the network error code (so the caller can tell "offline")', async () => {
    const error = Object.assign(new Error('getaddrinfo ENOTFOUND a.example'), { code: 'ENOTFOUND' });
    const { get } = fakeGet({ 'https://a.example/x.zip': { error } });
    const err = await httpsDownload('https://a.example/x.zip', dest, noop, undefined, { get }).catch((e: unknown) => e);
    expect((err as NodeJS.ErrnoException).code).toBe('ENOTFOUND');
  });

  it('rejects a body shorter than the declared length and removes the partial file', async () => {
    const { get } = fakeGet({ 'https://a.example/x.zip': { chunks: [Buffer.from('abc')], headers: { 'content-length': '10' } } });
    await expect(httpsDownload('https://a.example/x.zip', dest, noop, undefined, { get })).rejects.toThrow(/incomplete|truncated|short/i);
    expect(fs.existsSync(dest)).toBe(false);
  });

  it('keeps the disk-full error code when writing fails', async () => {
    const { get } = fakeGet({ 'https://a.example/x.zip': { chunks: [Buffer.from('abc'), Buffer.from('def')] } });
    const createWriteStream = (() => new Writable({
      write(_chunk, _enc, cb) { cb(Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' })); },
    })) as unknown as typeof fs.createWriteStream;
    const err = await httpsDownload('https://a.example/x.zip', dest, noop, undefined, { get, createWriteStream }).catch((e: unknown) => e);
    expect((err as NodeJS.ErrnoException).code).toBe('ENOSPC');
  });

  it('aborts the request and removes the partial file when cancelled', async () => {
    const { get, requests } = fakeGet({ 'https://a.example/x.zip': { chunks: [Buffer.from('abc')], hold: true, headers: { 'content-length': '100' } } });
    let fire: () => void = noop;
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: (cb: () => void) => { fire = () => { token.isCancellationRequested = true; cb(); }; return { dispose: noop }; },
    };
    const p = httpsDownload('https://a.example/x.zip', dest, noop, token, { get });
    await new Promise((r) => setTimeout(r, 20));
    fire();
    await expect(p).rejects.toThrow(/cancel/i);
    expect(requests[0]!.destroy).toHaveBeenCalled();
    expect(fs.existsSync(dest)).toBe(false);
  });
});
