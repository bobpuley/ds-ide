# M81 — Windows Toolchain, Debug & Flash Discovery

**Version:** 0.25.0-win.5
**Status:** planned
**Source:** intake session, 2026-10-04 (`multiplatform_plan.md`; 01_input-ideas.md). Branch `feat/m81-windows-toolchain-discovery` is created from `feat/windows-support` and merged back into `feat/windows-support` at close (never `main`) — FR-WIN-GIT-1

## Goal

Tool discovery, the hardware build and the debugger lookup are macOS-specific (Homebrew paths, `which`, `xcrun`, `:` PATH separator), so F5, Build & Flash and the emulator build cannot find their tools on Windows. After this milestone one lookup order finds a user-installed clang/MinGW, CMake, Ninja, `arm-none-eabi-gcc`, `make`, `dfu-util` and `lldb-dap` on Windows with the right install hints, and the hardware build and flash paths work or fail with a precise diagnostic.

## Sprint Tasks

### [x] refactor: single cross-platform tool lookup module (FR-WIN-TCH-5)

`toolchain.ts` and `debug-adapter.ts` each hard-code macOS paths and call `which`/`xcrun`.

**Affected files:** `src/hardware/toolchain.ts`, `src/debug/debug-adapter.ts`, `src/hardware/tool-locator.ts`, `src/test/unit/hardware/toolchain.test.ts`

**DoD:**
- one module resolves tools in the order configured path → PATH (`where.exe` on Windows) → known install locations; the managed-toolchain step is a documented extension point filled in M82
- `.exe` suffixes, `path.join` and `path.delimiter` replace hard-coded `/` and `:`
- macOS and Linux resolution results are unchanged; unit tests cover both platforms via injected `exists`/`exec`
- the existing macOS suites (TypeScript unit tests, emulator C++ test runners, `tests/build-flags`, runtime/functional tests) pass unchanged (FR-WIN-GIT-2)

---

### [x] feat: Windows discovery of arm-none-eabi-gcc, dfu-util and make (FR-WIN-TCH-1)

Candidate lists contain only Homebrew and `/usr` paths; install hints mention only Homebrew.

**Affected files:** `src/hardware/toolchain.ts`, `src/hardware/tool-locator.ts`

**DoD:**
- Windows candidates include the Arm GNU Toolchain default install, xPack and MSYS2 locations
- install hints are per platform
- unit tests cover found, not found and configured-path cases on Windows paths

---

### [ ] fix: hardware build PATH and make availability on Windows (FR-WIN-TCH-2)

`buildEnv()` prefixes PATH with a hard-coded `:`; `make` is spawned by name and is absent on stock Windows.

**Affected files:** `src/commands/hardware-build.ts`, `src/test/unit/commands/hardware-build.test.ts`

**DoD:**
- PATH is extended with `path.delimiter`
- a missing `make` produces a clear error naming how to get one
- whether the project's ARM `Makefile` builds with the Windows toolchain is verified on Windows and any needed adjustment made or documented in `multiplatform_plan.md` §6
- the existing macOS suites (TypeScript unit tests, emulator C++ test runners, `tests/build-flags`, runtime/functional tests) pass unchanged (FR-WIN-GIT-2)

---

### [x] feat: dfu-util on Windows: WinUSB diagnostic (FR-WIN-TCH-3)

`dfu-util` on Windows needs a WinUSB driver bound to the DFU device (typically via Zadig).

**Affected files:** `src/commands/dfu-flash.ts`, `src/hardware/board-detect.ts`, `src/hardware/toolchain.ts`

**DoD:**
- when the board enumerates but cannot be opened, the user sees a diagnostic naming the missing WinUSB driver and how to install it
- the exit-code-74 special case is verified against a Windows `dfu-util` build, or documented as unverified
- detection and flashing are unchanged on macOS (the existing macOS suites (TypeScript unit tests, emulator C++ test runners, `tests/build-flags`, runtime/functional tests) pass unchanged (FR-WIN-GIT-2))

---

### [x] feat: per-platform lldb-dap resolver (FR-WIN-DBG-1)

`lldb-dap` discovery uses `xcrun --find`, Xcode paths and `which`; its error says to run `xcode-select --install`.

**Affected files:** `src/debug/debug-adapter.ts`, `src/hardware/tool-locator.ts`, `src/test/unit/debug/debug-adapter.test.ts`

**DoD:**
- a per-platform resolver finds `lldb-dap` on macOS (unchanged), Linux (existing versioned names) and Windows (clang/MinGW toolchain from the lookup order)
- the not-found message names the correct remedy per platform
- the DAP proxy, `MuteOnBreakpointTracker` and spurious-SIGSTOP filter are untouched
- the existing macOS suites (TypeScript unit tests, emulator C++ test runners, `tests/build-flags`, runtime/functional tests) pass unchanged (FR-WIN-GIT-2)
