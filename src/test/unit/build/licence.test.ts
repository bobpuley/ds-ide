import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const root = path.join(__dirname, '../../../..');
const read = (f: string) => fs.readFileSync(path.join(root, f), 'utf8');
const pkg = JSON.parse(read('package.json'));

/** The README's "## License" section, up to the next "## " heading. */
function readmeLicenceSection(readme: string): string {
  return readme.match(/^## License[\s\S]*?(?=^## |(?![\s\S]))/m)?.[0] ?? '';
}

/** The "## ds-ide (this project)" section of LICENSES.md. */
function licensesOwnSection(licenses: string): string {
  return licenses.match(/^## ds-ide \(this project\)[\s\S]*?(?=^## )/m)?.[0] ?? '';
}

describe('licence statements agree (FR-LIC-2)', () => {
  it('LICENSE is the PolyForm Shield 1.0.0 text', () => {
    const lic = read('LICENSE');
    expect(lic).toMatch(/^# PolyForm Shield License 1\.0\.0/m);
    expect(lic).toContain('https://polyformproject.org/licenses/shield/1.0.0');
    expect(lic).toContain('providing any product that competes with the software');
    expect(lic).not.toMatch(/GNU GENERAL PUBLIC LICENSE/i);
  });

  it('LICENSE carries a plain "Required Notice:" line naming the copyright holder', () => {
    expect(read('LICENSE')).toMatch(/^Required Notice: Copyright \S.+$/m);
  });

  it('package.json declares the SPDX id PolyForm-Shield-1.0.0', () => {
    expect(pkg.license).toBe('PolyForm-Shield-1.0.0');
  });

  it("LICENSES.md names the same licence for ds-ide, not MIT or GPL", () => {
    const own = licensesOwnSection(read('LICENSES.md'));
    expect(own).toMatch(/PolyForm Shield/);
    expect(own).not.toMatch(/\bMIT\b|\bGPL/);
  });

  it('LICENSES.md keeps the third-party notices', () => {
    const lic = read('LICENSES.md');
    expect(lic).toMatch(/^## libDaisy/m);
    expect(lic).toMatch(/^## DaisySP/m);
  });

  it("the README's licence section names PolyForm Shield, links LICENSE and LICENSES.md, and not MIT or GPL", () => {
    const section = readmeLicenceSection(read('README.md'));
    expect(section).toMatch(/PolyForm Shield/);
    expect(section).toContain('(LICENSE)');
    expect(section).toContain('(LICENSES.md)');
    expect(section).not.toMatch(/\bMIT\b|\bGPL/);
  });

  it('the commercial-enquiry route exists as an issue template and is linked from the README, not from LICENSE (FR-LIC-4)', () => {
    expect(fs.existsSync(path.join(root, '.github/ISSUE_TEMPLATE/commercial-licence.yml'))).toBe(true);
    expect(readmeLicenceSection(read('README.md'))).toContain(`${pkg.bugs.url}/new?template=commercial-licence.yml`);
    expect(read('LICENSE')).not.toContain('commercial-licence');
  });

  it("CONTRIBUTING.md names the project licence and grants the maintainer relicensing rights (FR-LIC-5)", () => {
    const c = read('CONTRIBUTING.md');
    expect(c).toMatch(/PolyForm Shield/);
    expect(c).toContain('(LICENSE)');
    expect(c).toMatch(/other terms, including commercial/i);
  });
});
