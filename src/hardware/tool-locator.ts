import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// FR-WIN-TCH-5: the one place that finds an external tool, for every consumer
// (emulator build, hardware build, DFU flash, debug adapter). Lookup order:
//
//   1. the user-configured path (a binary or a directory holding it)
//   2. PATH — `which` on macOS/Linux, `where.exe` on Windows
//   3. the tool's known install locations
//   4. the managed toolchain — an extension point, filled in M82
//
// Everything that touches the machine (file existence, process execution,
// directory listings, environment, platform) is injectable, so both platforms
// are unit-tested on any host.

export type Exists = (p: string) => Promise<boolean>;
export type Exec = (cmd: string, args: string[]) => Promise<string>;
export type ListDir = (dir: string) => Promise<string[]>;
/** Directories (holding the tool's binary) of the managed toolchain, if installed. */
export type ManagedToolDirs = (tool: string) => Promise<readonly string[]>;

export const defaultExists: Exists = async (p) => {
  try { await fs.promises.access(p); return true; } catch { return false; }
};

// execFile (not exec) — no shell is involved, so binary/arg strings can't be
// reinterpreted as shell metacharacters.
export const defaultExec: Exec = (cmd, args) =>
  new Promise<string>((resolve, reject) =>
    cp.execFile(cmd, args, (err, stdout) => (err ? reject(err) : resolve(stdout))),
  );

const defaultListDir: ListDir = (dir) => fs.promises.readdir(dir);

export interface ToolSpec {
  /** Executable base name, without extension (`arm-none-eabi-gcc`). */
  binary: string;
  /** Names asked of PATH, in order. Defaults to `[binary]`. */
  pathNames?: readonly string[];
  /**
   * Directories checked after PATH. A single `*` segment stands for "every
   * subdirectory, newest first" (versioned installs: `…\Arm GNU Toolchain\*\bin`).
   */
  knownDirs?: (platform: NodeJS.Platform, env: NodeJS.ProcessEnv) => readonly string[];
}

export interface LocateOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  exists?: Exists;
  exec?: Exec;
  listDir?: ListDir;
  managedDirs?: ManagedToolDirs;
}

let managedDirsProvider: ManagedToolDirs | undefined;

/**
 * Extension point for the managed toolchain (M82): once a pinned toolchain is
 * downloaded, its bin directories are searched last, after anything the user
 * installed themselves. Pass `undefined` to unregister.
 */
export function setManagedToolDirsProvider(provider: ManagedToolDirs | undefined): void {
  managedDirsProvider = provider;
}

export function executableName(binary: string, platform: NodeJS.Platform): string {
  return platform === 'win32' ? `${binary}.exe` : binary;
}

// path.win32 / path.posix by target platform, so the joins are right even when
// a test runs on another host.
const pathFor = (platform: NodeJS.Platform): path.PlatformPath =>
  platform === 'win32' ? path.win32 : path.posix;

function configuredCandidates(spec: ToolSpec, configured: string, platform: NodeJS.Platform): string[] {
  const exe = executableName(spec.binary, platform);
  const lower = configured.toLowerCase();
  const namesBinary = lower.endsWith(spec.binary.toLowerCase())
    || (platform === 'win32' && lower.endsWith('.exe'));
  if (namesBinary) {
    return platform === 'win32' && !lower.endsWith('.exe') ? [configured, `${configured}.exe`] : [configured];
  }
  const dir = configured.replace(/[\\/]+$/, '');
  return [pathFor(platform).join(dir, exe)];
}

async function pathLookup(
  spec: ToolSpec,
  platform: NodeJS.Platform,
  exists: Exists,
  exec: Exec,
): Promise<string | undefined> {
  for (const name of spec.pathNames ?? [spec.binary]) {
    try {
      const out = await exec(platform === 'win32' ? 'where.exe' : 'which', [name]);
      // `where.exe` prints one match per line; `which` prints one path.
      const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      for (const line of platform === 'win32' ? lines : lines.slice(0, 1)) {
        if (await exists(line)) return line;
      }
    } catch { /* not on PATH under this name */ }
  }
  return undefined;
}

// Expands the first `*` segment of each directory into the matching
// subdirectories of its parent, newest (highest, numeric-aware) first.
async function expandDirs(
  dirs: readonly string[],
  listDir: ListDir,
  platform: NodeJS.Platform,
): Promise<string[]> {
  const p = pathFor(platform);
  const out: string[] = [];
  for (const dir of dirs) {
    const m = /^(.*?)[\\/]\*(?:[\\/](.*))?$/.exec(dir);
    if (!m) { out.push(dir); continue; }
    let entries: string[];
    try { entries = await listDir(m[1]!); } catch { continue; }
    entries.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const entry of entries) out.push(p.join(m[1]!, entry, m[2] ?? ''));
  }
  return out;
}

async function firstExisting(
  dirs: readonly string[],
  exe: string,
  platform: NodeJS.Platform,
  exists: Exists,
): Promise<string | undefined> {
  const p = pathFor(platform);
  for (const dir of dirs) {
    const candidate = p.join(dir, exe);
    if (await exists(candidate)) return candidate;
  }
  return undefined;
}

/** Finds `spec` in the order described at the top of this file, or `undefined`. */
export async function locateTool(
  spec: ToolSpec,
  configuredPath: string | undefined,
  opts: LocateOptions = {},
): Promise<string | undefined> {
  const platform = opts.platform ?? process.platform;
  const exists = opts.exists ?? defaultExists;
  const exec = opts.exec ?? defaultExec;
  const listDir = opts.listDir ?? defaultListDir;
  const env = opts.env ?? process.env;
  const exe = executableName(spec.binary, platform);

  if (configuredPath) {
    for (const candidate of configuredCandidates(spec, configuredPath, platform)) {
      if (await exists(candidate)) return candidate;
    }
  }

  const onPath = await pathLookup(spec, platform, exists, exec);
  if (onPath) return onPath;

  const known = await expandDirs(spec.knownDirs?.(platform, env) ?? [], listDir, platform);
  const atKnown = await firstExisting(known, exe, platform, exists);
  if (atKnown) return atKnown;

  const managed = await (opts.managedDirs ?? managedDirsProvider)?.(spec.binary);
  return managed ? firstExisting(managed, exe, platform, exists) : undefined;
}
