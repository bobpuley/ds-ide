import * as assert from 'assert';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventEmitter } from 'events';
import * as vscode from 'vscode';

// On Windows the tool lookup (where.exe, then known folders) needs executables that
// exist, and a machine without a toolchain would otherwise be offered the managed
// toolchain download (a modal prompt that would hang this headless run). So the
// tools are stood in for by empty .exe files in a temporary folder placed first on
// PATH; they are never run, because spawn is stubbed below. Done at module top
// level, before the extension activates.
let fakeToolsDir: string | undefined;
if (process.platform === 'win32') {
  fakeToolsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-ide-e2e-tools-'));
  for (const tool of ['cmake', 'clang++', 'ninja', 'make', 'arm-none-eabi-gcc']) {
    fs.writeFileSync(path.join(fakeToolsDir, `${tool}.exe`), '');
  }
  process.env['Path'] = `${fakeToolsDir};${process.env['Path'] ?? ''}`;
}

/** The program a stubbed spawn was asked to run: its file name without folder or `.exe`. */
const programOf = (command: string): string => path.basename(command).replace(/\.exe$/i, '');

// Stub the process-spawn boundary before the extension activates. Activation
// is lazy (first triggered by an executeCommand call in the tests below), and
// child_process is a Node built-in singleton module — patching the `spawn`
// property here, at module top level (which Mocha evaluates for every spec
// file before running any test body), is visible to the extension's own
// `cp.spawn` calls once EmulatorManager/buildForHardware are constructed.
// This keeps these specs free of any real arm-none-eabi toolchain or cmake
// invocation (FR-TEST-2).
const spawnCalls: { command: string; args: string[] }[] = [];

function fakeChildProcess(): cp.ChildProcess {
  const proc = new EventEmitter() as unknown as cp.ChildProcess;
  (proc as unknown as { stdout: EventEmitter }).stdout = new EventEmitter();
  (proc as unknown as { stderr: EventEmitter }).stderr = new EventEmitter();
  proc.kill = () => true;
  // Listeners are attached synchronously right after spawn() returns; defer
  // to the next macrotask so 'close' fires after they're in place.
  setImmediate(() => proc.emit('close', 0));
  return proc;
}

// `import * as cp` is a read-only namespace copy (esModuleInterop, on by default
// in TypeScript 7), so assigning to it throws; patch the real module object that
// `require` returns. The extension reads `cp.spawn` at call time, so it sees this.
const realChildProcess = require('child_process') as { spawn: typeof cp.spawn };
realChildProcess.spawn = ((command: string, args?: readonly string[]) => {
  spawnCalls.push({ command, args: Array.isArray(args) ? [...args] : [] });
  return fakeChildProcess();
}) as typeof cp.spawn;

suite('Build command dispatch (stubbed process-spawn boundary)', () => {
  suiteSetup(async () => {
    const fixtureDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(fixtureDir, 'expected the e2e run to open src/test/e2e/fixtures/basic-effect-project as its workspace folder');
    // A real file just needs to exist for detectArmToolchain()'s exists()
    // check to succeed — it's never executed, since `make` itself is stubbed.
    // (On Windows the file must be named arm-none-eabi-gcc.exe: see fakeToolsDir.)
    const fakeToolchainDir = fakeToolsDir ?? path.join(fixtureDir, 'fake-toolchain');
    const config = vscode.workspace.getConfiguration('ds-ide');
    await config.update('armToolchainPath', fakeToolchainDir, vscode.ConfigurationTarget.Workspace);
    // Pre-set so buildForHardware's first-build variant prompt (an
    // interactive QuickPick that would otherwise hang headless) is skipped.
    await config.update('hardwareVariant', 'base', vscode.ConfigurationTarget.Workspace);
  });

  suiteTeardown(() => {
    if (fakeToolsDir) fs.rmSync(fakeToolsDir, { recursive: true, force: true });
  });

  setup(() => {
    spawnCalls.length = 0;
  });

  test('"Daisy IDE: Build for Emulator" reaches the process-spawn boundary via cmake', async () => {
    const result = await vscode.commands.executeCommand('ds-ide.build');
    assert.strictEqual(result, true, 'buildForEmulator should report success with a stubbed spawn');
    assert.ok(
      spawnCalls.some((c) => programOf(c.command) === 'cmake'),
      `expected a cmake invocation, got: ${JSON.stringify(spawnCalls)}`,
    );
  });

  test('"Daisy IDE: Build for Hardware" reaches the process-spawn boundary via make', async () => {
    await vscode.commands.executeCommand('ds-ide.buildHardware');
    assert.ok(
      spawnCalls.some((c) => programOf(c.command) === 'make'),
      `expected a make invocation, got: ${JSON.stringify(spawnCalls)}`,
    );
  });
});
