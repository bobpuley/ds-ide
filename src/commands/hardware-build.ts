import * as cp from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { detectArmToolchain, ARM_GCC_INSTALL_HINT } from '../hardware/toolchain';
import { parseBuildLine, applyDiagnostics, ParsedDiagnostic } from '../diagnostics/build-diagnostics';

export interface HardwareBuildDeps {
  spawn?: typeof cp.spawn;
  existsSync?: (p: string) => boolean;
  execSync?: (cmd: string) => Buffer;
}

// Invoke the project Makefile for the hardware target (arm-none-eabi).
// Streams output to a VS Code channel and applies compiler diagnostics.
export async function buildForHardware(
  projectRoot: string,
  diagnostics: vscode.DiagnosticCollection,
  deps: HardwareBuildDeps = {},
  outputChannel?: vscode.OutputChannel,
): Promise<void> {
  const spawnFn = deps.spawn ?? cp.spawn;
  const existsSync = deps.existsSync;
  const execSync = deps.execSync;

  const configuredPath = vscode.workspace.getConfiguration('ds-ide').get<string>('armToolchainPath');
  const gccPath = detectArmToolchain(
    configuredPath ?? undefined,
    existsSync,
    execSync,
  );

  if (!gccPath) {
    void vscode.window.showErrorMessage(
      `ds-ide: arm-none-eabi-gcc not found. ${ARM_GCC_INSTALL_HINT}`,
    );
    return;
  }

  const channel = outputChannel ?? vscode.window.createOutputChannel('Daisy IDE Hardware Build');
  channel.show();

  const parsed: ParsedDiagnostic[] = [];
  const env = buildEnv(gccPath);

  try {
    await runMake(projectRoot, env, spawnFn, (line) => {
      channel.appendLine(line);
      const d = parseBuildLine(line);
      if (d) parsed.push(d);
    });
    applyDiagnostics(diagnostics, parsed, projectRoot);
    void vscode.window.showInformationMessage('ds-ide: hardware build succeeded');
  } catch (err) {
    applyDiagnostics(diagnostics, parsed, projectRoot);
    const msg = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`ds-ide: hardware build failed — ${msg}`);
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
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawnFn('make', [], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });

    const handleData = (data: Buffer): void => {
      for (const line of data.toString('utf8').split('\n')) {
        if (line.trim()) onOutput(line);
      }
    };

    proc.stdout?.on('data', handleData);
    proc.stderr?.on('data', handleData);
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`make exited with code ${code ?? 'null'}`));
    });
  });
}
