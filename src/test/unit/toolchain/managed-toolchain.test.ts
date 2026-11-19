import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  installManagedToolchain,
  findInstalledToolchain,
  ManagedToolchainError,
  type DownloadFn,
  type ExtractFn,
  type InstallDeps,
  type ProgressEvent,
} from '../../../toolchain/managed-toolchain';
import type { ToolchainManifest } from '../../../toolchain/manifest';

// FR-WIN-TCH-4: the downloader / verifier / atomic installer. The file system is
// real (a temp directory, so the atomic rename is the real thing); download and
// extraction are injected, so every failure can be provoked.

const sha = (b: Buffer): string => crypto.createHash('sha256').update(b).digest('hex');
const bytes = (name: string): Buffer => Buffer.from(`archive:${name}`);

const manifest: ToolchainManifest = {
  schemaVersion: 1,
  toolchainVersion: '2',
  components: [
    {
      name: 'llvm', version: '9.1', url: 'https://up.example/llvm-9.1.zip', mirrorUrl: 'https://mirror.example/llvm-9.1.zip',
      sha256: sha(bytes('llvm')), size: bytes('llvm').length, extractedSize: 1000,
      archiveRoot: 'llvm-{version}-x', binDirs: ['bin'],
      requiredFiles: ['bin/clang++.exe', 'bin/lldb-dap.exe'], prune: ['i686', 'armv7'],
    },
    {
      name: 'cmake', version: '4.0', url: 'https://up.example/cmake-4.0.zip', mirrorUrl: 'https://mirror.example/cmake-4.0.zip',
      sha256: sha(bytes('cmake')), size: bytes('cmake').length, extractedSize: 500,
      archiveRoot: 'cmake-{version}-x', binDirs: ['bin'], requiredFiles: ['bin/cmake.exe'],
    },
    {
      name: 'ninja', version: '1.0', url: 'https://up.example/ninja-win.zip', mirrorUrl: 'https://mirror.example/ninja-win.zip',
      sha256: sha(bytes('ninja')), size: bytes('ninja').length, extractedSize: 50,
      archiveRoot: '', binDirs: ['.'], requiredFiles: ['ninja.exe'],
    },
  ],
};

let storage: string;
let tmpDirs: string[];

beforeEach(() => {
  storage = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-ide-mt-'));
  tmpDirs = [storage];
});
afterEach(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

const componentOfUrl = (url: string) => manifest.components.find((c) => c.url === url || c.mirrorUrl === url)!;

/** Writes the right bytes for any URL, unless `behave` says otherwise for that URL. */
function fakeDownload(behave: Record<string, (dest: string) => Promise<void>> = {}): DownloadFn & ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string, dest: string, onProgress: (r: number, t?: number) => void) => {
    if (behave[url]) return behave[url]!(dest);
    const b = bytes(componentOfUrl(url).name);
    onProgress(b.length / 2, b.length);
    await fs.promises.writeFile(dest, b);
    onProgress(b.length, b.length);
  }) as unknown as DownloadFn & ReturnType<typeof vi.fn>;
}

const archiveName = (zip: string): string => {
  const content = fs.readFileSync(zip, 'utf8');
  return content.replace('archive:', '');
};

/** Creates what the real archive would contain: the archive root, required files, a few sysroots. */
const fakeExtract: ExtractFn & ReturnType<typeof vi.fn> = vi.fn(async (zip: string, dest: string) => {
  const c = manifest.components.find((x) => x.name === archiveName(zip))!;
  const root = path.join(dest, c.archiveRoot.replace('{version}', c.version));
  for (const f of c.requiredFiles) {
    await fs.promises.mkdir(path.dirname(path.join(root, f)), { recursive: true });
    await fs.promises.writeFile(path.join(root, f), 'x');
  }
  for (const p of ['i686', 'armv7', 'x86_64']) {
    if (c.name === 'llvm') {
      await fs.promises.mkdir(path.join(root, p), { recursive: true });
      await fs.promises.writeFile(path.join(root, p, 'libc.a'), 'x');
    }
  }
}) as unknown as ExtractFn & ReturnType<typeof vi.fn>;

const plentyOfSpace = async (): Promise<number> => 10 * 1024 ** 3;

function deps(over: Partial<InstallDeps> = {}): InstallDeps {
  return { download: fakeDownload(), extract: fakeExtract, freeBytes: plentyOfSpace, ...over };
}

const exists = (...p: string[]): boolean => fs.existsSync(path.join(...p));
const leftovers = (): string[] => fs.readdirSync(storage).filter((n) => n.startsWith('.tmp'));

beforeEach(() => { fakeExtract.mockClear(); });

describe('installManagedToolchain() — success path', () => {
  it('downloads, verifies, extracts and installs into <storage>/<toolchainVersion>/<component>', async () => {
    const dl = fakeDownload();
    const result = await installManagedToolchain({ storageDir: storage, manifest }, deps({ download: dl }));
    expect(result.dir).toBe(path.join(storage, '2'));
    expect(exists(storage, '2', 'llvm', 'bin', 'clang++.exe')).toBe(true);
    expect(exists(storage, '2', 'llvm', 'bin', 'lldb-dap.exe')).toBe(true);
    expect(exists(storage, '2', 'cmake', 'bin', 'cmake.exe')).toBe(true);
    expect(exists(storage, '2', 'ninja', 'ninja.exe')).toBe(true);
    expect(dl.mock.calls.map((c) => c[0])).toEqual(manifest.components.map((c) => c.url));
  });

  it('reports the bin directories of every component', async () => {
    const result = await installManagedToolchain({ storageDir: storage, manifest }, deps());
    expect(result.binDirs).toEqual([
      path.join(storage, '2', 'llvm', 'bin'),
      path.join(storage, '2', 'cmake', 'bin'),
      path.join(storage, '2', 'ninja'),
    ]);
  });

  it('prunes the unused target sysroots but keeps the one that is needed', async () => {
    await installManagedToolchain({ storageDir: storage, manifest }, deps());
    expect(exists(storage, '2', 'llvm', 'i686')).toBe(false);
    expect(exists(storage, '2', 'llvm', 'armv7')).toBe(false);
    expect(exists(storage, '2', 'llvm', 'x86_64', 'libc.a')).toBe(true);
  });

  it('leaves no temporary directory or downloaded archive behind', async () => {
    await installManagedToolchain({ storageDir: storage, manifest }, deps());
    expect(leftovers()).toEqual([]);
  });

  it('reports progress per phase and component', async () => {
    const events: ProgressEvent[] = [];
    await installManagedToolchain({ storageDir: storage, manifest, onProgress: (e) => events.push(e) }, deps());
    const phases = new Set(events.map((e) => e.phase));
    expect(phases).toEqual(new Set(['download', 'verify', 'extract', 'finalize']));
    const dl = events.filter((e) => e.phase === 'download' && e.component === 'llvm');
    expect(dl.length).toBeGreaterThan(0);
    expect(dl.at(-1)!.totalBytes).toBe(bytes('llvm').length);
    expect(events.every((e) => e.count === 3)).toBe(true);
  });
});

describe('installManagedToolchain() — verification and sources', () => {
  it('rejects a download whose hash does not match and falls back to the mirror', async () => {
    const dl = fakeDownload({
      [manifest.components[0]!.url]: async (dest) => { await fs.promises.writeFile(dest, 'tampered'); },
    });
    const result = await installManagedToolchain({ storageDir: storage, manifest }, deps({ download: dl }));
    expect(result.dir).toBe(path.join(storage, '2'));
    const urls = dl.mock.calls.map((c) => c[0]);
    expect(urls).toContain(manifest.components[0]!.mirrorUrl);
  });

  it('refuses to install when no source delivers the pinned bytes, and says so', async () => {
    const bad = async (dest: string): Promise<void> => { await fs.promises.writeFile(dest, 'tampered'); };
    const dl = fakeDownload({
      [manifest.components[0]!.url]: bad,
      [manifest.components[0]!.mirrorUrl]: bad,
    });
    const err = await installManagedToolchain({ storageDir: storage, manifest }, deps({ download: dl })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ManagedToolchainError);
    expect((err as ManagedToolchainError).kind).toBe('hash-mismatch');
    expect((err as ManagedToolchainError).component).toBe('llvm');
    expect(fakeExtract).not.toHaveBeenCalled();
    expect(exists(storage, '2')).toBe(false);
    expect(leftovers()).toEqual([]);
  });

  it('a size mismatch counts as a failed verification too', async () => {
    const wrongSize = manifest.components[0]!;
    const sized: ToolchainManifest = {
      ...manifest, components: [{ ...wrongSize, size: wrongSize.size + 1 }, ...manifest.components.slice(1)],
    };
    const err = await installManagedToolchain({ storageDir: storage, manifest: sized }, deps()).catch((e: unknown) => e);
    expect((err as ManagedToolchainError).kind).toBe('hash-mismatch');
  });

  it.each(['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN'])('falls back to the mirror when the primary fails with %s', async (code) => {
    const dl = fakeDownload({
      [manifest.components[1]!.url]: async () => { throw Object.assign(new Error(code), { code }); },
    });
    const result = await installManagedToolchain({ storageDir: storage, manifest }, deps({ download: dl }));
    expect(result.dir).toBe(path.join(storage, '2'));
    expect(dl.mock.calls.map((c) => c[0])).toContain(manifest.components[1]!.mirrorUrl);
  });

  it('falls back to the mirror on an HTTP error status', async () => {
    const dl = fakeDownload({
      [manifest.components[2]!.url]: async () => { throw Object.assign(new Error('HTTP 404'), { status: 404 }); },
    });
    await installManagedToolchain({ storageDir: storage, manifest }, deps({ download: dl }));
    expect(dl.mock.calls.map((c) => c[0])).toContain(manifest.components[2]!.mirrorUrl);
  });

  it('reports "offline" when neither source can be reached', async () => {
    const down = async (): Promise<void> => { throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }); };
    const dl = fakeDownload({ [manifest.components[0]!.url]: down, [manifest.components[0]!.mirrorUrl]: down });
    const err = await installManagedToolchain({ storageDir: storage, manifest }, deps({ download: dl })).catch((e: unknown) => e);
    expect((err as ManagedToolchainError).kind).toBe('offline');
    expect(leftovers()).toEqual([]);
  });

  it('reports "http" when both sources answer with an error status', async () => {
    const nf = async (): Promise<void> => { throw Object.assign(new Error('HTTP 404'), { status: 404 }); };
    const dl = fakeDownload({ [manifest.components[0]!.url]: nf, [manifest.components[0]!.mirrorUrl]: nf });
    const err = await installManagedToolchain({ storageDir: storage, manifest }, deps({ download: dl })).catch((e: unknown) => e);
    expect((err as ManagedToolchainError).kind).toBe('http');
  });

  it('removes a corrupt download before trying the next source', async () => {
    const seen: boolean[] = [];
    const dl = fakeDownload({
      [manifest.components[0]!.url]: async (dest) => { await fs.promises.writeFile(dest, 'tampered'); },
      [manifest.components[0]!.mirrorUrl]: async (dest) => {
        seen.push(fs.existsSync(dest));
        await fs.promises.writeFile(dest, bytes('llvm'));
      },
    });
    await installManagedToolchain({ storageDir: storage, manifest }, deps({ download: dl }));
    expect(seen).toEqual([false]);
  });
});

describe('installManagedToolchain() — interruption and failures', () => {
  it('stops cleanly when cancelled during a download, without trying the mirror', async () => {
    let cancelled = false;
    const token = {
      get isCancellationRequested() { return cancelled; },
      onCancellationRequested: () => ({ dispose: () => undefined }),
    };
    const dl = fakeDownload({
      [manifest.components[0]!.url]: async () => { cancelled = true; throw new Error('aborted'); },
    });
    const err = await installManagedToolchain({ storageDir: storage, manifest, token }, deps({ download: dl })).catch((e: unknown) => e);
    expect((err as ManagedToolchainError).kind).toBe('cancelled');
    expect(dl).toHaveBeenCalledTimes(1);
    expect(exists(storage, '2')).toBe(false);
    expect(leftovers()).toEqual([]);
  });

  it('a download interrupted half-way leaves no valid install', async () => {
    const dl = fakeDownload({
      [manifest.components[1]!.url]: async (dest) => {
        await fs.promises.writeFile(dest, 'archive:cm'); // truncated
        throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
      },
      [manifest.components[1]!.mirrorUrl]: async () => { throw Object.assign(new Error('down'), { code: 'ECONNRESET' }); },
    });
    await installManagedToolchain({ storageDir: storage, manifest }, deps({ download: dl })).catch(() => undefined);
    expect(await findInstalledToolchain(storage, manifest)).toBeUndefined();
    expect(exists(storage, '2')).toBe(false);
    expect(leftovers()).toEqual([]);
  });

  it('reports "disk-full" when the disk fills up while downloading, and does not retry elsewhere', async () => {
    const dl = fakeDownload({
      [manifest.components[0]!.url]: async () => { throw Object.assign(new Error('write ENOSPC'), { code: 'ENOSPC' }); },
    });
    const err = await installManagedToolchain({ storageDir: storage, manifest }, deps({ download: dl })).catch((e: unknown) => e);
    expect((err as ManagedToolchainError).kind).toBe('disk-full');
    expect(dl).toHaveBeenCalledTimes(1);
    expect(leftovers()).toEqual([]);
  });

  it('checks the free space before downloading anything', async () => {
    const dl = fakeDownload();
    const err = await installManagedToolchain(
      { storageDir: storage, manifest }, deps({ download: dl, freeBytes: async () => 1024 }),
    ).catch((e: unknown) => e);
    expect((err as ManagedToolchainError).kind).toBe('disk-full');
    expect((err as ManagedToolchainError).requiredBytes).toBeGreaterThan(1024);
    expect(dl).not.toHaveBeenCalled();
    expect(leftovers()).toEqual([]);
  });

  it('reports "disk-full" when extraction runs out of space', async () => {
    const extract: ExtractFn = async () => { throw Object.assign(new Error('write ENOSPC'), { code: 'ENOSPC' }); };
    const err = await installManagedToolchain({ storageDir: storage, manifest }, deps({ extract })).catch((e: unknown) => e);
    expect((err as ManagedToolchainError).kind).toBe('disk-full');
    expect(exists(storage, '2')).toBe(false);
    expect(leftovers()).toEqual([]);
  });

  it('an extraction that fails half-way is never mistaken for an install', async () => {
    const extract: ExtractFn = async (_zip, dest) => {
      await fs.promises.mkdir(path.join(dest, 'llvm-9.1-x', 'bin'), { recursive: true });
      await fs.promises.writeFile(path.join(dest, 'llvm-9.1-x', 'bin', 'clang++.exe'), 'partial');
      throw new Error('tar: unexpected end of archive');
    };
    const err = await installManagedToolchain({ storageDir: storage, manifest }, deps({ extract })).catch((e: unknown) => e);
    expect((err as ManagedToolchainError).kind).toBe('extract-failed');
    expect(await findInstalledToolchain(storage, manifest)).toBeUndefined();
    expect(exists(storage, '2')).toBe(false);
    expect(leftovers()).toEqual([]);
  });

  it('refuses an extraction that lacks a required file', async () => {
    const extract: ExtractFn = async (zip, dest) => {
      await fakeExtract(zip, dest);
      if (archiveName(zip) === 'llvm') {
        fs.rmSync(path.join(dest, 'llvm-9.1-x', 'bin', 'lldb-dap.exe'));
      }
    };
    const err = await installManagedToolchain({ storageDir: storage, manifest }, deps({ extract })).catch((e: unknown) => e);
    expect((err as ManagedToolchainError).kind).toBe('incomplete');
    expect((err as ManagedToolchainError).detail).toMatch(/lldb-dap\.exe/);
    expect(exists(storage, '2')).toBe(false);
  });

  it('keeps an existing valid install untouched when a later attempt fails', async () => {
    await installManagedToolchain({ storageDir: storage, manifest }, deps());
    const next: ToolchainManifest = { ...manifest, toolchainVersion: '3' };
    const err = await installManagedToolchain({ storageDir: storage, manifest: next }, deps({
      download: fakeDownload({ [manifest.components[0]!.url]: async () => { throw Object.assign(new Error('x'), { code: 'ENOTFOUND' }); },
        [manifest.components[0]!.mirrorUrl]: async () => { throw Object.assign(new Error('x'), { code: 'ENOTFOUND' }); } }),
    })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ManagedToolchainError);
    expect(await findInstalledToolchain(storage, manifest)).toBeDefined();
    expect(exists(storage, '3')).toBe(false);
  });
});

describe('installManagedToolchain() — existing and superseded installs', () => {
  it('does nothing when a valid install is already there', async () => {
    await installManagedToolchain({ storageDir: storage, manifest }, deps());
    const dl = fakeDownload();
    const again = await installManagedToolchain({ storageDir: storage, manifest }, deps({ download: dl }));
    expect(again.dir).toBe(path.join(storage, '2'));
    expect(dl).not.toHaveBeenCalled();
  });

  it('does not trust a directory without the completion marker, and reinstalls over it', async () => {
    fs.mkdirSync(path.join(storage, '2', 'llvm', 'bin'), { recursive: true });
    fs.writeFileSync(path.join(storage, '2', 'llvm', 'bin', 'clang++.exe'), 'partial');
    expect(await findInstalledToolchain(storage, manifest)).toBeUndefined();
    const dl = fakeDownload();
    await installManagedToolchain({ storageDir: storage, manifest }, deps({ download: dl }));
    expect(dl).toHaveBeenCalled();
    expect(await findInstalledToolchain(storage, manifest)).toBeDefined();
  });

  it('does not trust an install whose files have gone missing', async () => {
    await installManagedToolchain({ storageDir: storage, manifest }, deps());
    fs.rmSync(path.join(storage, '2', 'cmake', 'bin', 'cmake.exe'));
    expect(await findInstalledToolchain(storage, manifest)).toBeUndefined();
  });

  it('does not trust an install made for different pinned hashes', async () => {
    await installManagedToolchain({ storageDir: storage, manifest }, deps());
    const changed: ToolchainManifest = {
      ...manifest, components: [{ ...manifest.components[0]!, sha256: 'f'.repeat(64) }, ...manifest.components.slice(1)],
    };
    expect(await findInstalledToolchain(storage, changed)).toBeUndefined();
  });

  it('removes superseded versions and stale temporary directories after a successful install', async () => {
    fs.mkdirSync(path.join(storage, '1', 'llvm'), { recursive: true });
    fs.mkdirSync(path.join(storage, '.tmp-dead', 'x'), { recursive: true });
    fs.mkdirSync(path.join(storage, 'notes'), { recursive: true });
    await installManagedToolchain({ storageDir: storage, manifest }, deps());
    expect(exists(storage, '1')).toBe(false);
    expect(exists(storage, '.tmp-dead')).toBe(false);
    expect(exists(storage, 'notes')).toBe(true);
    expect(exists(storage, '2')).toBe(true);
  });

  it('keeps the superseded version when the new install fails', async () => {
    fs.mkdirSync(path.join(storage, '1', 'llvm'), { recursive: true });
    await installManagedToolchain({ storageDir: storage, manifest }, deps({
      extract: async () => { throw new Error('boom'); },
    })).catch(() => undefined);
    expect(exists(storage, '1')).toBe(true);
  });
});

describe('installManagedToolchain() — local archives (air-gapped machines)', () => {
  const archivesDir = (): string => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-ide-archives-'));
    tmpDirs.push(d);
    for (const c of manifest.components) fs.writeFileSync(path.join(d, path.basename(c.url)), bytes(c.name));
    return d;
  };

  it('installs from a folder of archives without touching the network', async () => {
    const dl = fakeDownload();
    const result = await installManagedToolchain(
      { storageDir: storage, manifest, localArchiveDir: archivesDir() }, deps({ download: dl }),
    );
    expect(dl).not.toHaveBeenCalled();
    expect(result.dir).toBe(path.join(storage, '2'));
    expect(exists(storage, '2', 'ninja', 'ninja.exe')).toBe(true);
  });

  it('leaves the user\'s archives in place', async () => {
    const dir = archivesDir();
    await installManagedToolchain({ storageDir: storage, manifest, localArchiveDir: dir }, deps());
    expect(fs.readdirSync(dir).sort()).toEqual(manifest.components.map((c) => path.basename(c.url)).sort());
  });

  it('verifies local archives against the same pinned hashes', async () => {
    const dir = archivesDir();
    fs.writeFileSync(path.join(dir, 'cmake-4.0.zip'), 'not the pinned build');
    const dl = fakeDownload();
    const err = await installManagedToolchain(
      { storageDir: storage, manifest, localArchiveDir: dir }, deps({ download: dl }),
    ).catch((e: unknown) => e);
    expect((err as ManagedToolchainError).kind).toBe('hash-mismatch');
    expect((err as ManagedToolchainError).component).toBe('cmake');
    expect(dl).not.toHaveBeenCalled();
  });

  it('names the missing archive', async () => {
    const dir = archivesDir();
    fs.rmSync(path.join(dir, 'ninja-win.zip'));
    const err = await installManagedToolchain(
      { storageDir: storage, manifest, localArchiveDir: dir }, deps(),
    ).catch((e: unknown) => e);
    expect((err as ManagedToolchainError).kind).toBe('missing-archive');
    expect((err as ManagedToolchainError).detail).toMatch(/ninja-win\.zip/);
  });

  it('needs room for the extracted files only, not for downloads', async () => {
    const needExtracted = manifest.components.reduce((n, c) => n + c.extractedSize, 0);
    const result = await installManagedToolchain(
      { storageDir: storage, manifest, localArchiveDir: archivesDir() },
      deps({ freeBytes: async () => needExtracted * 2 }),
    );
    expect(result.dir).toBe(path.join(storage, '2'));
  });
});
