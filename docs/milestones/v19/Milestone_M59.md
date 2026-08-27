# M59 — Stale Build-Cache Self-Heal

**Version:** 0.17.7
**Status:** planned
**Source:** bug report, found while validating the M58 packaged `.vsix` install (2026-08-26); triaged via `/doc-creator-driver:intake`

## Goal

Building a Daisy project after switching contexts — dev-host checkout to installed extension, or across an extension version upgrade that touches `emulator/CMakeLists.txt` — currently fails with a raw CMake "source does not match cache" error, requiring the user to manually find and delete `<project>/.ds-ide/build/`. After this milestone, `EmulatorManager.build()` detects a source-path mismatch against the existing `CMakeCache.txt` and transparently wipes and reconfigures the stale build directory, so the build just succeeds.

## Sprint Tasks

### [x] fix: self-heal a CMake build cache configured against a stale `emulator/` source path (FR-PKG-2)

`build()` (`src/emulator/manager.ts`) always runs `cmake -S <extensionPath>/emulator -B <project>/.ds-ide/build` with no check for a prior `CMakeCache.txt` configured against a different source path. Add a pre-check: if `<project>/.ds-ide/build/CMakeCache.txt` exists and its `CMAKE_HOME_DIRECTORY` differs from the current `emulatorSrc`, delete the build directory before the existing `mkdir`+configure flow runs. No user confirmation — auto-clean per user decision (2026-08-26).

**Affected files:** `src/emulator/manager.ts`, `src/test/unit/emulator/manager.test.ts`

**DoD:**
- Building a project whose cache was configured against a different `emulator/` source path succeeds with no CMake source-mismatch error and no manual deletion of `.ds-ide/build/`.
- The stale build dir is wiped and reconfigured automatically, without prompting the user for confirmation.
- A build whose cache already matches the current `emulatorSrc` is unaffected — no unnecessary wipe, no incremental-build performance regression.
- Unit test seeds a `.ds-ide/build/CMakeCache.txt` with a mismatched `CMAKE_HOME_DIRECTORY`, calls `build()`, and asserts the stale directory is removed and CMake reconfigures cleanly.
