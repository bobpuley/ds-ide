# M88 — Licensing

**Version:** 0.24.7
**Status:** in progress
**Source:** intake session, 2026-11-13 (first public preview; `docs/release_plan.md`)

## Goal

The repository's licence files contradict each other: `LICENSE` is GPL-3.0 while `package.json` and `LICENSES.md` say MIT, and the owner wants a different model anyway: anyone may use Daisy IDE for anything, including developing and selling their own effects, but competing with the IDE itself needs a commercial agreement. This milestone adopts PolyForm Shield 1.0.0 everywhere, explains it in plain words, gives a route for commercial agreements, sets the terms for future contributions, and settles the one outside contribution, so the repository can be made public with a single, consistent licence.

## Sprint Tasks

### [x] docs: adopt PolyForm Shield 1.0.0 in LICENSE, package.json and LICENSES.md (FR-LIC-1)

**Affected files:** `LICENSE`, `package.json`, `LICENSES.md`

**DoD:**
- `LICENSE` is the official PolyForm Shield 1.0.0 text, fetched from the PolyForm project and unmodified, followed by a `Required Notice:` line; the copyright holder's name is confirmed by the owner before it is written
- `package.json` `license` is `PolyForm-Shield-1.0.0`
- `LICENSES.md`'s ds-ide section names the same licence, and every third-party notice is kept
- no GPL-3.0 text and no "MIT" claim for ds-ide remains in the repository

---

### [x] test: the licence statements agree (FR-LIC-2)

**Affected files:** `src/test/unit/build/licence.test.ts`

**DoD:**
- the test fails when `LICENSE` is not the Shield text with a `Required Notice:` line, when `package.json` `license` is not `PolyForm-Shield-1.0.0`, when `LICENSES.md` names another licence for ds-ide, or when the README's licence section does
- it fails against the repository as it is today (GPL `LICENSE`, MIT metadata)

---

### [x] docs: explain the licence in plain words in the README (FR-LIC-3)

**Affected files:** `README.md`

**DoD:**
- the License section states, in a few sentences: use it for anything, including developing and selling your own effects; what you build belongs to you; you may not use it to provide a competing product, which needs a commercial agreement; third-party components keep their licences (link to `LICENSES.md`)
- it links to `LICENSE`, says the text there governs, and gives no legal advice

---

### [x] docs: a route for commercial agreements (FR-LIC-4)

**Affected files:** `.github/ISSUE_TEMPLATE/commercial-licence.yml`, `.github/ISSUE_TEMPLATE/config.yml`, `README.md`

**DoD:**
- an issue template "Commercial licence enquiry" tells people not to post confidential details and asks how to reach them
- the README's licence section points to it (the issues URL from `package.json` `bugs`)
- the route appears in the README and the template only, not in `LICENSE`

---

### [x] docs: terms for contributions (FR-LIC-5)

**Affected files:** `CONTRIBUTING.md`

**DoD:**
- `CONTRIBUTING.md` says a contribution is licensed under the project's licence (named, linked to `LICENSE`) and that the contributor also grants the maintainer the right to license it under other terms, including commercial ones
- the wording is short and plain, and the milestone notes it should get a lawyer's review

> Note: the contribution wording, and the commercial terms behind the Shield licence, are not legal advice; have a lawyer review them before relying on them.

---

### [ ] chore: resolve the outside contribution, PR #1 (FR-LIC-6)

PR #1 (`kefflash`, `a397e28`, test-only Windows fixes) was contributed to a repository licensed GPL-3.0, so it is GPL-3.0 and cannot be relicensed without the contributor's consent. Owner task.

**Affected files:** `LICENSES.md` or the files touched by `a397e28` (`.gitattributes`, `src/__mocks__/vscode.ts`, `src/test/unit/**`)

**DoD:**
- either the contributor's written consent to relicensing under PolyForm Shield 1.0.0 is obtained (a comment on PR #1 is enough) and its link recorded in `LICENSES.md`, or the owner rewrites the affected lines so none of the contributor's remain, and a commit says so
- the repository is not made public until this is done
