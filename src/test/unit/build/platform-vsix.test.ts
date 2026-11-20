import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';

const root = path.join(__dirname, '../../../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

describe('per-platform VSIX packaging (FR-WIN-PKG-1)', () => {
  it('package-vsix builds vsce args for the current platform target, passing extra flags through', async () => {
    const mod = (await import(pathToFileURL(path.join(root, 'scripts/package-vsix.mjs')).href)) as {
      buildVsceArgs: (target: { vsceTarget: string }, extra: string[]) => string[];
    };
    expect(mod.buildVsceArgs({ vsceTarget: 'win32-x64' }, ['--pre-release'])).toEqual([
      '--yes', '@vscode/vsce', 'package', '--target', 'win32-x64', '--pre-release',
    ]);
  });

  it('npm run package goes through package-vsix, with no hard-coded darwin target', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.scripts.package).toContain('node scripts/package-vsix.mjs');
    expect(pkg.scripts.package).not.toContain('darwin-arm64');
  });

  describe('package.yml', () => {
    const wf = read('.github/workflows/package.yml');
    it('builds on a macOS and a Windows runner', () => {
      expect(wf).toMatch(/macos-latest/);
      expect(wf).toMatch(/windows-latest/);
    });
    it('rebuilds once per target (one matrix leg each), packages, smoke-tests and records the size', () => {
      expect(wf).toContain('npm run package');
      expect(wf).toContain('npm run verify:package');
      expect(wf).toContain('GITHUB_STEP_SUMMARY');
    });
    it('initialises the DaisySP submodule and never publishes', () => {
      expect(wf).toMatch(/submodules: true/);
      expect(wf).not.toContain('vsce publish');
    });
  });

  describe('verify-vsix.sh', () => {
    const sh = read('scripts/verify-vsix.sh');
    it('derives the platform target instead of assuming darwin-arm64', () => {
      expect(sh).not.toContain('--target darwin-arm64');
      expect(sh).toContain('vsix-target.mjs');
    });
    it('asserts the manifest targets the platform it built for', () => {
      expect(sh).toContain('TargetPlatform=\\"${VSCE_TARGET}\\"');
    });
  });

  it('the Electron ABI target file is shared by every platform', () => {
    expect(fs.existsSync(path.join(root, 'scripts/electron-target-version.txt'))).toBe(true);
    expect(read('scripts/rebuild-midi-native.mjs')).toContain('electron-target-version.txt');
    expect(read('scripts/verify-vsix.sh')).toContain('electron-target-version.txt');
  });

  it('the VSIX carries the matching midi.node and the emulator sources', () => {
    const ignore = read('.vscodeignore');
    expect(ignore).toContain('!node_modules/midi/build/Release/midi.node');
    expect(ignore).toMatch(/emulator\/\*\*\/build\/\*\*/);
    expect(ignore).not.toMatch(/^emulator\/\*\*$/m);
  });
});

describe('workflow triggers after the merge to main', () => {
  for (const f of ['package.yml', 'windows-ci.yml']) {
    it(`${f} runs on main, not on the retired feat/windows-support branch`, () => {
      const wf = fs.readFileSync(path.join(root, '.github/workflows', f), 'utf8');
      expect(wf).toMatch(/branches: \[main\]/);
      expect(wf).not.toContain('feat/windows-support');
    });
  }
});
