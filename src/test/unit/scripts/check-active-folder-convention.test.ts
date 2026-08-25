import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT_DIR = path.resolve(__dirname, '../../../..');
const SCRIPT = path.join(ROOT_DIR, 'scripts/check-active-folder-convention.sh');
const FIXTURE_PATH = path.join(ROOT_DIR, 'src/commands/__convention-check-fixture.ts');

function runScript(): { status: number; output: string } {
  try {
    const output = execFileSync('bash', [SCRIPT], { cwd: ROOT_DIR, encoding: 'utf8' });
    return { status: 0, output };
  } catch (err) {
    const e = err as { status: number; stderr: Buffer | string };
    return { status: e.status, output: e.stderr.toString() };
  }
}

describe('check-active-folder-convention.sh (FR-UX-6)', () => {
  afterEach(() => {
    fs.rmSync(FIXTURE_PATH, { force: true });
  });

  it('passes against the current codebase', () => {
    const result = runScript();
    expect(result.status).toBe(0);
  });

  it('fails when a new src file indexes workspace.workspaceFolders directly (regression check)', () => {
    fs.writeFileSync(
      FIXTURE_PATH,
      "import * as vscode from 'vscode';\nexport const folder = vscode.workspace.workspaceFolders?.[0];\n",
    );

    const result = runScript();

    expect(result.status).toBe(1);
    expect(result.output).toContain('__convention-check-fixture.ts');
  });
});
