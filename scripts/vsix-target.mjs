// FR-WIN-MIDI-1 / FR-WIN-PKG-1: single source of truth for which OS/arch the
// extension ships for and how the 'midi' native addon is rebuilt for it.
// Plain ESM so it runs on Windows and macOS with nothing but Node.js.

// Supported shipping targets, keyed by process.platform. Each platform maps to
// exactly one arch: macOS is arm64-only (even from a Rosetta/x64 shell, which
// would otherwise build an x64 addon); Windows is x64-only.
const TARGETS = {
  darwin: 'arm64',
  win32: 'x64',
};

/**
 * @param {string} platform process.platform
 * @param {string} arch process.arch
 * @returns {{platform: string, arch: string, vsceTarget: string} | null}
 *   null when the platform/arch combination has no shipped addon.
 */
export function resolveTarget(platform, arch) {
  const targetArch = TARGETS[platform];
  if (!targetArch) return null;
  // Windows has no cross-arch fallback: an arm64 Windows shell is unsupported.
  if (platform === 'win32' && arch !== targetArch) return null;
  return { platform, arch: targetArch, vsceTarget: `${platform}-${targetArch}` };
}

/** Arguments for `@electron/rebuild` that rebuild only 'midi' against Electron's ABI. */
export function buildRebuildArgs({ electronVersion, arch, repoRoot }) {
  return ['--version', electronVersion, '-f', '-w', 'midi', '-m', repoRoot, '--arch', arch];
}

// CLI: `node scripts/vsix-target.mjs` prints the vsce target for this machine
// (used by verify-vsix.sh); exits 1 when the platform is unsupported.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const t = resolveTarget(process.platform, process.arch);
  if (!t) process.exit(1);
  console.log(t.vsceTarget);
}
