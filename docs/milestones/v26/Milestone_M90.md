# M90 — Marketplace Readiness

**Version:** 0.24.9
**Status:** released
**Source:** intake session, 2026-11-14 (first public preview; `docs/release_plan.md`)

## Goal

The extension works and the README is ready, but the package metadata has never been reviewed for the Marketplace (the icon is 624 bytes, there is no `preview` flag, no gallery banner), there are no issue templates for the feedback the preview exists to collect, nothing proves that the README's links work once the package is published, and the repository still carries clutter and is private. After this milestone the package page is complete, reports have a shape, a script says whether every published link resolves, and the repository is tidy and public.

## Sprint Tasks

### [x] chore: package metadata fit for the Marketplace (FR-MKT-1)

**Affected files:** `package.json`, `media/ds-ide-icon.png`, `src/test/unit/build/package-metadata.test.ts`

**DoD:**
- `package.json` has `"preview": true`, a clear `displayName` and a one-sentence `description`, categories and keywords chosen with the owner (Daisy Seed, Electro-Smith, libDaisy, DaisySP, audio, DSP, emulator, MIDI), and a `galleryBanner`
- `icon` is a PNG of at least 128 by 128 pixels (replacing the 624-byte file), made from `media/ds-ide-icon.svg` or supplied by the owner
- a unit test fails when the icon is smaller than 128 by 128, `preview` is not true, the version has a semver pre-release suffix, or the description is longer than about 200 characters
- `npm run verify:package` still passes

---

### [x] docs: issue templates for bug reports and feature requests (FR-MKT-2)

**Affected files:** `.github/ISSUE_TEMPLATE/bug-report.yml`, `.github/ISSUE_TEMPLATE/feature-request.yml`, `.github/ISSUE_TEMPLATE/config.yml`

**DoD:**
- the bug form asks for the extension, macOS and VS Code versions, steps, expected and actual behaviour, the output channel's text, and, for a window that closed on its own, the `crashed with code` lines from `main.log`
- the feature form asks what the user is trying to do and what is missing
- `config.yml` keeps blank issues allowed and lists the three templates (the commercial licence enquiry comes from FR-LIC-4)
- the files are valid GitHub issue-form YAML

---

### [x] feat: a pre-publish check of the packaged README's links (FR-MKT-3)

**Affected files:** `scripts/check-published-links.js`, `package.json`, `src/test/unit/scripts/check-published-links.test.ts`, `CONTRIBUTING.md`

**DoD:**
- `npm run check:published-links` extracts every absolute URL from the packaged README and from `repository`, `bugs` and `homepage`, requests each anonymously, and exits non-zero listing any that do not answer 200 after redirects
- the URL extraction and the pass/fail decision are a pure function with unit tests (the network call is injected); the script is not part of `npm test`
- `CONTRIBUTING.md` says when to run it (before publishing)
- run against the repository today it fails (private); it passes after FR-MKT-4

---

### [x] chore: tidy the repository before it is public (FR-MKT-5)

Owner task for the deletions: list the files, the owner removes them.

**Affected files:** `design_plan.md`, `design_plan-it.md`, `design_plan_check.md`, root-level screenshots, `tests/runtime/**/__pycache__/`, `.gitignore`, `examples/controls-sd-logger/controllers.yaml`

**DoD:**
- the untracked root clutter is deleted, moved or ignored, as the owner decides
- the committed `__pycache__/*.pyc` files are untracked (`git rm --cached`) and ignored
- the `controls-sd-logger/controllers.yaml` layout is kept or discarded
- `git status` is clean apart from intended changes

---

### [x] chore: make the repository public (FR-MKT-4)

Owner task: visibility changes are made by the owner, step by step.

**Affected files:** the GitHub repository settings (no files)

**DoD:**
- before the switch: M88 is released and PR #1 resolved; the history and tracked files are reviewed for secrets and private material (a scanner run and a read of what is tracked); the repository has its description, topics and Issues enabled; `main` and all tags are pushed
- after the switch: `npm run check:published-links` passes and the README's images load anonymously

> Pre-switch review (2026-11-14, no scanner installed, so a pattern scan of all history plus a read of tracked files): no API keys, tokens, private keys or `.env`-style files were ever committed, and no blob over 5 MB. Found and left for the owner to decide: the owner's Git author email appears in 705 commits and a third party's personal email in one commit on the pushed `feat/windows-support` branch (both become public with the repository); one docs file names a local home directory path.
