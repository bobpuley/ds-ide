import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const dir = path.join(__dirname, '../../../../.github/ISSUE_TEMPLATE');
const read = (f: string) => fs.readFileSync(path.join(dir, f), 'utf8');

// Structural checks of GitHub issue forms (no YAML library is a dependency):
// the top-level keys GitHub requires, and every field has an id and a label.
function checkForm(file: string): string {
  const text = read(file);
  expect(text).toMatch(/^name: \S.*$/m);
  expect(text).toMatch(/^description: \S.*$/m);
  expect(text).toMatch(/^body:\s*$/m);
  expect(text).not.toContain('\t');
  const fields = text.split(/^ {2}- type: /m).slice(1);
  expect(fields.length).toBeGreaterThan(0);
  for (const f of fields) {
    const type = f.split('\n')[0]!.trim();
    expect(['markdown', 'textarea', 'input', 'dropdown', 'checkboxes']).toContain(type);
    if (type !== 'markdown') {
      expect(f).toMatch(/^ {4}id: \S+$/m);
      expect(f).toMatch(/^ {6}label: \S.*$/m);
    }
  }
  return text;
}

describe('issue templates (FR-MKT-2)', () => {
  it('the bug report asks for versions, steps, expected/actual, the output channel and the crash lines', () => {
    const t = checkForm('bug-report.yml');
    for (const needle of ['Extension version', 'Operating system and version', 'VS Code version', 'Steps to reproduce',
      'Expected behaviour', 'Actual behaviour', 'Output channel', 'crashed with code', 'main.log']) {
      expect(t).toContain(needle);
    }
  });

  it('the feature request asks what the user is trying to do and what is missing', () => {
    const t = checkForm('feature-request.yml');
    expect(t).toContain('What are you trying to do?');
    expect(t).toContain('What is missing?');
  });

  it('the commercial enquiry form is still valid', () => {
    checkForm('commercial-licence.yml');
  });

  it('config.yml keeps blank issues allowed and points questions to the README', () => {
    const t = read('config.yml');
    expect(t).toMatch(/^blank_issues_enabled: true$/m);
    expect(t).toContain('contact_links:');
    expect(t).toContain('https://github.com/bobpuley/ds-ide#readme');
  });
});
