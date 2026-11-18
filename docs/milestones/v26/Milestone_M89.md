# M89 — First-Run Polish II

**Version:** 0.24.8
**Status:** released
**Source:** intake session, 2026-11-14 (first public preview; `docs/release_plan.md`)

## Goal

A first-time user still meets four rough edges that M85 did not cover: a missing compiler or debugger gives no hint what to install, the hardware tools' messages were only ever read in code, Build for Hardware fails with "No targets specified and no makefile found" on every project this extension creates, and Deploy to Emulator right after opening a window says "Build before deploying" although a build exists. The manifest also claims VS Code 1.85 while only 1.140 (the Electron the native MIDI addon is built for) has ever run. After this milestone each of these either works or says exactly what to do.

## Sprint Tasks

### [x] feat: say what is missing when the compiler or lldb-dap is not found (FR-PRE-1)

**Affected files:** `src/hardware/toolchain.ts`, `src/emulator/manager.ts`, `src/commands/build.ts`, `src/debug/` (the lldb-dap launch path), `src/test/unit/hardware/toolchain.test.ts`, `src/test/unit/emulator/manager.test.ts`, `src/test/unit/debug/`

**DoD:**
- with no C++ compiler (no Xcode Command Line Tools), the emulator build stops before CMake with "Xcode Command Line Tools not found. Run `xcode-select --install` and try again.", in the notification and the output channel, with no empty Show Problems button
- with no `lldb-dap` (not on `PATH`, not in the Xcode toolchain), **Debug Daisy Effect** stops with a message naming the same install command
- detection follows FR-REL-2's pattern (`which`, then known locations) and has unit tests for found, not found, and the message
- both messages are triggered for real with a minimal `PATH` and the observed text matches

---

### [x] feat: verify the Arm toolchain and dfu-util messages for real (FR-PRE-2)

**Affected files:** `src/hardware/toolchain.ts`, `src/commands/hardware-build.ts`, `src/commands/dfu-flash.ts`, `src/test/unit/hardware/toolchain.test.ts`, `src/test/unit/commands/`

**DoD:**
- with the Arm toolchain missing (minimal `PATH`, a project that has a `Makefile`), **Build for Hardware** shows the existing install hint in the notification and the output channel
- with `dfu-util` missing, **Flash to Daisy Seed** shows its hint
- each detection and message has a unit test; any gap found by running them for real is fixed in this task

---

### [x] feat: Build for Hardware checks for a Makefile first (FR-PRE-3)

**Affected files:** `src/commands/hardware-build.ts`, `src/test/unit/commands/hardware-build.test.ts`

**DoD:**
- with no `Makefile` in the project root, `make` is not run; the message "No Makefile in this project. Build for Hardware needs a libDaisy-style project; see Limitations in the README." shows in the notification and the output channel
- a project with a `Makefile` builds as before
- a unit test fails without the pre-check

---

### [x] fix: Deploy to Emulator works, or explains itself, after a restart (FR-PRE-4)

**Affected files:** `src/emulator/manager.ts`, `src/extension.ts`, `src/test/unit/emulator/manager.test.ts`, `src/test/unit/extension.test.ts`

**DoD:**
- in a fresh window, **Deploy to Emulator** uses `<project>/.ds-ide/build/effect_emu` when it exists
- when no build exists, it says "Nothing built yet. Run Daisy IDE: Run Daisy Effect, or Build for Emulator first." (no "Build before deploying")
- the Scope and Controls Editor open only after a successful deploy; a failed deploy opens nothing
- unit tests cover the existing-build, no-build and failed-deploy cases

---

### [x] chore: set engines.vscode to the tested version and check the MIDI addon failing to load (FR-PRE-5)

**Affected files:** `package.json`, `README.md`, `CONTRIBUTING.md`, `src/test/unit/build/package-metadata.test.ts`, `src/midi/`

**DoD:**
- `package.json` `engines.vscode` is `^1.140.0`; the README's requirement reads "VS Code 1.140 or later"; a unit test fails when they disagree
- `CONTRIBUTING.md` says a VS Code update that changes Electron means updating the pin, rebuilding the native addon and revisiting `engines`
- with the native `midi` addon unable to load (simulated), the extension still activates and the on-screen MIDI keyboard works; a unit test covers it and any needed fix is made
