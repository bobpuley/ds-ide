import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../../package.json'), 'utf8'));
const changelog = fs.readFileSync(path.join(__dirname, '../../../../CHANGELOG.md'), 'utf8');

describe('package.json marketplace metadata (FR-QA-EXT-6)', () => {
  it('version matches the latest CHANGELOG entry', () => {
    const latest = changelog.match(/^## (\S+)/m)?.[1];
    expect(latest).toBeDefined();
    expect(pkg.version).toBe(latest);
  });

  it('declares an icon whose asset file exists', () => {
    expect(typeof pkg.icon).toBe('string');
    const iconPath = path.join(__dirname, '../../../..', pkg.icon);
    expect(fs.existsSync(iconPath)).toBe(true);
  });

  it('does not reference any icon-theme variant file that is missing from media/', () => {
    const mediaFiles = new Set(fs.readdirSync(path.join(__dirname, '../../../../media')));
    const iconRefs: string[] = [];
    for (const container of pkg.contributes?.viewsContainers?.activitybar ?? []) {
      if (container.icon) iconRefs.push(container.icon);
    }
    if (pkg.icon) iconRefs.push(pkg.icon);
    for (const ref of iconRefs) {
      expect(mediaFiles.has(path.basename(ref))).toBe(true);
    }
  });

  it('leaves no orphaned icon-theme variant files in media/ unreferenced by package.json', () => {
    const referenced = new Set<string>();
    for (const container of pkg.contributes?.viewsContainers?.activitybar ?? []) {
      if (container.icon) referenced.add(path.basename(container.icon));
    }
    if (pkg.icon) referenced.add(path.basename(pkg.icon));

    const mediaDir = path.join(__dirname, '../../../../media');
    const iconFiles = fs.readdirSync(mediaDir).filter(f => /-icon-(dark|light)\.svg$/.test(f));
    for (const f of iconFiles) {
      expect(referenced.has(f)).toBe(true);
    }
  });

  it('scopes ds-ide keybindings to Daisy projects via a when clause', () => {
    const keybindings = pkg.contributes?.keybindings ?? [];
    expect(keybindings.length).toBeGreaterThan(0);
    for (const kb of keybindings) {
      expect(kb.when).toBeTruthy();
    }
  });
});

describe('machine/workspace-specific setting scopes (FR-QA-EXT-8)', () => {
  const props = pkg.contributes?.configuration?.properties ?? {};

  it('declares armToolchainPath as machine-overridable, not window/Settings-Sync scope', () => {
    expect(props['ds-ide.armToolchainPath'].scope).toBe('machine-overridable');
  });

  it('documents effectSource\'s scope/resolution order and armToolchainPath\'s machine scope', () => {
    expect(props['ds-ide.effectSource'].markdownDescription).toMatch(/scope/i);
    expect(props['ds-ide.armToolchainPath'].markdownDescription).toMatch(/machine/i);
  });
});

describe('debug contribution discoverability (FR-QA-EXT-9)', () => {
  const debuggers: Array<{ type: string; label: string }> = pkg.contributes?.debuggers ?? [];

  it('marks daisy-debug as internal/attach-only in its label, since it is never user-selected', () => {
    const daisyDebug = debuggers.find(d => d.type === 'daisy-debug');
    expect(daisyDebug).toBeDefined();
    expect(daisyDebug!.label).toMatch(/internal/i);
  });
});
