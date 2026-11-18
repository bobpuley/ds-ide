# M82 — Managed Windows Toolchain Download

**Version:** 0.25.0-win.6
**Status:** planned
**Source:** intake session, 2026-10-04 (`multiplatform_plan.md`; 01_input-ideas.md). Branch `feat/m82-managed-toolchain-download` is created from `feat/windows-support` and merged back into `feat/windows-support` at close (never `main`) — FR-WIN-GIT-1

## Goal

A Windows user without clang/MinGW, CMake and Ninja cannot build the emulator or debug. After this milestone the extension offers to download a hash-pinned toolchain on first use into its own storage, with consent, progress, verification and recovery paths, and every tool lookup falls back to it automatically.

## Sprint Tasks

### [ ] feat: pinned toolchain manifest and mirror (FR-WIN-TCH-4)

Upstream release assets can be removed and Ninja publishes no hash file, so versions and hashes are pinned by us.

**Affected files:** `resources/windows-toolchain.json`, `scripts/update-toolchain-manifest.mjs`, `docs/toolchain-mirror.md`

**DoD:**
- the manifest lists version, URL and our own SHA-256 for llvm-mingw, CMake and Ninja, plus a mirror URL under ds-ide release assets
- a script computes and verifies hashes when a version is adopted
- the pinned llvm-mingw archive is confirmed to contain `bin/lldb-dap.exe`

---

### [ ] feat: downloader, verifier and atomic installer (FR-WIN-TCH-4)

Several hundred MB must be downloaded and extracted safely on Windows.

**Affected files:** `src/toolchain/managed-toolchain.ts`, `src/toolchain/download.ts`, `src/toolchain/extract.ts`, `src/test/unit/toolchain/managed-toolchain.test.ts`

**DoD:**
- downloads over HTTPS to a temporary file, verifies SHA-256 before extracting, extracts to a temporary directory and renames atomically into `context.globalStorageUri/<toolchain-version>/`
- unused target sysroots (i686, aarch64, armv7) are pruned after extraction; superseded versions are removed
- a partial or corrupt download or extraction is never treated as a valid install
- falls back to the mirror when the primary source fails; unit tests cover hash mismatch, interruption, disk-full and mirror fallback with injected I/O

---

### [ ] feat: consent, progress and recovery UX (FR-WIN-TCH-4)

A large download needs explicit consent and a way out.

**Affected files:** `src/toolchain/managed-toolchain-ui.ts`, `src/emulator/manager.ts`, `src/debug/debug-adapter.ts`, `package.json`

**DoD:**
- when no toolchain is found on Windows, a prompt shows the download size and asks for consent before downloading
- free disk space is checked before extracting
- progress is a cancellable notification (the existing `CancellationToken` pattern, FR-EXT-16); failures (offline, proxy, hash mismatch, disk full) show a clear message and a retry
- an "install from local archive" command supports air-gapped machines

---

### [ ] feat: managed toolchain joins the lookup order (FR-WIN-TCH-5)

M81 left the managed-toolchain step as an extension point.

**Affected files:** `src/hardware/tool-locator.ts`, `src/emulator/manager.ts`, `src/commands/hardware-build.ts`

**DoD:**
- the lookup order becomes configured path → PATH → managed download → prompt, for the emulator build, hardware build and `lldb-dap`
- a user-installed toolchain continues to take precedence as an override
- a fresh Windows profile with no toolchain reaches a successful emulator build after one consented download (verified manually and recorded for M84)
- the existing macOS suites (TypeScript unit tests, emulator C++ test runners, `tests/build-flags`, runtime/functional tests) pass unchanged (FR-WIN-GIT-2)
