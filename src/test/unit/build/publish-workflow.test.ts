import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const wf = fs.readFileSync(path.join(__dirname, '../../../../.github/workflows/publish.yml'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../../package.json'), 'utf8'));

describe('publish workflow (FR-RLS-4)', () => {
  it('is manual only, so nothing is published by accident', () => {
    expect(wf).toMatch(/^on:\n  workflow_dispatch:/m);
    expect(wf).not.toMatch(/^\s+(push|pull_request|schedule|release):/m);
  });

  it('uses Trusted Publishing (OIDC) and stores no token', () => {
    expect(wf).toMatch(/^\s+id-token: write$/m);
    expect(wf).toContain('vsce publish --oidc');
    expect(wf).not.toMatch(/secrets\.|VSCE_PAT|--pat/);
  });

  it('builds the tag it was given, with the DaisySP submodule', () => {
    expect(wf).toContain('ref: ${{ inputs.tag }}');
    expect(wf).toMatch(/submodules: true/);
  });

  it('builds each platform on its own runner: Apple Silicon macOS and Windows (FR-WIN-PKG-1)', () => {
    expect(wf).toContain('"target":"darwin-arm64","os":"macos-latest"');
    expect(wf).toContain('"target":"win32-x64","os":"windows-latest"');
    expect(wf).toContain('runs-on: ${{ matrix.os }}');
  });

  it('lets the caller pick all platforms or a single one, defaulting to all', () => {
    expect(wf).toMatch(/platforms:[\s\S]*?type: choice[\s\S]*?- all[\s\S]*?- darwin-arm64[\s\S]*?- win32-x64[\s\S]*?default: all/);
    expect(wf).toContain('select(.target == $t)');
  });

  it('publishes pre-release packages built per platform', () => {
    expect(wf).toContain('npm run package -- --pre-release');
    expect(pkg.scripts.package).toContain('scripts/package-vsix.mjs');
    expect(wf).toContain('ds-ide-${{ matrix.target }}-*.vsix');
  });

  it('verifies every package before publishing any of them', () => {
    expect(wf.indexOf('verify:package')).toBeGreaterThan(-1);
    expect(wf.indexOf('verify:package')).toBeLessThan(wf.indexOf('vsce publish'));
    expect(wf).toMatch(/^  publish:\n    needs: \[select, build\]/m);
  });

  it('has a dry run that skips only the publish step, and it defaults to on', () => {
    expect(wf).toMatch(/dry_run:[\s\S]*?default: true/);
    expect(wf).toContain('if: ${{ !inputs.dry_run }}');
    expect(wf.indexOf('!inputs.dry_run')).toBeLessThan(wf.indexOf('vsce publish'));
  });

  it('runs in the Production environment, as the Marketplace policy requires', () => {
    expect(wf).toMatch(/^    environment: Production$/m);
    expect(wf.indexOf('environment: Production')).toBeGreaterThan(wf.indexOf('  publish:\n'));
  });
});
