import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { httpsDownload, type CancelToken, type DownloadProgress } from './download';
import { tarExtract } from './extract';
import { archiveFileName, resolveArchiveRoot, type ToolchainComponent, type ToolchainManifest } from './manifest';

// FR-WIN-TCH-4: downloads, verifies and installs the pinned Windows toolchain
// (llvm-mingw, CMake, Ninja) into the extension's own storage.
//
//   <storage>/<toolchainVersion>/<component>/...     the install
//   <storage>/<toolchainVersion>/.managed-toolchain.json   written last
//   <storage>/.tmp-<id>/                              the working area
//
// Everything is built inside .tmp-<id> and renamed into place in one step, so a
// partial download or extraction is never mistaken for an install: a directory
// without the marker (or with files missing) is not an install. Nothing is
// extracted before its SHA-256 matches the pinned one. Download, extraction and
// free-space probing are injected.

export type DownloadFn = (
  url: string, dest: string, onProgress: DownloadProgress, token?: CancelToken,
) => Promise<void>;
export type ExtractFn = (archive: string, destDir: string, token?: CancelToken) => Promise<void>;
export type FreeBytesFn = (dir: string) => Promise<number>;

export interface InstallDeps {
  download: DownloadFn;
  extract: ExtractFn;
  freeBytes: FreeBytesFn;
}

export function defaultInstallDeps(): InstallDeps {
  return {
    download: (url, dest, onProgress, token) => httpsDownload(url, dest, onProgress, token),
    extract: (archive, destDir, token) => tarExtract(archive, destDir, token),
    freeBytes: async (dir) => {
      const s = await fs.promises.statfs(dir);
      return Number(s.bavail) * Number(s.bsize);
    },
  };
}

export type ProgressPhase = 'download' | 'verify' | 'extract' | 'finalize';

export interface ProgressEvent {
  phase: ProgressPhase;
  /** The component being handled (the last one, for `finalize`). */
  component: string;
  /** Position of `component` in the manifest, from 0. */
  index: number;
  /** Number of components being installed. */
  count: number;
  receivedBytes?: number;
  totalBytes?: number;
}

export interface InstallOptions {
  storageDir: string;
  manifest: ToolchainManifest;
  onProgress?: (event: ProgressEvent) => void;
  token?: CancelToken;
  /** Install from archives already on disk (named as upstream) instead of downloading: air-gapped machines. */
  localArchiveDir?: string;
}

export interface InstalledToolchain {
  dir: string;
  toolchainVersion: string;
  /** Absolute directories to put on PATH, in manifest order. */
  binDirs: string[];
}

export type ManagedToolchainErrorKind =
  | 'offline' | 'http' | 'hash-mismatch' | 'disk-full' | 'cancelled'
  | 'extract-failed' | 'incomplete' | 'missing-archive' | 'unexpected';

export class ManagedToolchainError extends Error {
  constructor(
    readonly kind: ManagedToolchainErrorKind,
    message: string,
    readonly extra: { component?: string; detail?: string; requiredBytes?: number; availableBytes?: number } = {},
  ) {
    super(message);
    this.name = 'ManagedToolchainError';
  }
  get component(): string | undefined { return this.extra.component; }
  get detail(): string | undefined { return this.extra.detail; }
  get requiredBytes(): number | undefined { return this.extra.requiredBytes; }
  get availableBytes(): number | undefined { return this.extra.availableBytes; }
}

const MARKER = '.managed-toolchain.json';
const NETWORK_CODES = new Set(['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH']);

const codeOf = (err: unknown): string | undefined => (err as NodeJS.ErrnoException | undefined)?.code;
const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const exists = async (p: string): Promise<boolean> => { try { await fs.promises.access(p); return true; } catch { return false; } };

interface Marker { toolchainVersion: string; components: Array<{ name: string; version: string; sha256: string }> }

const binDirsOf = (dir: string, manifest: ToolchainManifest): string[] =>
  manifest.components.flatMap((c) => c.binDirs.map((b) => path.join(dir, c.name, b)));

async function sha256File(file: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/** True when `file` has exactly the pinned size and SHA-256. */
async function matchesPin(file: string, c: ToolchainComponent): Promise<boolean> {
  try {
    if ((await fs.promises.stat(file)).size !== c.size) return false;
    return (await sha256File(file)) === c.sha256;
  } catch { return false; }
}

/**
 * The install for this manifest, if there is a complete one: the marker matches
 * the pinned components and every required file is there. Never throws.
 */
export async function findInstalledToolchain(
  storageDir: string, manifest: ToolchainManifest,
): Promise<InstalledToolchain | undefined> {
  const dir = path.join(storageDir, manifest.toolchainVersion);
  try {
    const marker = JSON.parse(await fs.promises.readFile(path.join(dir, MARKER), 'utf8')) as Marker;
    if (marker.toolchainVersion !== manifest.toolchainVersion) return undefined;
    if (marker.components.length !== manifest.components.length) return undefined;
    for (const [i, c] of manifest.components.entries()) {
      const m = marker.components[i];
      if (!m || m.name !== c.name || m.version !== c.version || m.sha256 !== c.sha256) return undefined;
      for (const f of c.requiredFiles) if (!await exists(path.join(dir, c.name, f))) return undefined;
    }
    return { dir, toolchainVersion: manifest.toolchainVersion, binDirs: binDirsOf(dir, manifest) };
  } catch { return undefined; }
}

/** Downloads (or finds locally), verifies and installs the toolchain. Resolves immediately when already installed. */
export async function installManagedToolchain(
  opts: InstallOptions,
  deps: InstallDeps = defaultInstallDeps(),
): Promise<InstalledToolchain> {
  const { storageDir, manifest, token, localArchiveDir } = opts;
  const count = manifest.components.length;
  const emit = (e: Omit<ProgressEvent, 'count' | 'index'>): void =>
    opts.onProgress?.({ ...e, count, index: manifest.components.findIndex((c) => c.name === e.component) });
  const finalDir = path.join(storageDir, manifest.toolchainVersion);
  const tmp = path.join(storageDir, `.tmp-${crypto.randomBytes(4).toString('hex')}`);
  const cancelledError = (): ManagedToolchainError => new ManagedToolchainError('cancelled', 'Toolchain installation cancelled');
  const checkCancelled = (): void => { if (token?.isCancellationRequested) throw cancelledError(); };

  await fs.promises.mkdir(storageDir, { recursive: true });
  await removeStaleTemps(storageDir);

  const existing = await findInstalledToolchain(storageDir, manifest);
  if (existing) return existing;
  // A directory that is not a complete install is not to be trusted.
  await fs.promises.rm(finalDir, { recursive: true, force: true });

  // Free space, before anything is downloaded. Archives are deleted as soon as they
  // are extracted, so the peak is everything extracted plus the largest archive.
  const extracted = manifest.components.reduce((n, c) => n + c.extractedSize, 0);
  const requiredBytes = extracted + (localArchiveDir ? 0 : Math.max(...manifest.components.map((c) => c.size)));
  const availableBytes = await deps.freeBytes(storageDir);
  if (availableBytes < requiredBytes) {
    throw new ManagedToolchainError('disk-full', 'Not enough free disk space for the toolchain', { requiredBytes, availableBytes });
  }

  try {
    const stage = path.join(tmp, 'stage');
    const downloads = path.join(tmp, 'dl');
    await fs.promises.mkdir(stage, { recursive: true });
    await fs.promises.mkdir(downloads, { recursive: true });

    for (const c of manifest.components) {
      checkCancelled();
      const { file, temporary } = localArchiveDir
        ? await localArchive(localArchiveDir, c)
        : await downloadArchive(c, downloads, deps, token, emit);
      checkCancelled();
      await extractComponent(c, file, tmp, stage, deps, token, emit);
      if (temporary) await fs.promises.rm(file, { force: true });
    }

    checkCancelled();
    emit({ phase: 'finalize', component: manifest.components.at(-1)!.name });
    const marker: Marker = {
      toolchainVersion: manifest.toolchainVersion,
      components: manifest.components.map((c) => ({ name: c.name, version: c.version, sha256: c.sha256 })),
    };
    await fs.promises.writeFile(path.join(stage, MARKER), JSON.stringify(marker, null, 2));
    await fs.promises.rename(stage, finalDir);
  } catch (err) {
    throw err instanceof ManagedToolchainError ? err
      : new ManagedToolchainError('unexpected', `Toolchain installation failed: ${messageOf(err)}`, { detail: messageOf(err) });
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }

  await removeSuperseded(storageDir, manifest.toolchainVersion);
  return { dir: finalDir, toolchainVersion: manifest.toolchainVersion, binDirs: binDirsOf(finalDir, manifest) };
}

async function localArchive(dir: string, c: ToolchainComponent): Promise<{ file: string; temporary: boolean }> {
  const file = path.join(dir, archiveFileName(c));
  if (!await exists(file)) {
    throw new ManagedToolchainError('missing-archive', `Archive for ${c.name} not found`,
      { component: c.name, detail: `expected ${archiveFileName(c)} in ${dir}` });
  }
  if (!await matchesPin(file, c)) {
    throw new ManagedToolchainError('hash-mismatch', `${file} is not the pinned ${c.name} ${c.version} archive`,
      { component: c.name, detail: file });
  }
  return { file, temporary: false };
}

async function downloadArchive(
  c: ToolchainComponent, downloads: string, deps: InstallDeps, token: CancelToken | undefined,
  emit: (e: Omit<ProgressEvent, 'count' | 'index'>) => void,
): Promise<{ file: string; temporary: boolean }> {
  const dest = path.join(downloads, archiveFileName(c));
  let mismatch = false;
  let allNetwork = true;
  let lastDetail = '';

  for (const source of [c.url, c.mirrorUrl]) {
    try {
      await deps.download(source, dest, (receivedBytes, totalBytes) =>
        emit({ phase: 'download', component: c.name, receivedBytes, totalBytes }), token);
    } catch (err) {
      await fs.promises.rm(dest, { force: true });
      if (token?.isCancellationRequested) throw new ManagedToolchainError('cancelled', 'Toolchain installation cancelled');
      if (codeOf(err) === 'ENOSPC') {
        throw new ManagedToolchainError('disk-full', `The disk is full while downloading ${c.name}`, { component: c.name });
      }
      allNetwork &&= NETWORK_CODES.has(codeOf(err) ?? '');
      lastDetail = messageOf(err);
      continue;
    }
    emit({ phase: 'verify', component: c.name });
    if (await matchesPin(dest, c)) return { file: dest, temporary: true };
    await fs.promises.rm(dest, { force: true });
    mismatch = true;
    lastDetail = `${source} did not deliver the pinned ${c.name} ${c.version} archive`;
  }

  if (mismatch) {
    throw new ManagedToolchainError('hash-mismatch', `Downloaded ${c.name} does not match its pinned SHA-256`,
      { component: c.name, detail: lastDetail });
  }
  throw new ManagedToolchainError(allNetwork ? 'offline' : 'http',
    `Could not download ${c.name} from the primary source or the mirror`, { component: c.name, detail: lastDetail });
}

async function extractComponent(
  c: ToolchainComponent, archive: string, tmp: string, stage: string, deps: InstallDeps,
  token: CancelToken | undefined, emit: (e: Omit<ProgressEvent, 'count' | 'index'>) => void,
): Promise<void> {
  emit({ phase: 'extract', component: c.name });
  const work = path.join(tmp, `x-${c.name}`);
  await fs.promises.mkdir(work, { recursive: true });
  try {
    await deps.extract(archive, work, token);
  } catch (err) {
    if (token?.isCancellationRequested) throw new ManagedToolchainError('cancelled', 'Toolchain installation cancelled');
    if (codeOf(err) === 'ENOSPC') {
      throw new ManagedToolchainError('disk-full', `The disk is full while extracting ${c.name}`, { component: c.name });
    }
    throw new ManagedToolchainError('extract-failed', `Could not extract ${c.name}`, { component: c.name, detail: messageOf(err) });
  }

  const root = resolveArchiveRoot(c);
  const target = path.join(stage, c.name);
  await fs.promises.rename(root ? path.join(work, root) : work, target);
  await fs.promises.rm(work, { recursive: true, force: true });
  for (const p of c.prune ?? []) await fs.promises.rm(path.join(target, p), { recursive: true, force: true });

  const missing: string[] = [];
  for (const f of c.requiredFiles) if (!await exists(path.join(target, f))) missing.push(f);
  if (missing.length) {
    throw new ManagedToolchainError('incomplete', `${c.name} is missing required files`,
      { component: c.name, detail: missing.join(', ') });
  }
}

async function removeStaleTemps(storageDir: string): Promise<void> {
  for (const name of await fs.promises.readdir(storageDir)) {
    if (name.startsWith('.tmp-')) await fs.promises.rm(path.join(storageDir, name), { recursive: true, force: true });
  }
}

// Older toolchain versions are directories named by a plain integer.
async function removeSuperseded(storageDir: string, keep: string): Promise<void> {
  for (const name of await fs.promises.readdir(storageDir)) {
    if (/^\d+$/.test(name) && name !== keep) await fs.promises.rm(path.join(storageDir, name), { recursive: true, force: true });
  }
}
