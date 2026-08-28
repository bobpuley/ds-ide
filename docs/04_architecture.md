# 04 — Architecture (v20)

> **v19 complete** — full v19 architecture in
> [`docs/v19/04_architecture.md`](v19/04_architecture.md).

*v20 architecture not yet defined.*

## v20 notes

- **FR-PKG-3 (wizard-time DaisySP provisioning):** architecture impact. ds-ide's own repo adds DaisySP as a git submodule (e.g. `vendor/DaisySP/`), pinned to a specific upstream tag/commit — mirroring how DaisySP is normally consumed in Daisy projects, and making version bumps an explicit, reviewable "update submodule pointer" change rather than a silently-forgotten manual copy step. The extension's packaging step (`.vscodeignore`/`vsce package` config) must include `vendor/DaisySP/Source` in the shipped `.vsix` alongside `emulator/`. `createEffectProject()` (`src/commands/create-effect-project.ts`) gains a provisioning step after the existing template-file writes: copy `vendor/DaisySP/Source` (resolved from `extensionPath`, read at copy time — not symlinked, since `extensionPath` is not stable across ds-ide versions) into the new project at `<project>/DaisySP/Source`, using `vscode.workspace.fs.copy(..., { recursive: true })`. No change to `EmulatorManager`/`detectDaisySP()` — the copied directory is indistinguishable from a manually-symlinked or submoduled one once it lands at that conventional path.
