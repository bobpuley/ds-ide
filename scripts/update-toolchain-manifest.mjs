#!/usr/bin/env node
// FR-WIN-TCH-4: maintains resources/windows-toolchain.json, the pinned manifest
// of the Windows toolchain the extension downloads on first use.
//
//   node scripts/update-toolchain-manifest.mjs [--manifest <path>] <command>
//
//   check                                  validate the manifest (offline)
//   hash <file>...                         print "<sha256>  <size>  <file>"
//   verify <dir>                           every archive in <dir>, named as in
//                                          the manifest, must match its pinned
//                                          SHA-256 and size
//   adopt <name> <version> <url> <file>    pin a new version: hashes <file>,
//                                          records version / url / size, bumps
//                                          toolchainVersion and re-derives every
//                                          mirror URL
//
// Upstream hashes are a cross-check, not the source of truth: the manifest pins
// OUR hash, computed here from the archive that was actually downloaded and
// inspected (Ninja publishes no hash file, and release assets can disappear).

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_MANIFEST = path.join(
  path.dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'windows-toolchain.json');
const MIRROR_BASE = 'https://github.com/bobpuley/ds-ide/releases/download';

const fail = (message) => { console.error(`update-toolchain-manifest: ${message}`); process.exit(1); };

function sha256Of(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(1 << 20);
    for (let n; (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0;) hash.update(buf.subarray(0, n));
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}

export const mirrorUrlFor = (toolchainVersion, url) =>
  `${MIRROR_BASE}/toolchain-${toolchainVersion}/${path.posix.basename(new URL(url).pathname)}`;

function validate(manifest) {
  const errors = [];
  if (manifest.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (!/^\d+$/.test(String(manifest.toolchainVersion ?? ''))) errors.push('toolchainVersion must be an integer string');
  if (!Array.isArray(manifest.components) || manifest.components.length === 0) {
    errors.push('components must be a non-empty array');
    return errors;
  }
  const assets = new Set();
  for (const c of manifest.components) {
    const at = (msg) => errors.push(`${c.name ?? '?'}: ${msg}`);
    if (typeof c.name !== 'string' || !c.name) at('name is required');
    if (typeof c.version !== 'string' || !c.version) at('version is required');
    if (typeof c.url !== 'string' || !c.url.startsWith('https://')) at('url must be an https URL');
    if (typeof c.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(c.sha256)) at('sha256 must be 64 lower-case hex digits');
    if (!Number.isInteger(c.size) || c.size <= 0) at('size must be a positive integer');
    if (!Number.isInteger(c.extractedSize) || c.extractedSize <= 0) at('extractedSize must be a positive integer');
    if (typeof c.archiveRoot !== 'string') at('archiveRoot must be a string ("" for a flat archive)');
    if (!Array.isArray(c.binDirs) || c.binDirs.length === 0) at('binDirs must be a non-empty array');
    if (!Array.isArray(c.requiredFiles) || c.requiredFiles.length === 0) at('requiredFiles must be a non-empty array');
    if (c.prune !== undefined && !(Array.isArray(c.prune) && c.prune.every((p) => typeof p === 'string' && p && !p.includes('..')))) {
      at('prune must be a list of relative directories');
    }
    if (typeof c.url === 'string' && typeof c.mirrorUrl === 'string') {
      try {
        if (c.mirrorUrl !== mirrorUrlFor(manifest.toolchainVersion, c.url)) {
          at(`mirrorUrl must be ${mirrorUrlFor(manifest.toolchainVersion, c.url)}`);
        }
        const asset = path.posix.basename(new URL(c.url).pathname);
        if (assets.has(asset)) at(`asset file name ${asset} is used twice`);
        assets.add(asset);
      } catch { at('url is not a valid URL'); }
    } else {
      at('url and mirrorUrl are required');
    }
  }
  return errors;
}

function load(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (err) { return fail(`cannot read manifest ${file}: ${err.message}`); }
}

function save(file, manifest) {
  fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
}

const args = process.argv.slice(2);
let manifestPath = DEFAULT_MANIFEST;
const mi = args.indexOf('--manifest');
if (mi !== -1) { manifestPath = path.resolve(args[mi + 1] ?? fail('--manifest needs a path')); args.splice(mi, 2); }
const [command, ...rest] = args;

switch (command) {
  case 'check': {
    const errors = validate(load(manifestPath));
    if (errors.length) fail(`manifest is invalid:\n  - ${errors.join('\n  - ')}`);
    console.log(`manifest ok: ${manifestPath}`);
    break;
  }
  case 'hash': {
    if (rest.length === 0) fail('hash needs at least one file');
    for (const f of rest) console.log(`${sha256Of(f)}  ${fs.statSync(f).size}  ${f}`);
    break;
  }
  case 'verify': {
    const dir = rest[0] ?? fail('verify needs the directory holding the archives');
    const problems = [];
    for (const c of load(manifestPath).components) {
      const file = path.join(dir, path.posix.basename(new URL(c.url).pathname));
      if (!fs.existsSync(file)) { problems.push(`${c.name}: archive missing (${file})`); continue; }
      const size = fs.statSync(file).size;
      const hash = sha256Of(file);
      if (size !== c.size) problems.push(`${c.name}: size mismatch (${size} vs pinned ${c.size})`);
      if (hash !== c.sha256) problems.push(`${c.name}: sha256 mismatch (${hash} vs pinned ${c.sha256})`);
    }
    if (problems.length) fail(`verification failed:\n  - ${problems.join('\n  - ')}`);
    console.log('all archives match the manifest');
    break;
  }
  case 'adopt': {
    const [name, version, url, file] = rest;
    if (!name || !version || !url || !file) fail('usage: adopt <name> <version> <url> <file>');
    const manifest = load(manifestPath);
    const component = manifest.components.find((c) => c.name === name);
    if (!component) fail(`unknown component "${name}" (have: ${manifest.components.map((c) => c.name).join(', ')})`);
    if (!url.startsWith('https://')) fail('the source URL must be https');
    if (!fs.existsSync(file)) fail(`archive not found: ${file}`);
    component.version = version;
    component.url = url;
    component.sha256 = sha256Of(file);
    component.size = fs.statSync(file).size;
    // The extracted size is the one figure the script cannot know from the zip alone.
    console.log(`note: update extractedSize of ${name} by hand if it changed (disk-space check).`);
    manifest.toolchainVersion = String(Number(manifest.toolchainVersion) + 1);
    for (const c of manifest.components) c.mirrorUrl = mirrorUrlFor(manifest.toolchainVersion, c.url);
    const errors = validate(manifest);
    if (errors.length) fail(`result would be invalid:\n  - ${errors.join('\n  - ')}`);
    save(manifestPath, manifest);
    console.log(`${name} ${version} pinned (toolchainVersion ${manifest.toolchainVersion}); upload the archives to the toolchain-${manifest.toolchainVersion} release.`);
    break;
  }
  default:
    fail('commands: check | hash <file>... | verify <dir> | adopt <name> <version> <url> <file>');
}
