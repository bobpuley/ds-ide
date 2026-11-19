import * as vscode from 'vscode';
import {
  findInstalledToolchain,
  installManagedToolchain,
  ManagedToolchainError,
  type InstalledToolchain,
  type InstallOptions,
  type ProgressEvent,
} from './managed-toolchain';
import { archiveFileName, loadManifest, type ToolchainManifest } from './manifest';
import type { CancelToken } from './download';

// FR-WIN-TCH-4: consent, progress and recovery around the managed toolchain
// download. The VS Code side is behind `ToolchainUi`, so the whole flow — consent
// with the size, a cancellable progress notification, a clear message and a retry
// per failure, installing from local archives — is unit-tested without VS Code.

export type FailureAction = 'retry' | 'local';

export interface ToolchainUi {
  /** The consent prompt. `undefined` = declined. */
  confirmDownload(message: string): Promise<'download' | 'local' | undefined>;
  /** Runs `run` under a cancellable progress notification; `percent` is the overall 0–100. */
  withProgress<T>(
    title: string,
    run: (report: (message: string, percent: number) => void, token: CancelToken) => Promise<T>,
  ): Promise<T>;
  pickArchiveFolder(prompt: string): Promise<string | undefined>;
  showFailure(message: string, actions: readonly FailureAction[]): Promise<FailureAction | undefined>;
  showInstalled(message: string): void;
}

export const formatBytes = (n: number): string => {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  const mb = n / 1e6;
  return mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
};

const sum = (m: ToolchainManifest, key: 'size' | 'extractedSize'): number =>
  m.components.reduce((n, c) => n + c[key], 0);

export function consentMessage(manifest: ToolchainManifest): string {
  return 'ds-ide needs a C++ toolchain (clang, CMake and Ninja) to build and debug Daisy effects on Windows. ' +
    `Download it now? It is about ${formatBytes(sum(manifest, 'size'))} to download from github.com and up to ` +
    `${formatBytes(sum(manifest, 'extractedSize'))} of disk space while installing, kept in ds-ide's own folder. ` +
    'Nothing is installed system-wide.';
}

const localArchivesPrompt = (m: ToolchainManifest): string =>
  `Select the folder that contains ${m.components.map(archiveFileName).join(', ')}`;

export interface Failure { message: string; actions: FailureAction[] }

/** Turns an install error into the message the user sees and the recovery actions to offer. */
export function describeFailure(err: unknown, manifest: ToolchainManifest, storageDir: string): Failure {
  if (!(err instanceof ManagedToolchainError)) {
    return { message: `The toolchain could not be installed: ${err instanceof Error ? err.message : String(err)}`, actions: ['retry'] };
  }
  const who = err.component ?? 'the toolchain';
  switch (err.kind) {
    case 'offline':
      return {
        message: `Could not reach github.com to download ${who}. Check your internet connection or proxy ` +
          "(the download does not use VS Code's proxy settings), or install from archives you downloaded yourself.",
        actions: ['retry', 'local'],
      };
    case 'http':
      return {
        message: `The download server returned an error (${err.detail ?? 'no details'}). ` +
          'Try again later, or install from archives you downloaded yourself.',
        actions: ['retry', 'local'],
      };
    case 'hash-mismatch':
      return {
        message: `The downloaded ${who} does not match its pinned checksum, so it was discarded. Nothing was installed.`,
        actions: ['retry', 'local'],
      };
    case 'disk-full':
      return {
        message: err.requiredBytes !== undefined && err.availableBytes !== undefined
          ? `Not enough free disk space: the toolchain needs about ${formatBytes(err.requiredBytes)} and ` +
            `${formatBytes(err.availableBytes)} is available in ${storageDir}. Free some space and retry.`
          : `The disk filled up while installing ${who}. Free some space in ${storageDir} and retry.`,
        actions: ['retry'],
      };
    case 'extract-failed':
      return {
        message: `Could not unpack ${who}: ${err.detail ?? 'unknown error'}. An antivirus may have blocked the files; try again.`,
        actions: ['retry'],
      };
    case 'incomplete':
      return { message: `${who} is incomplete after unpacking (missing: ${err.detail ?? 'unknown'}). Try again.`, actions: ['retry'] };
    case 'missing-archive':
      return {
        message: `${err.detail ?? 'An archive is missing'}. Put the archives from the three download links in one folder and choose it again.`,
        actions: ['local'],
      };
    case 'cancelled':
      return { message: '', actions: [] };
    default:
      return { message: `The toolchain could not be installed: ${err.detail ?? err.message}`, actions: ['retry'] };
  }
}

// Share of one component's progress bar taken by each phase.
const DOWNLOAD_SHARE = 0.6;
const VERIFIED_AT = 0.6;
const EXTRACTING_AT = 0.65;

/** Overall progress, 0..1, across all components. */
export function progressFraction(e: ProgressEvent): number {
  if (e.phase === 'finalize') return 1;
  let within = 0;
  if (e.phase === 'download') {
    within = e.totalBytes ? DOWNLOAD_SHARE * Math.min(1, (e.receivedBytes ?? 0) / e.totalBytes) : 0;
  } else if (e.phase === 'verify') {
    within = VERIFIED_AT;
  } else {
    within = EXTRACTING_AT;
  }
  return (e.index + within) / e.count;
}

export function progressMessage(e: ProgressEvent): string {
  const place = `${e.component} (${e.index + 1}/${e.count})`;
  switch (e.phase) {
    case 'download':
      return e.totalBytes
        ? `Downloading ${place} — ${formatBytes(e.receivedBytes ?? 0)} of ${formatBytes(e.totalBytes)}`
        : `Downloading ${place} — ${formatBytes(e.receivedBytes ?? 0)}`;
    case 'verify': return `Verifying ${place}…`;
    case 'extract': return `Unpacking ${place} — this can take a minute…`;
    default: return 'Finishing…';
  }
}

export interface ServiceDeps {
  loadManifest?: (extensionPath: string) => Promise<ToolchainManifest>;
  find?: typeof findInstalledToolchain;
  install?: (opts: InstallOptions) => Promise<InstalledToolchain>;
}

const isCancelled = (err: unknown): boolean => err instanceof ManagedToolchainError && err.kind === 'cancelled';

export class ManagedToolchainService {
  private inFlight: Promise<boolean> | undefined;
  private declined = false;
  private readonly loadManifest: (extensionPath: string) => Promise<ToolchainManifest>;
  private readonly find: typeof findInstalledToolchain;
  private readonly install: (opts: InstallOptions) => Promise<InstalledToolchain>;

  constructor(
    private readonly config: { storageDir: string; extensionPath: string },
    private readonly ui: ToolchainUi,
    deps: ServiceDeps = {},
  ) {
    this.loadManifest = deps.loadManifest ?? ((p) => loadManifest(p));
    this.find = deps.find ?? findInstalledToolchain;
    this.install = deps.install ?? ((o) => installManagedToolchain(o));
  }

  /** The installed toolchain's bin directories, or none. Never prompts. */
  async installedBinDirs(): Promise<string[]> {
    try {
      const manifest = await this.loadManifest(this.config.extensionPath);
      return (await this.find(this.config.storageDir, manifest))?.binDirs ?? [];
    } catch { return []; }
  }

  /**
   * Called when a tool is missing on Windows. Asks for consent (once per session
   * if declined) and installs. Resolves true when a managed toolchain is present
   * afterwards. Concurrent calls share one prompt and one download.
   */
  offer(): Promise<boolean> {
    return this.single(async () => {
      const manifest = await this.loadManifest(this.config.extensionPath);
      if (await this.find(this.config.storageDir, manifest)) return true;
      if (this.declined) return false;
      const choice = await this.ui.confirmDownload(consentMessage(manifest));
      if (!choice) { this.declined = true; return false; }
      if (choice === 'local') {
        const dir = await this.ui.pickArchiveFolder(localArchivesPrompt(manifest));
        return dir ? this.run(manifest, dir) : false;
      }
      return this.run(manifest, undefined);
    });
  }

  /**
   * The "Install Windows Toolchain" command: an explicit request, so it answers
   * "already installed" and asks again even if the prompt was declined earlier.
   */
  async installFromCommand(): Promise<boolean> {
    this.declined = false;
    const manifest = await this.loadManifest(this.config.extensionPath);
    if (await this.find(this.config.storageDir, manifest)) {
      this.ui.showInstalled('The Windows toolchain is already installed.');
      return true;
    }
    return this.offer();
  }

  /** The "install from local archive" command, for machines without internet access. */
  installFromLocalArchive(): Promise<boolean> {
    return this.single(async () => {
      const manifest = await this.loadManifest(this.config.extensionPath);
      const dir = await this.ui.pickArchiveFolder(localArchivesPrompt(manifest));
      return dir ? this.run(manifest, dir) : false;
    });
  }

  private single(work: () => Promise<boolean>): Promise<boolean> {
    if (this.inFlight) return this.inFlight;
    const p = work().finally(() => { this.inFlight = undefined; });
    this.inFlight = p;
    return p;
  }

  private async run(manifest: ToolchainManifest, localArchiveDir: string | undefined): Promise<boolean> {
    let dir = localArchiveDir;
    for (;;) {
      try {
        await this.ui.withProgress('Installing the Windows toolchain', (report, token) =>
          this.install({
            storageDir: this.config.storageDir,
            manifest,
            token,
            localArchiveDir: dir,
            onProgress: (e) => report(progressMessage(e), progressFraction(e) * 100),
          }));
        this.ui.showInstalled('Windows toolchain installed. Builds and debugging can now use it.');
        return true;
      } catch (err) {
        if (isCancelled(err)) return false;
        const failure = describeFailure(err, manifest, this.config.storageDir);
        const action = await this.ui.showFailure(failure.message, failure.actions);
        if (action === 'retry') continue;
        if (action === 'local') {
          dir = await this.ui.pickArchiveFolder(localArchivesPrompt(manifest));
          if (!dir) return false;
          continue;
        }
        return false;
      }
    }
  }
}

/** The real notification / dialog implementation. */
export function vscodeToolchainUi(): ToolchainUi {
  const LOCAL = 'Install from local archives…';
  const label: Record<FailureAction, string> = { retry: 'Retry', local: LOCAL };
  return {
    async confirmDownload(message) {
      const pick = await vscode.window.showInformationMessage(message, { modal: true }, 'Download', LOCAL);
      return pick === 'Download' ? 'download' : pick === LOCAL ? 'local' : undefined;
    },
    withProgress(title, run) {
      return Promise.resolve(vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title, cancellable: true },
        async (progress, token) => {
          let last = 0;
          return run((message, percent) => {
            progress.report({ message, increment: Math.max(0, percent - last) });
            last = Math.max(last, percent);
          }, token);
        },
      ));
    },
    async pickArchiveFolder(prompt) {
      const picked = await vscode.window.showOpenDialog({
        canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: 'Use this folder', title: prompt,
      });
      return picked?.[0]?.fsPath;
    },
    async showFailure(message, actions) {
      const pick = await vscode.window.showErrorMessage(`ds-ide: ${message}`, ...actions.map((a) => label[a]));
      return actions.find((a) => label[a] === pick);
    },
    showInstalled(message) {
      void vscode.window.showInformationMessage(`ds-ide: ${message}`);
    },
  };
}
