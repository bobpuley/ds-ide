import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  detectArmToolchain, detectMake, armGccInstallHint, makeInstallHint, NO_MAKEFILE_MESSAGE,
} from '../hardware/toolchain';
import { createLineSplitter } from '../hardware/line-buffer';
import { prependToPath } from '../hardware/path-env';
import { parseBuildLine, applyDiagnostics, ParsedDiagnostic } from '../diagnostics/build-diagnostics';
import {
  parseMemoryRegionTable,
  extractOverflowError,
  hasOverflowIndicator,
} from '../diagnostics/memory-region-diagnostics';
import { promptHardwareVariant } from '../hardware/hardware-variant-prompt';

export interface HardwareBuildDeps {
  spawn?: typeof cp.spawn;
  // FR-PRE-3: whether the project root holds a Makefile; overridable for tests.
  makefileExists?: (projectRoot: string) => Promise<boolean>;
  // FR-WIN-TCH-2: defaults to the host platform; overridable for tests.
  platform?: NodeJS.Platform;
}

function isSpawnNotFound(err: unknown): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT';
}

const defaultMakefileExists = async (projectRoot: string): Promise<boolean> => {
  for (const name of ['Makefile', 'makefile', 'GNUmakefile']) {
    try { await fs.promises.access(`${projectRoot}/${name}`); return true; } catch { /* try next */ }
  }
  return false;
};

// FR-HW-5b: heads-up threshold before a region hard-overflows the next build.
const NEAR_LIMIT_PCT = 75;

// Invoke the project Makefile for the hardware target (arm-none-eabi).
// Streams output to a VS Code channel and applies compiler diagnostics.
// Resolves true on a successful build, so Build & Flash can stop before
// flashing a stale binary (FR-TRN-3).
export async function buildForHardware(
  projectRoot: string,
  diagnostics: vscode.DiagnosticCollection,
  outputChannel: vscode.OutputChannel,
  deps: HardwareBuildDeps = {},
  token?: vscode.CancellationToken,
): Promise<boolean> {
  const spawnFn = deps.spawn ?? cp.spawn;
  const platform = deps.platform ?? process.platform;
  const channel = outputChannel;
  // FR-PRE-2: the cause also goes to the output channel, not only a toast.
  const reportMissing = (msg: string): false => {
    channel.show();
    channel.appendLine(msg);
    void vscode.window.showErrorMessage(`ds-ide: ${msg}`);
    return false;
  };

  // FR-PRE-3: without a Makefile `make` only says "No targets specified and no
  // makefile found" — say what that means for this project instead.
  if (!await (deps.makefileExists ?? defaultMakefileExists)(projectRoot)) {
    channel.show();
    channel.appendLine(NO_MAKEFILE_MESSAGE);
    void vscode.window.showErrorMessage(`ds-ide: ${NO_MAKEFILE_MESSAGE}`);
    return false;
  }

  const configuredPath = vscode.workspace.getConfiguration('ds-ide').get<string>('armToolchainPath');
  const gccPath = await detectArmToolchain(configuredPath ?? undefined);

  if (!gccPath) return reportMissing(`arm-none-eabi-gcc not found. ${armGccInstallHint(platform)}`);

  // FR-WIN-TCH-2: stock Windows has no `make`; find one (PATH, MSYS2, …) so its
  // directory can join PATH, or say how to get one. macOS/Linux keep spawning
  // plain `make`; a missing one is reported from the spawn error below.
  let makeCommand = 'make';
  if (platform === 'win32') {
    const found = await detectMake();
    if (!found) return reportMissing(`make not found. ${makeInstallHint(platform)}`);
    makeCommand = found;
  }

  channel.show();

  const hardwareVariant = await resolveHardwareVariant(projectRoot);

  const parsed: ParsedDiagnostic[] = [];
  const outputLines: string[] = [];
  const env = buildEnv(gccPath, platform === 'win32' ? makeCommand : undefined, process.env, platform);

  try {
    await runMake(makeCommand, projectRoot, env, spawnFn, (line) => {
      channel.appendLine(line);
      outputLines.push(line);
      const d = parseBuildLine(line);
      if (d) parsed.push(d);
    }, token);
    applyDiagnostics(diagnostics, parsed, projectRoot);
    reportMemoryUsage(outputLines.join('\n'), channel, hardwareVariant);
    void vscode.window.showInformationMessage('ds-ide: hardware build succeeded');
    return true;
  } catch (err) {
    applyDiagnostics(diagnostics, parsed, projectRoot);
    if (isSpawnNotFound(err)) return reportMissing(`make not found. ${makeInstallHint(platform)}`);
    void vscode.window.showErrorMessage(`ds-ide: hardware build failed — ${buildFailureDetail(outputLines.join('\n'), err)}`);
    return false;
  }
}

// FR-HW-5d: prompts once for the project's hardware variant if it has never
// been explicitly set (checked via inspect(), not get() — get() would
// return the schema default 'base' even when unset, since package.json
// declares one). Persists the answer so future builds don't ask again;
// declining the prompt uses 'base' for this build only, without persisting,
// so the prompt reappears next time.
async function resolveHardwareVariant(projectRoot: string): Promise<string> {
  const config = vscode.workspace.getConfiguration('ds-ide', vscode.Uri.file(projectRoot));
  if (!isHardwareVariantUnset(config)) {
    return config.get<string>('hardwareVariant') ?? 'base';
  }
  const picked = await promptHardwareVariant();
  if (picked === undefined) return 'base';
  await config.update('hardwareVariant', picked, vscode.ConfigurationTarget.WorkspaceFolder);
  return picked;
}

function isHardwareVariantUnset(config: vscode.WorkspaceConfiguration): boolean {
  const inspected = config.inspect?.<string>('hardwareVariant');
  return (
    inspected !== undefined &&
    inspected.globalValue === undefined &&
    inspected.workspaceValue === undefined &&
    inspected.workspaceFolderValue === undefined
  );
}

// FR-HW-5b: names the overflowing region when the failure is a linker region
// overflow, instead of the generic "make exited with code N" — that message
// alone gives no hint the failure was memory-budget-shaped.
function buildFailureDetail(rawOutput: string, err: unknown): string {
  const overflow = extractOverflowError(rawOutput);
  if (overflow) {
    return `memory region '${overflow.region}' overflowed by ${overflow.overflowBytes} bytes`;
  }
  if (hasOverflowIndicator(rawOutput)) {
    return "a memory region overflow was detected but couldn't be parsed precisely; see output above";
  }
  return err instanceof Error ? err.message : String(err);
}

// FR-HW-5b/c: prints the linker's per-region usage table (previously
// discarded unparsed), hard-errors on SDRAM usage that can't physically fit
// on the connected board, and warns when any other region is close to its
// limit.
function reportMemoryUsage(rawOutput: string, channel: vscode.OutputChannel, hardwareVariant: string): void {
  const regions = parseMemoryRegionTable(rawOutput);
  if (regions.length === 0) return;

  channel.appendLine('Memory region usage:');
  for (const r of regions) {
    channel.appendLine(`  ${r.region}: ${r.usedBytes} / ${r.regionBytes} bytes (${r.pctUsed.toFixed(2)}%)`);
  }

  // The linker's SDRAM region size is a fixed 64 MB constant from the .lds
  // script — it has no idea the base Daisy Seed lacks the physical chip, so
  // any usage at all is fatal there regardless of the %age the linker reports.
  const sdram = regions.find((r) => r.region === 'SDRAM');
  const sdramHardError = sdram !== undefined && sdram.usedBytes > 0 && hardwareVariant === 'base';
  if (sdramHardError) {
    void vscode.window.showErrorMessage(
      `ds-ide: SDRAM used (${sdram.usedBytes} bytes) but ds-ide.hardwareVariant is 'base' — the base Daisy Seed has no physical SDRAM chip. Set ds-ide.hardwareVariant to '65mb-sdram' if your board has it, or remove SDRAM usage.`,
    );
  }

  const nearLimitCandidates = sdramHardError ? regions.filter((r) => r.region !== 'SDRAM') : regions;
  const nearLimit = nearLimitCandidates.filter((r) => r.pctUsed >= NEAR_LIMIT_PCT);
  if (nearLimit.length > 0) {
    const names = nearLimit.map((r) => `${r.region} (${r.pctUsed.toFixed(2)}%)`).join(', ');
    void vscode.window.showWarningMessage(`ds-ide: memory usage near limit — ${names}`);
  }
}

// Construct a PATH-augmented environment so make finds arm-none-eabi-gcc (and,
// on Windows, the tools that ship next to `make`). The separator and path
// rules follow the target platform; on Windows the variable is usually spelled
// `Path`, so the existing key is reused rather than adding a second `PATH`.
export function buildEnv(
  gccPath: string,
  makePath: string | undefined,
  baseEnv: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): NodeJS.ProcessEnv {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const dirs = [gccPath, makePath].filter((x): x is string => x !== undefined).map((x) => p.dirname(x));
  return prependToPath(baseEnv, dirs, platform);
}

function runMake(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  spawnFn: typeof cp.spawn,
  onOutput: (line: string) => void,
  token?: vscode.CancellationToken,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawnFn(command, [], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });

    const stdoutSplitter = createLineSplitter(onOutput);
    const stderrSplitter = createLineSplitter(onOutput);

    // FR-EXT-16: a hung `make` invocation otherwise leaves the build
    // command's promise pending forever with no way to abort it.
    const cancelSub = token?.onCancellationRequested(() => proc.kill());

    proc.stdout?.on('data', (data: Buffer) => stdoutSplitter.push(data));
    proc.stderr?.on('data', (data: Buffer) => stderrSplitter.push(data));
    proc.on('error', (err) => { cancelSub?.dispose(); reject(err); });
    proc.on('close', (code) => {
      cancelSub?.dispose();
      stdoutSplitter.flush();
      stderrSplitter.flush();
      if (token?.isCancellationRequested) {
        reject(new Error('make cancelled'));
      } else if (code === 0) {
        resolve();
      } else {
        reject(new Error(`make exited with code ${code ?? 'null'}`));
      }
    });
  });
}
