import * as fs from 'fs';
import * as path from 'path';

// FR-WIN-TCH-4: the shape of resources/windows-toolchain.json, the pinned list of
// archives the Windows toolchain is downloaded from. The file is maintained with
// scripts/update-toolchain-manifest.mjs (see docs/toolchain-mirror.md).

export interface ToolchainComponent {
  /** Directory name under the toolchain directory, and the name used in messages. */
  name: string;
  version: string;
  url: string;
  /** A copy under the ds-ide release assets, tried when `url` fails. */
  mirrorUrl: string;
  /** Our own SHA-256 of the archive, lower-case hex. */
  sha256: string;
  /** Archive size in bytes. */
  size: number;
  /** Bytes once extracted (for the free-disk-space check). */
  extractedSize: number;
  /** Directory the archive extracts into; `{version}` is substituted. `""` for a flat archive. */
  archiveRoot: string;
  /** Directories, relative to the component, to put on PATH. */
  binDirs: string[];
  /** Files, relative to the component, that must exist after extraction. */
  requiredFiles: string[];
  /** Directories, relative to the component, deleted after extraction (unused target sysroots). */
  prune?: string[];
}

export interface ToolchainManifest {
  schemaVersion: 1;
  /** Names the storage directory and the mirror release tag. */
  toolchainVersion: string;
  components: ToolchainComponent[];
}

export const MANIFEST_RELATIVE_PATH = path.join('resources', 'windows-toolchain.json');

export const resolveArchiveRoot = (c: ToolchainComponent): string => c.archiveRoot.replace('{version}', c.version);

/** The file name an archive has upstream, on the mirror and in a local archive folder. */
export const archiveFileName = (c: ToolchainComponent): string => path.posix.basename(new URL(c.url).pathname);

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** Parses and sanity-checks the manifest. The full rules live in the maintenance script's `check`. */
export function parseManifest(text: string): ToolchainManifest {
  const m = JSON.parse(text) as Partial<ToolchainManifest>;
  if (m.schemaVersion !== 1) throw new Error('toolchain manifest: unsupported schemaVersion');
  if (typeof m.toolchainVersion !== 'string' || !/^\d+$/.test(m.toolchainVersion)) {
    throw new Error('toolchain manifest: toolchainVersion must be an integer string');
  }
  if (!Array.isArray(m.components) || m.components.length === 0) throw new Error('toolchain manifest: no components');
  for (const c of m.components as Partial<ToolchainComponent>[]) {
    const ok = typeof c.name === 'string' && typeof c.version === 'string'
      && typeof c.url === 'string' && c.url.startsWith('https://')
      && typeof c.mirrorUrl === 'string' && c.mirrorUrl.startsWith('https://')
      && typeof c.sha256 === 'string' && /^[0-9a-f]{64}$/.test(c.sha256)
      && Number.isInteger(c.size) && Number.isInteger(c.extractedSize)
      && typeof c.archiveRoot === 'string' && isStringArray(c.binDirs) && isStringArray(c.requiredFiles)
      && (c.prune === undefined || isStringArray(c.prune));
    if (!ok) throw new Error(`toolchain manifest: invalid component ${String(c.name)}`);
  }
  return m as ToolchainManifest;
}

export async function loadManifest(
  extensionPath: string,
  readFile: (p: string, enc: 'utf8') => Promise<string> = fs.promises.readFile,
): Promise<ToolchainManifest> {
  return parseManifest(await readFile(path.join(extensionPath, MANIFEST_RELATIVE_PATH), 'utf8'));
}
