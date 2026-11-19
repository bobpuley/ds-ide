import { describe, it, expect, vi, afterEach } from 'vitest';
import { locateTool, setManagedToolDirsProvider } from '../../../hardware/tool-locator';
import * as fs from 'fs';
import * as path from 'path';
import {
  ManagedToolchainService,
  consentMessage,
  describeFailure,
  formatBytes,
  progressFraction,
  type ToolchainUi,
  type FailureAction,
} from '../../../toolchain/managed-toolchain-ui';
import { ManagedToolchainError, type InstalledToolchain, type ProgressEvent } from '../../../toolchain/managed-toolchain';
import { parseManifest } from '../../../toolchain/manifest';

// FR-WIN-TCH-4: consent, progress and recovery. The user interface is injected,
// so the whole flow runs without VS Code.

const manifest = parseManifest(fs.readFileSync(path.join(__dirname, '../../../../resources/windows-toolchain.json'), 'utf8'));
const installed: InstalledToolchain = { dir: 'C:\\store\\1', toolchainVersion: '1', binDirs: ['C:\\store\\1\\llvm-mingw\\bin'] };

interface FakeUi {
  confirmDownload: ReturnType<typeof vi.fn>;
  withProgress: ReturnType<typeof vi.fn>;
  pickArchiveFolder: ReturnType<typeof vi.fn>;
  showFailure: ReturnType<typeof vi.fn>;
  showInstalled: ReturnType<typeof vi.fn>;
  reports: Array<[string, number]>;
  token: { isCancellationRequested: boolean; fire: () => void };
}

function makeUi(over: Partial<Record<'confirm' | 'pick' | 'failure', unknown>> = {}): FakeUi {
  const reports: Array<[string, number]> = [];
  const listeners: Array<() => void> = [];
  const token = {
    isCancellationRequested: false,
    onCancellationRequested: (l: () => void) => { listeners.push(l); return { dispose: () => undefined }; },
    fire: () => { token.isCancellationRequested = true; listeners.forEach((l) => l()); },
  };
  return {
    confirmDownload: vi.fn(async () => ('confirm' in over ? over.confirm : 'download')),
    withProgress: vi.fn(async (_title: string, run: (r: (m: string, p: number) => void, t: typeof token) => Promise<unknown>) =>
      run((m, p) => reports.push([m, p]), token)),
    pickArchiveFolder: vi.fn(async () => ('pick' in over ? over.pick : 'D:\\archives')),
    showFailure: vi.fn(async () => ('failure' in over ? over.failure : undefined)),
    showInstalled: vi.fn(),
    reports,
    token,
  } as unknown as FakeUi;
}

function makeService(ui: unknown, over: { find?: unknown; install?: unknown } = {}) {
  const find = vi.fn(over.find as () => Promise<InstalledToolchain | undefined> ?? (async () => undefined));
  const install = vi.fn((over.install as () => Promise<InstalledToolchain>) ?? (async () => installed));
  const service = new ManagedToolchainService(
    { storageDir: 'C:\\store', extensionPath: 'C:\\ext' }, ui as ToolchainUi,
    { loadManifest: async () => manifest, find, install } as never,
  );
  return { service, find, install };
}

describe('formatBytes()', () => {
  it('uses decimal megabytes, rounded, and gigabytes from one thousand', () => {
    expect(formatBytes(247_715_639)).toBe('248 MB');
    expect(formatBytes(1_500_000_000)).toBe('1.5 GB');
    expect(formatBytes(300_000)).toBe('0.3 MB');
  });
});

describe('consentMessage()', () => {
  const m = consentMessage(manifest);
  it('states the download size and the disk space needed', () => {
    expect(m).toContain('248 MB');
    expect(m).toContain('902 MB');
  });
  it('says what is being installed, from where, and that nothing is installed system-wide', () => {
    expect(m).toMatch(/clang/i);
    expect(m).toMatch(/CMake/);
    expect(m).toMatch(/Ninja/);
    expect(m).toContain('github.com');
    expect(m).toMatch(/system-wide/i);
  });
});

describe('describeFailure()', () => {
  const err = (kind: ConstructorParameters<typeof ManagedToolchainError>[0], extra = {}) =>
    new ManagedToolchainError(kind, 'x', extra);

  it('offline: says the connection / proxy, offers retry and local archives', () => {
    const d = describeFailure(err('offline', { component: 'cmake' }), manifest, 'C:\\store');
    expect(d.message).toMatch(/connection|proxy/i);
    expect(d.actions).toEqual(['retry', 'local']);
  });

  it('http: offers retry and local archives', () => {
    const d = describeFailure(err('http', { detail: 'HTTP 404' }), manifest, 'C:\\store');
    expect(d.message).toContain('HTTP 404');
    expect(d.actions).toEqual(['retry', 'local']);
  });

  it('hash-mismatch: says it was discarded and nothing was installed', () => {
    const d = describeFailure(err('hash-mismatch', { component: 'llvm-mingw' }), manifest, 'C:\\store');
    expect(d.message).toContain('llvm-mingw');
    expect(d.message).toMatch(/discarded|rejected/i);
    expect(d.message).toMatch(/nothing was installed/i);
    expect(d.actions).toEqual(['retry', 'local']);
  });

  it('disk-full: gives needed and available space and the folder', () => {
    const d = describeFailure(err('disk-full', { requiredBytes: 902_000_000, availableBytes: 400_000_000 }), manifest, 'C:\\store');
    expect(d.message).toContain('902 MB');
    expect(d.message).toContain('400 MB');
    expect(d.message).toContain('C:\\store');
    expect(d.actions).toEqual(['retry']);
  });

  it('disk-full without figures (the disk filled up during the work) still says so', () => {
    expect(describeFailure(err('disk-full', { component: 'cmake' }), manifest, 'C:\\store').message).toMatch(/disk/i);
  });

  it('extract-failed: mentions the antivirus possibility and the detail', () => {
    const d = describeFailure(err('extract-failed', { component: 'cmake', detail: 'tar: boom' }), manifest, 'C:\\store');
    expect(d.message).toContain('tar: boom');
    expect(d.message).toMatch(/antivirus/i);
    expect(d.actions).toEqual(['retry']);
  });

  it('incomplete: names the missing files', () => {
    const d = describeFailure(err('incomplete', { component: 'llvm-mingw', detail: 'bin/lldb-dap.exe' }), manifest, 'C:\\store');
    expect(d.message).toContain('bin/lldb-dap.exe');
  });

  it('missing-archive: names the expected file and offers to choose another folder', () => {
    const d = describeFailure(err('missing-archive', { detail: 'expected ninja-win.zip in D:\\a' }), manifest, 'C:\\store');
    expect(d.message).toContain('ninja-win.zip');
    expect(d.actions).toEqual(['local']);
  });

  it('an unexpected error shows its detail and offers retry', () => {
    const d = describeFailure(new Error('weird'), manifest, 'C:\\store');
    expect(d.message).toContain('weird');
    expect(d.actions).toEqual(['retry']);
  });
});

describe('progressFraction()', () => {
  const ev = (p: Partial<ProgressEvent>): ProgressEvent =>
    ({ phase: 'download', component: 'a', index: 0, count: 2, ...p });

  it('grows through the phases of one component, inside its share', () => {
    const d1 = progressFraction(ev({ receivedBytes: 50, totalBytes: 100 }));
    const v = progressFraction(ev({ phase: 'verify' }));
    const x = progressFraction(ev({ phase: 'extract' }));
    expect(d1).toBeGreaterThan(0);
    expect(v).toBeGreaterThan(d1);
    expect(x).toBeGreaterThan(v);
    expect(x).toBeLessThan(0.5);
  });

  it('the second component starts where the first ended', () => {
    expect(progressFraction(ev({ index: 1, receivedBytes: 0, totalBytes: 100 }))).toBeCloseTo(0.5, 5);
  });

  it('an unknown total counts as no download progress yet', () => {
    expect(progressFraction(ev({ receivedBytes: 40 }))).toBe(0);
  });

  it('finalize is complete', () => {
    expect(progressFraction(ev({ phase: 'finalize', index: 1 }))).toBe(1);
  });
});

describe('ManagedToolchainService.offer()', () => {
  it('does not ask when a toolchain is already installed', async () => {
    const ui = makeUi();
    const { service, install } = makeService(ui, { find: async () => installed });
    expect(await service.offer()).toBe(true);
    expect(ui.confirmDownload).not.toHaveBeenCalled();
    expect(install).not.toHaveBeenCalled();
  });

  it('shows the consent message with the sizes before downloading anything', async () => {
    const ui = makeUi();
    const { service } = makeService(ui);
    await service.offer();
    expect(ui.confirmDownload).toHaveBeenCalledWith(expect.stringContaining('248 MB'));
  });

  it('downloads after consent, reports progress, and says it is done', async () => {
    const ui = makeUi();
    const install = vi.fn(async (opts: { onProgress?: (e: ProgressEvent) => void }) => {
      opts.onProgress?.({ phase: 'download', component: 'llvm-mingw', index: 0, count: 3, receivedBytes: 95_000_000, totalBytes: 191_000_000 });
      opts.onProgress?.({ phase: 'extract', component: 'llvm-mingw', index: 0, count: 3 });
      return installed;
    });
    const { service } = makeService(ui, { install });
    expect(await service.offer()).toBe(true);
    expect(install).toHaveBeenCalledWith(expect.objectContaining({ storageDir: 'C:\\store', manifest }));
    expect(ui.showInstalled).toHaveBeenCalledOnce();
    const messages = ui.reports.map(([m]) => m).join(' | ');
    expect(messages).toMatch(/Downloading llvm-mingw/);
    expect(messages).toMatch(/95 MB of 191 MB/);
    expect(messages).toMatch(/Unpacking llvm-mingw/);
    const percents = ui.reports.map(([, p]) => p);
    expect(percents).toEqual([...percents].sort((a, b) => a - b));
  });

  it('hands the progress token to the installer, so the notification\'s Cancel stops it', async () => {
    const ui = makeUi();
    const install = vi.fn(async (opts: { token?: unknown }) => { expect(opts.token).toBe(ui.token); return installed; });
    await makeService(ui, { install }).service.offer();
    expect(install).toHaveBeenCalled();
  });

  it('does nothing when the user declines, and does not ask again this session', async () => {
    const ui = makeUi({ confirm: undefined });
    const { service, install } = makeService(ui);
    expect(await service.offer()).toBe(false);
    expect(await service.offer()).toBe(false);
    expect(ui.confirmDownload).toHaveBeenCalledOnce();
    expect(install).not.toHaveBeenCalled();
  });

  it('cancelling the download is not an error: no message, and false', async () => {
    const ui = makeUi();
    const install = vi.fn(async () => { throw new ManagedToolchainError('cancelled', 'cancelled'); });
    const { service } = makeService(ui, { install });
    expect(await service.offer()).toBe(false);
    expect(ui.showFailure).not.toHaveBeenCalled();
    expect(ui.showInstalled).not.toHaveBeenCalled();
  });

  it('shows a clear message on failure and retries when asked', async () => {
    const ui = makeUi({ failure: 'retry' });
    const install = vi.fn()
      .mockRejectedValueOnce(new ManagedToolchainError('offline', 'offline'))
      .mockResolvedValueOnce(installed);
    const { service } = makeService(ui, { install });
    expect(await service.offer()).toBe(true);
    expect(install).toHaveBeenCalledTimes(2);
    expect(ui.showFailure).toHaveBeenCalledWith(expect.stringMatching(/connection|proxy/i), ['retry', 'local']);
    expect(ui.confirmDownload).toHaveBeenCalledOnce();
  });

  it('gives up quietly when the user does not retry', async () => {
    const ui = makeUi({ failure: undefined });
    const install = vi.fn(async () => { throw new ManagedToolchainError('http', 'x', { detail: 'HTTP 503' }); });
    const { service } = makeService(ui, { install });
    expect(await service.offer()).toBe(false);
    expect(install).toHaveBeenCalledTimes(1);
  });

  it('after a failure, "install from local archive" asks for a folder and installs from it', async () => {
    const ui = makeUi({ failure: 'local' });
    const install = vi.fn()
      .mockRejectedValueOnce(new ManagedToolchainError('offline', 'offline'))
      .mockResolvedValueOnce(installed);
    const { service } = makeService(ui, { install });
    expect(await service.offer()).toBe(true);
    expect(ui.pickArchiveFolder).toHaveBeenCalledOnce();
    expect(install).toHaveBeenLastCalledWith(expect.objectContaining({ localArchiveDir: 'D:\\archives' }));
  });

  it('the consent prompt can go straight to local archives', async () => {
    const ui = makeUi({ confirm: 'local' });
    const { service, install } = makeService(ui);
    expect(await service.offer()).toBe(true);
    expect(install).toHaveBeenCalledWith(expect.objectContaining({ localArchiveDir: 'D:\\archives' }));
  });

  it('two requests at once share one prompt and one download', async () => {
    const ui = makeUi();
    const { service, install } = makeService(ui);
    const [a, b] = await Promise.all([service.offer(), service.offer()]);
    expect([a, b]).toEqual([true, true]);
    expect(ui.confirmDownload).toHaveBeenCalledOnce();
    expect(install).toHaveBeenCalledOnce();
  });
});

describe('ManagedToolchainService.installFromLocalArchive() (air-gapped machines)', () => {
  it('asks for the folder, naming the files it expects, and installs from it', async () => {
    const ui = makeUi();
    const { service, install } = makeService(ui);
    expect(await service.installFromLocalArchive()).toBe(true);
    const prompt = ui.pickArchiveFolder.mock.calls[0]![0] as string;
    for (const name of ['llvm-mingw-20261117-ucrt-x86_64.zip', 'cmake-4.5.0-windows-x86_64.zip', 'ninja-win.zip']) {
      expect(prompt).toContain(name);
    }
    expect(install).toHaveBeenCalledWith(expect.objectContaining({ localArchiveDir: 'D:\\archives' }));
    expect(ui.confirmDownload).not.toHaveBeenCalled();
  });

  it('does nothing when the folder dialog is dismissed', async () => {
    const ui = makeUi({ pick: undefined });
    const { service, install } = makeService(ui);
    expect(await service.installFromLocalArchive()).toBe(false);
    expect(install).not.toHaveBeenCalled();
  });

  it('a missing archive is reported by name, and the user can pick another folder', async () => {
    const ui = makeUi({ failure: 'local' });
    const install = vi.fn()
      .mockRejectedValueOnce(new ManagedToolchainError('missing-archive', 'x', { detail: 'expected ninja-win.zip in D:\\archives' }))
      .mockResolvedValueOnce(installed);
    const { service } = makeService(ui, { install });
    expect(await service.installFromLocalArchive()).toBe(true);
    expect(ui.showFailure).toHaveBeenCalledWith(expect.stringContaining('ninja-win.zip'), ['local']);
    expect(ui.pickArchiveFolder).toHaveBeenCalledTimes(2);
  });

  it('works even after the user declined the download prompt earlier', async () => {
    const ui = makeUi({ confirm: undefined });
    const { service } = makeService(ui);
    await service.offer();
    expect(await service.installFromLocalArchive()).toBe(true);
  });
});

describe('FailureAction', () => {
  it('is retry or local', () => {
    const a: FailureAction[] = ['retry', 'local'];
    expect(a).toHaveLength(2);
  });
});

describe('ManagedToolchainService.installFromCommand() (the "Install Windows Toolchain" command)', () => {
  it('says so when a toolchain is already installed, without asking or downloading', async () => {
    const ui = makeUi();
    const { service, install } = makeService(ui, { find: async () => installed });
    expect(await service.installFromCommand()).toBe(true);
    expect(ui.showInstalled).toHaveBeenCalledWith(expect.stringMatching(/already installed/i));
    expect(ui.confirmDownload).not.toHaveBeenCalled();
    expect(install).not.toHaveBeenCalled();
  });

  it('asks again even if the prompt was declined earlier in the session', async () => {
    const ui = makeUi({ confirm: undefined });
    const { service } = makeService(ui);
    await service.offer();
    await service.installFromCommand();
    expect(ui.confirmDownload).toHaveBeenCalledTimes(2);
  });

  it('downloads after consent', async () => {
    const ui = makeUi();
    const { service, install } = makeService(ui);
    expect(await service.installFromCommand()).toBe(true);
    expect(install).toHaveBeenCalledOnce();
  });
});

describe('ManagedToolchainService as a tool source (FR-WIN-TCH-5)', () => {
  afterEach(() => setManagedToolDirsProvider(undefined));
  const lookup = (exists: (p: string) => Promise<boolean>) => locateTool({ binary: 'clang++' }, undefined, {
    platform: 'win32', exists, env: {}, exec: async () => { throw new Error('not on PATH'); },
  });

  it('registers the installed bin directories as the last place tools are looked for', async () => {
    const { service } = makeService(makeUi(), { find: async () => installed });
    service.registerAsToolSource();
    const exe = 'C:\\store\\1\\llvm-mingw\\bin\\clang++.exe';
    expect(await lookup(async (p) => p === exe)).toBe(exe);
  });

  it('contributes nothing while no toolchain is installed, and never prompts', async () => {
    const ui = makeUi();
    const { service } = makeService(ui);
    service.registerAsToolSource();
    expect(await lookup(async () => true)).toBeUndefined();
    expect(ui.confirmDownload).not.toHaveBeenCalled();
  });

  it('stops contributing once disposed', async () => {
    const { service } = makeService(makeUi(), { find: async () => installed });
    service.registerAsToolSource().dispose();
    expect(await lookup(async () => true)).toBeUndefined();
  });

  it('installedBinDirs() is empty, not an error, when the manifest cannot be read', async () => {
    const service = new ManagedToolchainService(
      { storageDir: 'C:\\store', extensionPath: 'C:\\ext' }, makeUi() as unknown as ToolchainUi,
      { loadManifest: async () => { throw new Error('ENOENT'); } } as never,
    );
    expect(await service.installedBinDirs()).toEqual([]);
  });
});
