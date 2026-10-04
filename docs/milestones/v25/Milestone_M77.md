# M77 — Windows Build Foundations

**Version:** 0.25.0-win.1
**Status:** in progress
**Source:** intake session, 2026-10-04 (`multiplatform_plan.md`; 01_input-ideas.md). Branch `feat/m77-windows-build-foundations` is created from `feat/windows-support` and merged back into `feat/windows-support` at close (never `main`) — FR-WIN-GIT-1

## Goal

The emulator and extension assume POSIX and macOS in places that stop them from compiling or testing on Windows, and nothing automatically shows which. After this milestone a Windows CI runner runs the TypeScript unit tests, every emulator source except the IPC server compiles under clang/MinGW, CMake splits sources and libraries per platform, and the extension invokes the build and locates the binary in a Windows-safe way; macOS behaviour is unchanged.

## Sprint Tasks

### [x] chore: add Windows CI runner for TypeScript unit tests (FR-WIN-BLD-1)

TypeScript tests stub `fs` and `child_process`, so passing on macOS says nothing about Windows. The repository has no `.github/` directory today, so no CI exists yet; this task introduces the first workflow. The branch `chore/windows-compat` (`b86d7bc`, on `origin`) already contains Windows test fixes.

**Affected files:** `.github/workflows/windows-ci.yml`, `src/test/**`, `vitest.config.ts`

**DoD:**
- a CI workflow runs `vitest` on a Windows runner for pushes and PRs to `feat/windows-support` and fails on any failing test
- `b86d7bc` is reviewed against current code; still-valid fixes are brought in, obsolete ones dropped
- any test skipped on Windows is skipped explicitly with a stated reason
- the Windows run is green and the existing macOS suites (TypeScript unit tests, emulator C++ test runners, `tests/build-flags`, runtime/functional tests) pass unchanged (FR-WIN-GIT-2)

---

### [x] refactor: remove POSIX-only includes from runtime and shim files (FR-WIN-BLD-2)

`wav_reader.cpp`, `session_player.cpp`, `session_recorder.cpp` and `fatfs_host.cpp` include `<unistd.h>`, `<sys/stat.h>` and `<fcntl.h>` and use POSIX `mkdir(path, 0755)`/`open` flags.

**Affected files:** `emulator/runtime/wav_reader.cpp`, `emulator/runtime/session_player.cpp`, `emulator/runtime/session_recorder.cpp`, `emulator/shim/src/fatfs_host.cpp`

**DoD:**
- none of the four files includes a POSIX-only header; file/directory operations use `std::filesystem`/standard I/O or a small platform shim
- file creation modes and error handling relied on by the recorder/player on macOS are preserved and covered by existing tests
- the four files compile with `clang++ --target=x86_64-w64-mingw32` (compile only)
- the existing macOS suites (TypeScript unit tests, emulator C++ test runners, `tests/build-flags`, runtime/functional tests) pass unchanged (FR-WIN-GIT-2)

---

### [ ] fix: guard POSIX-only process setup in main.cpp (FR-WIN-BLD-3)

`std::signal(SIGPIPE, SIG_IGN)` does not compile on Windows, where `SIGPIPE` is not defined.

**Affected files:** `emulator/runtime/main.cpp`

**DoD:**
- `SIGPIPE` handling is compiled only on non-Windows platforms; the SIGTERM/SIGINT shutdown-flag handler remains
- `main.cpp` compiles with clang/MinGW (compile only)
- macOS shutdown-on-SIGTERM behaviour is unchanged (the existing macOS suites (TypeScript unit tests, emulator C++ test runners, `tests/build-flags`, runtime/functional tests) pass unchanged (FR-WIN-GIT-2))

---

### [ ] feat: split CMake sources and libraries per platform under clang/MinGW (FR-WIN-BLD-4)

`core_audio_device.cpp` is listed unconditionally and CoreAudio/AudioToolbox are linked under `if(APPLE)` only; the flags are GCC/Clang-style and must keep working under clang/MinGW.

**Affected files:** `emulator/CMakeLists.txt`, `tests/build-flags/check_compile_flags.py`

**DoD:**
- CMake configures on Windows with clang/MinGW and Ninja, selecting sources and libraries per platform (the non-Apple audio stub is used until M80)
- every runtime/shim source except `ipc_server.cpp` compiles on Windows; `ipc_server.cpp` is explicitly excluded or stubbed on Windows until M78, and full linking of `effect_emu` is M78's DoD
- ASan/UBSan/TSan options are either working or explicitly guarded per platform
- `check_compile_flags.py` source list matches the CMake source list
- the existing macOS suites (TypeScript unit tests, emulator C++ test runners, `tests/build-flags`, runtime/functional tests) pass unchanged (FR-WIN-GIT-2)

---

### [ ] fix: build invocation and emulator binary path on Windows (FR-WIN-BLD-5)

`manager.ts` runs `cmake --build <dir> -- -j<N>`, which is invalid for MSBuild, and looks for `effect_emu` without `.exe`.

**Affected files:** `src/emulator/manager.ts`, `src/test/unit/emulator/manager.test.ts`

**DoD:**
- the build uses `cmake --build <dir> -j <N>` and, on Windows, configures with `-G Ninja`
- the executable path resolves to `effect_emu.exe` on Windows and `effect_emu` on macOS, covered by unit tests
- unit tests assert the exact cmake argument lists for both platforms
- the existing macOS suites (TypeScript unit tests, emulator C++ test runners, `tests/build-flags`, runtime/functional tests) pass unchanged (FR-WIN-GIT-2)
