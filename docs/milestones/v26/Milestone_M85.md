# M85 — First-Run Experience Fixes

**Version:** 0.24.4
**Status:** in progress
**Source:** intake session, 2026-11-11 (fresh-profile install test for the first public preview; `docs/release_plan.md`)

## Goal

A first-time user installing the extension into a clean VS Code profile hits two silent dead ends: an untrusted folder hides the Controls and Wiring icons with no explanation, and a missing CMake fails the build with a generic message that gives no cause. After this milestone the extension declares its workspace-trust requirement and the README says to trust the folder, and a missing CMake is detected and reported with an actionable message.

## Sprint Tasks

### [ ] feat: declare workspace-trust support and document it (FR-REL-1)

In Restricted Mode the Controls and Wiring activity-bar icons are missing and nothing says why; they appear once the folder is trusted. The manifest declares no `capabilities.untrustedWorkspaces`.

**Affected files:** `package.json`, `README.md`, `src/test/unit/build/package-metadata.test.ts`

**DoD:**
- `package.json` declares `capabilities.untrustedWorkspaces` with `supported: false` and a description saying Daisy IDE builds and runs the project's code and needs a trusted folder
- the README quick start tells the user to trust the folder when VS Code asks
- `package-metadata.test.ts` fails if the declaration or its description is missing
- a fresh-profile run of the packaged `.vsix` on an untrusted folder shows VS Code's trust prompt for the extension instead of silently missing icons (verified by hand; the actual behaviour of `false` vs `limited` is recorded in `02_assumptions-and-risks.md`)

---

### [ ] feat: detect CMake and report it missing clearly (FR-REL-2)

With `cmake` not on `PATH`, Run Daisy Effect shows only "Build failed. Nothing was deployed." and a Show Problems button that opens an empty list: `runProcess` rejects with `spawn cmake ENOENT`, nothing is written to the build channel, and the Run path suppresses the generic toast.

**Affected files:** `src/hardware/toolchain.ts`, `src/emulator/manager.ts`, `src/commands/build.ts`, `src/transport/transport-controller.ts`, `src/test/unit/hardware/toolchain.test.ts`, `src/test/unit/emulator/manager.test.ts`, `src/test/unit/commands/build.test.ts`, `src/test/unit/transport/transport-controller.test.ts`

**DoD:**
- `detectCMake()` resolves `which cmake`, then `/opt/homebrew/bin/cmake` and `/usr/local/bin/cmake`; a `PATH` match wins; the helper takes injectable `exists`/`exec` like `detectDfuUtil()`
- `EmulatorManager.build()` runs the resolved CMake for both configure and build steps
- when no CMake is found, or `spawn` fails with `ENOENT`, the build fails with "CMake not found. Install it (`brew install cmake`) and try again." — shown by Run Daisy Effect, Build & Deploy and Build for Emulator, and also written to the build output channel
- the buildFailed notification carries that reason instead of the generic "Build failed. Nothing was deployed." and does not offer an empty Show Problems; a CMake that starts and then fails still goes through the existing diagnostics path unchanged
- unit tests cover the detection order, the ENOENT mapping and the notification text; the existing suites pass unchanged
