import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as cp from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// FR-WIN-TCH-4: the pinned Windows toolchain manifest and the script that
// maintains it. The script is exercised as a real process (no module import),
// the same way a maintainer runs it.

const REPO = path.join(__dirname, '../../../..');
const MANIFEST_PATH = path.join(REPO, 'resources', 'windows-toolchain.json');
const SCRIPT = path.join(REPO, 'scripts', 'update-toolchain-manifest.mjs');

interface Component {
  name: string;
  version: string;
  url: string;
  mirrorUrl: string;
  sha256: string;
  size: number;
  archiveRoot: string;
  binDirs: string[];
  requiredFiles: string[];
}
interface Manifest { schemaVersion: number; toolchainVersion: string; components: Component[] }

const readManifest = (p = MANIFEST_PATH): Manifest => JSON.parse(fs.readFileSync(p, 'utf8')) as Manifest;

function runScript(args: string[]): { status: number; out: string } {
  const r = cp.spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  return { status: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}

describe('resources/windows-toolchain.json', () => {
  const manifest = readManifest();
  const byName = (n: string): Component => manifest.components.find((c) => c.name === n)!;

  it('pins llvm-mingw, CMake and Ninja', () => {
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.components.map((c) => c.name)).toEqual(['llvm-mingw', 'cmake', 'ninja']);
    expect(manifest.toolchainVersion).toMatch(/^\d+$/);
  });

  it.each(['llvm-mingw', 'cmake', 'ninja'])('%s has a version, an HTTPS source, our own SHA-256 and a size', (name) => {
    const c = byName(name);
    expect(c.version).toMatch(/^\d/);
    expect(c.url).toMatch(/^https:\/\/github\.com\//);
    expect(c.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Number.isInteger(c.size) && c.size > 0).toBe(true);
    expect(c.binDirs.length).toBeGreaterThan(0);
    expect(c.requiredFiles.length).toBeGreaterThan(0);
  });

  it('the source URL names the pinned version', () => {
    for (const c of manifest.components) expect(c.url).toContain(c.version);
  });

  it('every component has a mirror under the ds-ide release assets, same file name as upstream', () => {
    for (const c of manifest.components) {
      expect(c.mirrorUrl).toBe(
        `https://github.com/bobpuley/ds-ide/releases/download/toolchain-${manifest.toolchainVersion}/${path.posix.basename(c.url)}`,
      );
    }
  });

  it('asset file names are unique (they share one mirror release)', () => {
    const names = manifest.components.map((c) => path.posix.basename(c.url));
    expect(new Set(names).size).toBe(names.length);
  });

  it('the pinned llvm-mingw archive provides clang++ and lldb-dap (FR-WIN-DBG-1)', () => {
    const c = byName('llvm-mingw');
    expect(c.url).toMatch(/ucrt-x86_64\.zip$/);
    expect(c.requiredFiles).toEqual(expect.arrayContaining(['bin/clang++.exe', 'bin/lldb-dap.exe']));
  });

  it('CMake and Ninja provide their executables', () => {
    expect(byName('cmake').requiredFiles).toContain('bin/cmake.exe');
    expect(byName('ninja').requiredFiles).toContain('ninja.exe');
  });
});

describe('scripts/update-toolchain-manifest.mjs', () => {
  let dir: string;
  let manifestCopy: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-ide-manifest-'));
    manifestCopy = path.join(dir, 'manifest.json');
    fs.copyFileSync(MANIFEST_PATH, manifestCopy);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const sha = (b: Buffer): string => crypto.createHash('sha256').update(b).digest('hex');

  it('check accepts the shipped manifest', () => {
    const r = runScript(['check']);
    expect(r.status).toBe(0);
  });

  it('check rejects a manifest with a malformed hash', () => {
    const m = readManifest(manifestCopy);
    m.components[0]!.sha256 = 'not-a-hash';
    fs.writeFileSync(manifestCopy, JSON.stringify(m));
    const r = runScript(['--manifest', manifestCopy, 'check']);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/llvm-mingw/);
    expect(r.out).toMatch(/sha256/);
  });

  it('check rejects a non-HTTPS source', () => {
    const m = readManifest(manifestCopy);
    m.components[1]!.url = 'http://example.com/cmake.zip';
    fs.writeFileSync(manifestCopy, JSON.stringify(m));
    const r = runScript(['--manifest', manifestCopy, 'check']);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/https/i);
  });

  it('hash prints the SHA-256 and size of a file', () => {
    const f = path.join(dir, 'a.bin');
    const body = Buffer.from('daisy');
    fs.writeFileSync(f, body);
    const r = runScript(['hash', f]);
    expect(r.status).toBe(0);
    expect(r.out).toContain(sha(body));
    expect(r.out).toContain(String(body.length));
  });

  it('verify passes when every archive matches its pinned hash and size', () => {
    const m = readManifest(manifestCopy);
    const archives = path.join(dir, 'archives');
    fs.mkdirSync(archives);
    for (const c of m.components) {
      const body = Buffer.from(`archive of ${c.name}`);
      fs.writeFileSync(path.join(archives, path.posix.basename(c.url)), body);
      c.sha256 = sha(body);
      c.size = body.length;
    }
    fs.writeFileSync(manifestCopy, JSON.stringify(m));
    expect(runScript(['--manifest', manifestCopy, 'verify', archives]).status).toBe(0);
  });

  it('verify fails, naming the component, on a hash mismatch', () => {
    const archives = path.join(dir, 'archives');
    fs.mkdirSync(archives);
    for (const c of readManifest(manifestCopy).components) {
      fs.writeFileSync(path.join(archives, path.posix.basename(c.url)), 'tampered');
    }
    const r = runScript(['--manifest', manifestCopy, 'verify', archives]);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/mismatch/i);
    expect(r.out).toMatch(/llvm-mingw/);
  });

  it('verify fails when an archive is missing', () => {
    const archives = path.join(dir, 'empty');
    fs.mkdirSync(archives);
    const r = runScript(['--manifest', manifestCopy, 'verify', archives]);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/missing/i);
  });

  it('adopt records a new version with its own hash, size and derived mirror URL', () => {
    const f = path.join(dir, 'ninja-win.zip');
    const body = Buffer.from('a newer ninja');
    fs.writeFileSync(f, body);
    const url = 'https://github.com/ninja-build/ninja/releases/download/v9.9.9/ninja-win.zip';
    const r = runScript(['--manifest', manifestCopy, 'adopt', 'ninja', '9.9.9', url, f]);
    expect(r.status).toBe(0);
    const m = readManifest(manifestCopy);
    const ninja = m.components.find((c) => c.name === 'ninja')!;
    expect(ninja.version).toBe('9.9.9');
    expect(ninja.url).toBe(url);
    expect(ninja.sha256).toBe(sha(body));
    expect(ninja.size).toBe(body.length);
    expect(Number(m.toolchainVersion)).toBe(Number(readManifest().toolchainVersion) + 1);
    expect(ninja.mirrorUrl).toBe(
      `https://github.com/bobpuley/ds-ide/releases/download/toolchain-${m.toolchainVersion}/ninja-win.zip`,
    );
    // every component's mirror follows the new release tag
    for (const c of m.components) expect(c.mirrorUrl).toContain(`/toolchain-${m.toolchainVersion}/`);
  });

  it('adopt refuses a non-HTTPS URL and leaves the manifest untouched', () => {
    const before = fs.readFileSync(manifestCopy, 'utf8');
    const f = path.join(dir, 'x.zip');
    fs.writeFileSync(f, 'x');
    const r = runScript(['--manifest', manifestCopy, 'adopt', 'ninja', '1.0.0', 'http://evil.example/ninja-win.zip', f]);
    expect(r.status).toBe(1);
    expect(fs.readFileSync(manifestCopy, 'utf8')).toBe(before);
  });

  it('adopt refuses an unknown component', () => {
    const f = path.join(dir, 'x.zip');
    fs.writeFileSync(f, 'x');
    const r = runScript(['--manifest', manifestCopy, 'adopt', 'gcc', '1.0.0', 'https://github.com/x/y/z.zip', f]);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/unknown component/i);
  });
});
