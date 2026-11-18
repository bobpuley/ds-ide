import * as assert from 'assert';
import * as cp from 'child_process';
import * as path from 'path';
import { EventEmitter } from 'events';
import * as vscode from 'vscode';

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

(cp as unknown as { spawn: typeof cp.spawn }).spawn = ((command: string, args?: readonly string[]) => {
  spawnCalls.push({ command, args: Array.isArray(args) ? [...args] : [] });
  return fakeChildProcess();
}) as typeof cp.spawn;

suite('Build command dispatch (stubbed process-spawn boundary)', () => {
  suiteSetup(async () => {
    const fixtureDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(fixtureDir, 'expected the e2e run to open src/test/e2e/fixtures/basic-effect-project as its workspace folder');
    const fakeToolchainDir = path.join(fixtureDir, 'fake-toolchain');

    // A real file just needs to exist for detectArmToolchain()'s exists()
    // check to succeed — it's never executed, since `make` itself is stubbed.
    const config = vscode.workspace.getConfiguration('ds-ide');
    await config.update('armToolchainPath', fakeToolchainDir, vscode.ConfigurationTarget.Workspace);
    // Pre-set so buildForHardware's first-build variant prompt (an
    // interactive QuickPick that would otherwise hang headless) is skipped.
    await config.update('hardwareVariant', 'base', vscode.ConfigurationTarget.Workspace);
  });

  setup(() => {
    spawnCalls.length = 0;
  });

  test('"Daisy IDE: Build for Emulator" reaches the process-spawn boundary via cmake', async () => {
    const result = await vscode.commands.executeCommand('ds-ide.build');
    assert.strictEqual(result, true, 'buildForEmulator should report success with a stubbed spawn');
    assert.ok(
      spawnCalls.some((c) => path.basename(c.command) === 'cmake'),
      `expected a cmake invocation, got: ${JSON.stringify(spawnCalls)}`,
    );
  });

  test('"Daisy IDE: Build for Hardware" reaches the process-spawn boundary via make', async () => {
    await vscode.commands.executeCommand('ds-ide.buildHardware');
    assert.ok(
      spawnCalls.some((c) => c.command === 'make'),
      `expected a make invocation, got: ${JSON.stringify(spawnCalls)}`,
    );
  });
});
