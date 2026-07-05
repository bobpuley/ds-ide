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
