# M91 — First Public Preview Release

**Version:** 0.25.0
**Status:** released
**Source:** intake session, 2026-11-14 (first public preview; `docs/release_plan.md`)

## Goal

Everything the first public preview needs is built (M85 to M90); this milestone ships it. It sets the version to 0.25.0 (a Marketplace pre-release, `"preview": true`), writes the changelog, proves the whole thing on the release commit including the suites that `npm test` does not run and a clean-profile walk-through, tags and pushes, and then publishes step by step with the owner. After it, Daisy IDE is installable from the Marketplace and users know where to send feedback.

## Sprint Tasks

### [x] chore: version 0.25.0 and the changelog (FR-RLS-1)

**Affected files:** `package.json`, `CHANGELOG.md`

**DoD:**
- `package.json` `version` is `0.25.0` and `CHANGELOG.md` opens with `## 0.25.0 — <date>`, a user-facing summary of the first public preview (what it does, that it is a preview, the platform scope, where to give feedback)
- `package-metadata.test.ts` passes

---

### [x] test: full verification on the release commit (FR-RLS-2)

**Affected files:** none (verification); results recorded in this file

**DoD:**
- `npm run lint`, `npm test`, `npm run test:e2e`, the emulator C++ runners (`tests/*/run_*.sh`), `tests/runtime/build_and_test.sh`, `npm run package` and `npm run verify:package` all pass on the release commit
- the built `.vsix` is installed in a clean profile and the README's quick start is walked through
- the extension-host crash soak (open and close example folders about ten times, watching VS Code's `main.log` for `crashed with code`) is run and its result recorded here

---

### [x] chore: tag 0.25.0 and push (FR-RLS-3)

**Affected files:** none (git)

**DoD:**
- an annotated tag `0.25.0` is created on the release commit only after FR-RLS-2 passes
- `main` and all pending tags (`0.24.4` and later) are pushed

---

### [x] chore: publish the preview, guided (FR-RLS-4)

Owner task, one step at a time with a check after each; the assistant does not publish.

**Affected files:** none (Marketplace)

**DoD:**
- the Marketplace publisher `daisy-ide` exists and the authentication the Marketplace currently requires is set up (checked against Microsoft's current guidance, not assumed)
- the built package is published with `vsce publish --pre-release`
- the Marketplace page is verified (README and images, licence, version, Preview badge) and the extension is installed from the Marketplace in a clean profile
- the Open VSX decision is made and recorded
- the preview is announced, with where to send feedback

> Verification record (2026-11-14, release commit `9c2795a`, VSIX `ds-ide-darwin-arm64-0.25.0.vsix`): `npm run lint`, `npm test` (103 files, 1819 tests), `npm run test:e2e` (4 passing), all 19 emulator runners (`tests/*/run_*.sh`, `tests/runtime/build_and_test.sh`), `npm run package` and `npm run verify:package` pass. The run found and fixed three defects, none introduced by M89 except the fixture `Makefile`: the emulator-safety runner did not link `input_generators.cpp`; `EmulatorManager` captured `child_process.spawn` at construction, so the e2e stub was never seen once the extension activated on folder open; and the e2e spec expected the bare `cmake` command after M85 resolved its full path. Clean-profile walk-through (VSIX installed in a fresh profile, `controls-tour`, `midi-synth-oled`, `controls-sd-logger`, Preview tag on the details page) and the crash soak (about ten open/close cycles of the example folders): all fine, no `crashed with code` lines.

> Publish record (2026-11-14): published from the manual `publish` workflow with Trusted Publishing (OIDC, environment `Production`, no stored token; the classic PAT route was skipped because Azure DevOps retires global PATs on 2026-12-01) as `daisy-ide.ds-ide` v0.25.0 (darwin-arm64, pre-release). The tag `0.25.0` was moved once, before publishing, from `64c691b` to `925e698` so that it includes the `node-abi` dev-dependency fix the first CI run found (a dry run on `main` was green first). Verified: the Marketplace page (README and images, PolyForm Shield, version, Preview badge) and an install from the Marketplace into a clean profile. Open VSX decision: not for the first preview; recorded in `docs/01_input-ideas.md` and `docs/02_assumptions-and-risks.md`, to be revisited after feedback.

> Announcement (owner follow-up, 2026-11-14): a draft exists; the owner announces on LinkedIn first and checks for Daisy Seed communities (Electro-Smith forum, Discord) afterwards. Not a release blocker.
