import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

suite('Extension activation smoke test', () => {
  test('activates and registers every contributed command', async () => {
    const pkgPath = path.resolve(__dirname, '../../../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
      contributes: { commands: { command: string }[] };
    };
    const contributedCommands = pkg.contributes.commands.map((c) => c.command);

    const extension = vscode.extensions.getExtension('daisy-ide.ds-ide');
    assert.ok(extension, 'extension "daisy-ide.ds-ide" was not found in the test host');
    await extension!.activate();

    const registeredCommands = await vscode.commands.getCommands(true);
    for (const command of contributedCommands) {
      assert.ok(
        registeredCommands.includes(command),
        `contributed command "${command}" is not registered after activation`
      );
    }
  });
});
