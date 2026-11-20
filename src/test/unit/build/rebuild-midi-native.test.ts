import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';

const scriptsDir = path.join(__dirname, '../../../../scripts');

// The rebuild script is plain ESM (.mjs) so it runs on any OS with only Node.
async function load(): Promise<{
  resolveTarget: (platform: string, arch: string) => { platform: string; arch: string; vsceTarget: string } | null;
  buildRebuildArgs: (opts: { electronVersion: string; arch: string; repoRoot: string }) => string[];
}> {
  return import(pathToFileURL(path.join(scriptsDir, 'vsix-target.mjs')).href);
}

describe('platform targets (FR-WIN-MIDI-1, FR-WIN-PKG-1)', () => {
  it('maps macOS to darwin-arm64 regardless of the shell arch (Rosetta)', async () => {
    const { resolveTarget } = await load();
    expect(resolveTarget('darwin', 'x64')).toEqual({ platform: 'darwin', arch: 'arm64', vsceTarget: 'darwin-arm64' });
    expect(resolveTarget('darwin', 'arm64')?.vsceTarget).toBe('darwin-arm64');
  });

  it('maps Windows to win32-x64', async () => {
    const { resolveTarget } = await load();
    expect(resolveTarget('win32', 'x64')).toEqual({ platform: 'win32', arch: 'x64', vsceTarget: 'win32-x64' });
  });

  it('returns null for unsupported platforms', async () => {
    const { resolveTarget } = await load();
    expect(resolveTarget('linux', 'x64')).toBeNull();
    expect(resolveTarget('win32', 'arm64')).toBeNull();
  });

  it('builds @electron/rebuild args for the midi module and the target arch', async () => {
    const { buildRebuildArgs } = await load();
    expect(buildRebuildArgs({ electronVersion: '43.7.3', arch: 'x64', repoRoot: '/r' })).toEqual([
      '--version', '43.7.3', '-f', '-w', 'midi', '-m', '/r', '--arch', 'x64',
    ]);
  });
});

describe('rebuild wiring (FR-WIN-MIDI-1)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(scriptsDir, '../package.json'), 'utf8'));
  it('rebuild:native runs the Node script, not Bash', () => {
    expect(pkg.scripts['rebuild:native']).toBe('node scripts/rebuild-midi-native.mjs');
    expect(fs.existsSync(path.join(scriptsDir, 'rebuild-midi-native.sh'))).toBe(false);
  });
});
