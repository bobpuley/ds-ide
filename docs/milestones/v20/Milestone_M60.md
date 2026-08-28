# M60 — Wizard-Time DaisySP Provisioning

**Version:** 0.18.0
**Status:** planned
**Source:** feature idea evaluated via design discussion (2026-08-27), intake via `/doc-creator-driver:intake`

## Goal

New effect projects created via the Effect Project Wizard currently fail to build until the user manually creates a symlink to a DaisySP checkout elsewhere on disk — despite the wizard's own generated template already requiring `daisysp.h`. After this milestone, `Daisy IDE: New Effect Project` provisions a working DaisySP copy automatically: ds-ide vendors a pinned DaisySP as a git submodule of its own repo, bundles it into the packaged `.vsix`, and the wizard copies it into every new project so the emulator build (and a later hardware build) just work with no manual setup.

## Sprint Tasks

### [ ] chore: vendor DaisySP as a pinned git submodule bundled into the packaged extension (FR-PKG-3)

ds-ide's own repo currently has no local copy of DaisySP; `LICENSES.md` states it is "not bundled in the extension." Add DaisySP as a git submodule (`vendor/DaisySP/`) pinned to a specific upstream tag/commit, and update the extension's packaging configuration (`.vscodeignore`) so `vendor/DaisySP/Source` ships inside the `.vsix` alongside `emulator/`.

**Affected files:** `.gitmodules`, `vendor/DaisySP/` (new submodule), `.vscodeignore`, `LICENSES.md`

**DoD:**
- `vendor/DaisySP/` exists as a git submodule pinned to a specific tag/commit of the upstream DaisySP repo.
- A packaged `.vsix` (`npm run package`) includes `vendor/DaisySP/Source` in its contents.
- `LICENSES.md`'s DaisySP entry is updated to reflect that a copy is now bundled with the extension (MIT, attribution retained), no longer "not bundled."

---

### [ ] feat: Effect Project Wizard copies vendored DaisySP into new projects (FR-PKG-3)

`createEffectProject()` (`src/commands/create-effect-project.ts`) writes an effect template that includes `daisysp.h` but provisions no DaisySP dependency, leaving every new project unbuildable until the user manually symlinks one in. After the existing template-file writes, copy the extension's vendored `vendor/DaisySP/Source` (resolved from `extensionPath`) into the new project at `<project>/DaisySP/Source`, using `vscode.workspace.fs.copy(..., { recursive: true })` — a real file copy, not a symlink into `extensionPath`, since `extensionPath` is not stable across ds-ide upgrades/reinstalls (the same class of bug `FR-PKG-2`/M59 fixed for the CMake build cache). Update the generated `README.md` to note that DaisySP was vendored into the project and should be committed to the project's own version control.

**Affected files:** `src/commands/create-effect-project.ts`, `src/test/unit/commands/create-effect-project.test.ts`

**DoD:**
- Creating a new project via `Daisy IDE: New Effect Project` produces a project containing `DaisySP/Source` populated with the vendored DaisySP files, with no manual setup step.
- The new project builds successfully via `Daisy IDE: Build for Emulator` with no manual DaisySP setup.
- The copy is a real file copy, not a symlink into the extension's install directory.
- The generated `README.md` includes a note instructing the user to commit the vendored `DaisySP/` directory to their project's version control.
- Unit test covers the provisioning step directly: creating a project asserts the vendored DaisySP files are written at the expected path via a copy operation, not a symlink.
