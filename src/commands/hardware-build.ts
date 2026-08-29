import * as cp from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { detectArmToolchain, ARM_GCC_INSTALL_HINT } from '../hardware/toolchain';
import { createLineSplitter } from '../hardware/line-buffer';
import { parseBuildLine, applyDiagnostics, ParsedDiagnostic } from '../diagnostics/build-diagnostics';
import {
  parseMemoryRegionTable,
  extractOverflowError,
  hasOverflowIndicator,
} from '../diagnostics/memory-region-diagnostics';

export interface HardwareBuildDeps {
  spawn?: typeof cp.spawn;
}

// FR-HW-5b: heads-up threshold before a region hard-overflows the next build.
const NEAR_LIMIT_PCT = 75;

// Invoke the project Makefile for the hardware target (arm-none-eabi).
// Streams output to a VS Code channel and applies compiler diagnostics.
export async function buildForHardware(
  projectRoot: string,
  diagnostics: vscode.DiagnosticCollection,
  outputChannel: vscode.OutputChannel,
  deps: HardwareBuildDeps = {},
  token?: vscode.CancellationToken,
): Promise<void> {
  const spawnFn = deps.spawn ?? cp.spawn;

  const configuredPath = vscode.workspace.getConfiguration('ds-ide').get<string>('armToolchainPath');
  const gccPath = await detectArmToolchain(configuredPath ?? undefined);

  if (!gccPath) {
    void vscode.window.showErrorMessage(
      `ds-ide: arm-none-eabi-gcc not found. ${ARM_GCC_INSTALL_HINT}`,
    );
    return;
  }

  const channel = outputChannel;
  channel.show();

  const parsed: ParsedDiagnostic[] = [];
  const outputLines: string[] = [];
  const env = buildEnv(gccPath);

  try {
    await runMake(projectRoot, env, spawnFn, (line) => {
      channel.appendLine(line);
      outputLines.push(line);
      const d = parseBuildLine(line);
      if (d) parsed.push(d);
    }, token);
    applyDiagnostics(diagnostics, parsed, projectRoot);
    reportMemoryUsage(outputLines.join('\n'), channel);
    void vscode.window.showInformationMessage('ds-ide: hardware build succeeded');
  } catch (err) {
    applyDiagnostics(diagnostics, parsed, projectRoot);
    void vscode.window.showErrorMessage(`ds-ide: hardware build failed — ${buildFailureDetail(outputLines.join('\n'), err)}`);
  }
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

// FR-HW-5b: prints the linker's per-region usage table (previously
// discarded unparsed) and warns when any region is close to its limit.
function reportMemoryUsage(rawOutput: string, channel: vscode.OutputChannel): void {
  const regions = parseMemoryRegionTable(rawOutput);
  if (regions.length === 0) return;

  channel.appendLine('Memory region usage:');
  for (const r of regions) {
    channel.appendLine(`  ${r.region}: ${r.usedBytes} / ${r.regionBytes} bytes (${r.pctUsed.toFixed(2)}%)`);
  }

  const nearLimit = regions.filter((r) => r.pctUsed >= NEAR_LIMIT_PCT);
  if (nearLimit.length > 0) {
    const names = nearLimit.map((r) => `${r.region} (${r.pctUsed.toFixed(2)}%)`).join(', ');
    void vscode.window.showWarningMessage(`ds-ide: memory usage near limit — ${names}`);
  }
}

// Construct a PATH-augmented environment so make finds arm-none-eabi-gcc.
function buildEnv(gccPath: string): NodeJS.ProcessEnv {
  const binDir = path.dirname(gccPath);
  const existingPath = process.env['PATH'] ?? '';
  return {
    ...process.env,
    PATH: binDir !== '.' ? `${binDir}:${existingPath}` : existingPath,
  };
}

function runMake(
  cwd: string,
  env: NodeJS.ProcessEnv,
  spawnFn: typeof cp.spawn,
  onOutput: (line: string) => void,
  token?: vscode.CancellationToken,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawnFn('make', [], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });

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
