import * as fs from 'fs';
import * as https from 'https';

// FR-WIN-TCH-4: a streaming HTTPS download to a file. HTTPS only — including every
// redirect (GitHub release assets redirect to a CDN) — progress as it goes, and a
// partial file never left behind. Nothing here verifies the content: the caller
// checks the pinned SHA-256 before anything is extracted or executed.

export type HttpGet = typeof https.get;

/** Structurally compatible with vscode.CancellationToken (FR-EXT-16). */
export interface CancelToken {
  readonly isCancellationRequested: boolean;
  onCancellationRequested(listener: () => void): { dispose(): void };
}

export type DownloadProgress = (receivedBytes: number, totalBytes: number | undefined) => void;

export interface DownloadDeps {
  get?: HttpGet;
  createWriteStream?: typeof fs.createWriteStream;
}

const MAX_REDIRECTS = 5;
const USER_AGENT = 'ds-ide-toolchain-installer';

function assertHttps(url: string): void {
  if (!url.startsWith('https://')) throw new Error(`refusing to download from a non-https URL: ${url}`);
}

const cancelled = (): Error => new Error('download cancelled');

interface Response {
  statusCode?: number;
  headers: Record<string, string | string[] | undefined>;
  resume(): void;
  pipe<T extends NodeJS.WritableStream>(dest: T): T;
  on(event: string, listener: (...args: never[]) => void): unknown;
}
interface Request { destroy(): void; on(event: 'error', listener: (err: Error) => void): unknown }

function request(get: HttpGet, url: string, token?: CancelToken): Promise<{ req: Request; res: Response }> {
  return new Promise((resolve, reject) => {
    const sub = token?.onCancellationRequested(() => { req.destroy(); reject(cancelled()); });
    const req = get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
      sub?.dispose();
      resolve({ req: req as unknown as Request, res: res as unknown as Response });
    }) as unknown as Request;
    req.on('error', (err) => { sub?.dispose(); reject(err); });
  });
}

function pipeToFile(
  res: Response, req: Request, dest: string, onProgress: DownloadProgress,
  create: typeof fs.createWriteStream, token?: CancelToken,
): Promise<void> {
  const header = res.headers['content-length'];
  const total = typeof header === 'string' && Number(header) > 0 ? Number(header) : undefined;
  let received = 0;
  const out = create(dest);
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const sub = token?.onCancellationRequested(() => { req.destroy(); out.destroy(); finish(cancelled()); });
    function finish(err?: Error): void {
      if (settled) return;
      settled = true;
      sub?.dispose();
      if (err) { out.destroy(); reject(err); } else { resolve(); }
    }
    res.on('data', ((chunk: Buffer) => { received += chunk.length; onProgress(received, total); }) as (...a: never[]) => void);
    res.on('error', ((err: Error) => finish(err)) as (...a: never[]) => void);
    out.on('error', (err) => finish(err));
    out.on('finish', () => {
      if (total !== undefined && received < total) {
        finish(Object.assign(new Error(`incomplete download: got ${received} of ${total} bytes`), { code: 'ECONNRESET' }));
      } else {
        finish();
      }
    });
    res.pipe(out);
  });
}

/**
 * Downloads `url` to `dest`. Rejects with the network error (its `code` kept, e.g.
 * ENOTFOUND, ECONNRESET, ENOSPC), or with an error carrying the HTTP `status`.
 */
export async function httpsDownload(
  url: string,
  dest: string,
  onProgress: DownloadProgress,
  token?: CancelToken,
  deps: DownloadDeps = {},
): Promise<void> {
  const get = deps.get ?? https.get;
  const create = deps.createWriteStream ?? fs.createWriteStream;
  assertHttps(url);

  let current = url;
  for (let hops = 0; ; hops++) {
    if (hops > MAX_REDIRECTS) throw new Error(`too many redirects downloading ${url}`);
    if (token?.isCancellationRequested) throw cancelled();
    const { req, res } = await request(get, current, token);
    const status = res.statusCode ?? 0;
    const location = res.headers['location'];
    if (status >= 300 && status < 400 && typeof location === 'string') {
      res.resume();
      current = new URL(location, current).toString();
      assertHttps(current);
      continue;
    }
    if (status !== 200) {
      res.resume();
      throw Object.assign(new Error(`HTTP ${status} for ${current}`), { status });
    }
    try {
      await pipeToFile(res, req, dest, onProgress, create, token);
    } catch (err) {
      await fs.promises.rm(dest, { force: true });
      throw err;
    }
    return;
  }
}
