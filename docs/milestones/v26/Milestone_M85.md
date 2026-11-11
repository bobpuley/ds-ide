# M85 — First-Run Experience Fixes

**Version:** 0.24.4
**Status:** in progress
**Source:** intake session, 2026-11-11 (fresh-profile install test for the first public preview; `docs/release_plan.md`)

## Goal

A first-time user installing the extension into a clean VS Code profile hits three silent dead ends: an untrusted folder hides the Controls and Wiring icons with no explanation, a missing CMake fails the build with a generic message that gives no cause, and the Run button and Run/Debug/Stop commands stay missing until another command activates the extension. After this milestone the extension declares its workspace-trust requirement and the README says to trust the folder, a missing CMake is detected and reported with an actionable message, and opening a Daisy project is enough to make Run available.

## Sprint Tasks

### [x] feat: declare workspace-trust support and document it (FR-REL-1)

In Restricted Mode the Controls and Wiring activity-bar icons are missing and nothing says why; they appear once the folder is trusted. The manifest declares no `capabilities.untrustedWorkspaces`.

**Affected files:** `package.json`, `README.md`, `src/test/unit/build/package-metadata.test.ts`

**DoD:**
- `package.json` declares `capabilities.untrustedWorkspaces` with `supported: false` and a description saying Daisy IDE builds and runs the project's code and needs a trusted folder
- the README quick start tells the user to trust the folder when VS Code asks
- `package-metadata.test.ts` fails if the declaration or its description is missing
- a fresh-profile run of the packaged `.vsix` on an untrusted folder shows VS Code's trust prompt for the extension instead of silently missing icons (verified by hand; the actual behaviour of `false` vs `limited` is recorded in `02_assumptions-and-risks.md`)

---

### [x] feat: detect CMake and report it missing clearly (FR-REL-2)

With `cmake` not on `PATH`, Run Daisy Effect shows only "Build failed. Nothing was deployed." and a Show Problems button that opens an empty list: `runProcess` rejects with `spawn cmake ENOENT`, nothing is written to the build channel, and the Run path suppresses the generic toast.

**Affected files:** `src/hardware/toolchain.ts`, `src/emulator/manager.ts`, `src/commands/build.ts`, `src/transport/transport-controller.ts`, `src/test/unit/hardware/toolchain.test.ts`, `src/test/unit/emulator/manager.test.ts`, `src/test/unit/commands/build.test.ts`, `src/test/unit/transport/transport-controller.test.ts`

**DoD:**
- `detectCMake()` resolves `which cmake`, then `/opt/homebrew/bin/cmake` and `/usr/local/bin/cmake`; a `PATH` match wins; the helper takes injectable `exists`/`exec` like `detectDfuUtil()`
- `EmulatorManager.build()` runs the resolved CMake for both configure and build steps
- when no CMake is found, or `spawn` fails with `ENOENT`, the build fails with "CMake not found. Install it (`brew install cmake`) and try again." — shown by Run Daisy Effect, Build & Deploy and Build for Emulator, and also written to the build output channel
- the buildFailed notification carries that reason instead of the generic "Build failed. Nothing was deployed." and does not offer an empty Show Problems; a CMake that starts and then fails still goes through the existing diagnostics path unchanged
- unit tests cover the detection order, the ENOENT mapping and the notification text; the existing suites pass unchanged

---

### [ ] fix: activate the extension when a Daisy project is opened (FR-REL-3)

`ds-ide.runEffect`, `debugEffect` and `stopEffect` are `enablement: ds-ide.isDaisyProject` (a disabled command is hidden from the Command Palette) and the editor-title buttons need `ds-ide.isDaisyProject && ds-ide.isEffectSource`. Both keys are set only in `activate()`, and the manifest has no `activationEvents`, so a freshly opened project shows no Run button and no Run command until another command or view activates the extension.

**Affected files:** `package.json`, `src/test/unit/build/package-metadata.test.ts`

**DoD:**
- `package.json` declares `activationEvents` `workspaceContains:*.cpp`, `workspaceContains:src/*.cpp` and `workspaceContains:source/*.cpp` (the locations `findEffectSource` searches), and no `*` or `onStartupFinished` event
- `package-metadata.test.ts` fails if any of those events is missing or a wildcard / `onStartupFinished` event is present
- in a fresh VS Code profile, opening an untouched Daisy project and its effect source shows the editor-title play button and lists "Daisy IDE: Run Daisy Effect" in the Command Palette without using any other command or view first (verified by hand with the packaged `.vsix`)
