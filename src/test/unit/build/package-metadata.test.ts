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

  it('engines.vscode is the tested version, and the README and CONTRIBUTING say the same (FR-PRE-5)', () => {
    expect(pkg.engines.vscode).toBe('^1.140.0');
    const readme = fs.readFileSync(path.join(__dirname, '../../../../README.md'), 'utf8');
    expect(readme).toContain('**VS Code** 1.140 or later');
    const contributing = fs.readFileSync(path.join(__dirname, '../../../../CONTRIBUTING.md'), 'utf8');
    expect(contributing).toMatch(/engines/);
  });

  it('is flagged as a preview and carries Marketplace-ready metadata (FR-MKT-1)', () => {
    expect(pkg.preview).toBe(true);
    expect(pkg.displayName).toBeTruthy();
    expect(pkg.description.length).toBeGreaterThan(20);
    expect(pkg.description.length).toBeLessThanOrEqual(200);
    expect(pkg.categories.length).toBeGreaterThan(0);
    for (const k of ['daisy seed', 'electro-smith', 'libdaisy', 'daisysp', 'audio', 'dsp', 'emulator', 'midi']) {
      expect(pkg.keywords).toContain(k);
    }
    expect(pkg.galleryBanner?.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(['dark', 'light']).toContain(pkg.galleryBanner?.theme);
  });

  it('the version has no semver pre-release suffix; the Marketplace pre-release track uses an odd minor instead (FR-MKT-1)', () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('the icon is a PNG of at least 128 x 128 pixels (FR-MKT-1)', () => {
    const buf = fs.readFileSync(path.join(__dirname, '../../../..', pkg.icon));
    expect(buf.subarray(1, 4).toString('ascii')).toBe('PNG');
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    expect(width).toBeGreaterThanOrEqual(128);
    expect(height).toBeGreaterThanOrEqual(128);
  });

  it('every viewsWelcome command exists in contributes.commands (FR-RCH-2)', () => {
    const ids = new Set((pkg.contributes?.commands ?? []).map((c: { command: string }) => c.command));
    const welcome = pkg.contributes?.viewsWelcome ?? [];
    expect(welcome.length).toBeGreaterThan(0);
    for (const w of welcome) {
      for (const m of String(w.contents).matchAll(/\(command:([^)\s]+)/g)) {
        expect(ids.has(m[1])).toBe(true);
      }
    }
  });

  it('the Daisy view is not hidden outside Daisy projects, so its welcome content can show (FR-RCH-2)', () => {
    const view = pkg.contributes.views.debug.find((v: { id: string }) => v.id === 'ds-ide.daisyView');
    expect(view.when).toBeUndefined();
  });

  it('contributes a Get started walkthrough whose steps link to real commands and files (FR-RCH-3)', () => {
    const ids = new Set((pkg.contributes?.commands ?? []).map((c: { command: string }) => c.command));
    const walk = (pkg.contributes?.walkthroughs ?? []).find((w: { id: string }) => w.id === 'ds-ide.getStarted');
    expect(walk).toBeDefined();
    expect(walk.steps.length).toBeGreaterThanOrEqual(4);
    for (const step of walk.steps) {
      expect(typeof step.title).toBe('string');
      expect(fs.existsSync(path.join(__dirname, '../../../..', step.media.markdown))).toBe(true);
      const md = fs.readFileSync(path.join(__dirname, '../../../..', step.media.markdown), 'utf8');
      for (const m of `${step.description}\n${md}`.matchAll(/\(command:([^)\s?]+)/g)) {
        expect(ids.has(m[1])).toBe(true);
      }
    }
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

describe('editor-title run button (FR-TRN-3)', () => {
  const commands: Array<{ command: string; title: string; icon?: string }> = pkg.contributes?.commands ?? [];
  const runMenu: Array<{ command: string; when?: string; group?: string }> = pkg.contributes?.menus?.['editor/title/run'] ?? [];

  it.each(['ds-ide.runEffect', 'ds-ide.debugEffect', 'ds-ide.buildAndFlash'])('declares %s with an icon', (id) => {
    const cmd = commands.find((c) => c.command === id);
    expect(cmd).toBeDefined();
    expect(cmd!.icon).toMatch(/^\$\(.+\)$/);
  });

  it('titles the run/debug actions as the requirement names them', () => {
    expect(commands.find((c) => c.command === 'ds-ide.runEffect')!.title).toBe('Run Daisy Effect');
    expect(commands.find((c) => c.command === 'ds-ide.debugEffect')!.title).toBe('Debug Daisy Effect');
    expect(commands.find((c) => c.command === 'ds-ide.buildAndFlash')!.title).toBe('Build & Flash to Daisy Seed');
  });

  it('contributes Run, Debug and Build & Flash to editor/title/run, in that order', () => {
    expect(runMenu.map((m) => m.command)).toEqual(['ds-ide.runEffect', 'ds-ide.debugEffect', 'ds-ide.buildAndFlash']);
  });

  it('shows them only on the effect source of a Daisy project', () => {
    for (const item of runMenu) {
      expect(item.when).toBe('ds-ide.isDaisyProject && ds-ide.isEffectSource');
    }
  });

  it('keeps the Run / Debug shortcuts shown in the dropdown (Ctrl+F5 / F5) — no new keybindings', () => {
    const kbs: Array<{ command: string }> = pkg.contributes?.keybindings ?? [];
    expect(kbs.map((k) => k.command)).not.toContain('ds-ide.runEffect');
    expect(kbs.map((k) => k.command)).not.toContain('ds-ide.debugEffect');
  });
});

describe('Daisy view in Run and Debug (FR-TRN-4)', () => {
  const commands: Array<{ command: string; icon?: string }> = pkg.contributes?.commands ?? [];
  const viewTitle: Array<{ command: string; when?: string; group?: string }> = pkg.contributes?.menus?.['view/title'] ?? [];
  const viewItem: Array<{ command: string; when?: string; group?: string }> = pkg.contributes?.menus?.['view/item/context'] ?? [];
  const inView = (cmd: string) => viewTitle.find((m) => m.command === cmd && m.when?.includes('view == ds-ide.daisyView'));

  it('contributes ds-ide.daisyView to the debug container, in every workspace (FR-RCH-2)', () => {
    expect(pkg.contributes.views.debug).toContainEqual({ id: 'ds-ide.daisyView', name: 'Daisy' });
  });

  it('declares ds-ide.revealDaisyView (the state item\'s click action, FR-TRN-5)', () => {
    expect(commands.find((c) => c.command === 'ds-ide.revealDaisyView')).toBeDefined();
  });

  it.each(['ds-ide.stopEffect', 'ds-ide.cancelTransport', 'ds-ide.restartEffect', 'ds-ide.refreshBoard', 'ds-ide.showEmulatorOutput'])(
    'declares %s with an icon', (id) => {
      expect(commands.find((c) => c.command === id)?.icon).toMatch(/^\$\(.+\)$/);
    });

  it('shows Run / Debug only when nothing is running or building', () => {
    for (const cmd of ['ds-ide.runEffect', 'ds-ide.debugEffect']) {
      expect(inView(cmd)?.when).toContain('ds-ide.transportPhase =~ /^(stopped|buildFailed|crashed)$/');
      expect(inView(cmd)?.group).toMatch(/^navigation/);
    }
  });

  it('shows Stop while live and Cancel while building / deploying', () => {
    expect(inView('ds-ide.stopEffect')?.when).toContain('ds-ide.transportPhase =~ /^(running|debugging|paused)$/');
    expect(inView('ds-ide.cancelTransport')?.when).toContain('ds-ide.transportPhase =~ /^(building|deploying)$/');
  });

  it('always offers Build & Flash, Refresh and Show Emulator Output', () => {
    for (const cmd of ['ds-ide.buildAndFlash', 'ds-ide.refreshBoard', 'ds-ide.showEmulatorOutput']) {
      expect(inView(cmd)?.when).toBe('view == ds-ide.daisyView');
      expect(inView(cmd)?.group).toMatch(/^navigation/);
    }
  });

  it('keeps build-for-hardware-only reachable from the view overflow menu', () => {
    const item = inView('ds-ide.buildHardware');
    expect(item).toBeDefined();
    expect(item!.group).not.toMatch(/^navigation/);
  });

  it('puts Restart to apply inline on the Source changed row', () => {
    expect(viewItem).toContainEqual({
      command: 'ds-ide.restartEffect',
      when: 'view == ds-ide.daisyView && viewItem == daisy.stale',
      group: 'inline',
    });
  });
});

describe('workspace trust (FR-REL-1)', () => {
  it('declares explicitly that untrusted workspaces are not supported, with a reason', () => {
    const cap = pkg.capabilities?.untrustedWorkspaces;
    expect(cap).toBeDefined();
    expect(cap.supported).toBe(false);
    expect(typeof cap.description).toBe('string');
    expect(cap.description.trim().length).toBeGreaterThan(20);
  });

  it('tells the user to trust the folder in the README quick start', () => {
    const readme = fs.readFileSync(path.join(__dirname, '../../../../README.md'), 'utf8');
    const quickstart = readme.match(/^## Quickstart[\s\S]*?(?=^## )/m)?.[0] ?? '';
    expect(quickstart).toMatch(/trust/i);
  });
});

describe('activation on opening a Daisy project (FR-REL-3)', () => {
  const events: string[] = pkg.activationEvents ?? [];

  it('activates when the effect source detection would find a .cpp at the root, src/ or source/', () => {
    expect(events).toContain('workspaceContains:*.cpp');
    expect(events).toContain('workspaceContains:src/*.cpp');
    expect(events).toContain('workspaceContains:source/*.cpp');
  });

  it('does not activate on every startup or with a wildcard', () => {
    expect(events).not.toContain('*');
    expect(events).not.toContain('onStartupFinished');
  });
});
