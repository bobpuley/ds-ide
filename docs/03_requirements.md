# 03 — Requirements (v19)

> **v18 complete** — all v18 requirements implemented; ACs green.
> Archived: [`docs/v18/03_requirements.md`](v18/03_requirements.md).

*v19 requirements not yet defined.*

---

**FR-UX-7 — Stopping a `daisy-debug` attach session does not surface a spurious "exception"**

Stopping a `daisy-debug` attach session (lldb-dap, `src/debug/debug-adapter.ts`) surfaces `Exception has occurred: signal SIGSTOP` in the Debug Console. Investigation (`/doc-creator-driver:intake`, 2026-08-26) confirmed this is very likely a benign artifact of lldb's own detach mechanics, not a real fault: `debug-deploy.ts`/`run-config-provider.ts` start attach sessions with no signal/disconnect configuration; lldb-dap's `initialize` response exposes no exception filter or flag for signal-stops (only C++/ObjC/Swift catch/throw); and upstream LLDB issue history documents this exact class of behavior — a pending/leftover `SIGSTOP` delivered right at detach time because the underlying detach primitive requires the target to be momentarily stopped — with LLDB's own upstream fix being to send `SIGCONT` immediately before detaching. `vscode.DebugAdapterTracker` (already used for mute-on-breakpoint) is read-only and cannot drop or rewrite DAP messages, so suppressing this client-side requires replacing the current direct `DebugAdapterExecutable` passthrough for `daisy-debug` with a filtering proxy adapter, following the same inline-adapter pattern already used for the `ds-ide` wrapper type (`DsIdeTerminatingAdapter` in `run-config-provider.ts`).

AC: stopping a `daisy-debug` attach session (via the VS Code Stop button, for both the `ds-ide.debug` PID-attach path and the F5 launch-configuration path) never shows `Exception has occurred: signal SIGSTOP` (or any DAP `stopped` event whose reason is `exception` and description references `SIGSTOP`) in the Debug Console.

AC: no other `stopped`/`exception` event — i.e. a real breakpoint hit, a real crash, or any signal other than the detach-time `SIGSTOP` — is filtered or suppressed by the new proxy adapter.

AC: unit tests cover the filtering adapter directly (feed it a raw DAP message stream including the spurious event, assert it does not reach `onDidSendMessage`/the client, and assert a real `stopped`/`exception` event does reach the client unchanged).

---

**FR-PKG-2 — Building a project self-heals a CMake cache configured against a stale `emulator/` source path**

`EmulatorManager.build()` (`src/emulator/manager.ts`) always invokes `cmake -S <extensionPath>/emulator -B <project>/.ds-ide/build` without checking whether an existing `CMakeCache.txt` in that build directory was configured from a different `extensionPath/emulator` source. Since `<project>/.ds-ide/build` persists indefinitely per-project while `extensionPath` changes whenever the same project is built from a different context (dev-host checkout vs. installed extension, or across an extension version upgrade that touches `emulator/CMakeLists.txt`), CMake's configure step fails outright with "the source ... does not match the source ... used to generate cache," blocking the build with no recovery path other than manually deleting the build directory.

Before invoking `cmake -S/-B` configure, `build()` must detect a source-path mismatch (read `CMakeCache.txt`'s `CMAKE_HOME_DIRECTORY`, if present, and compare it against the current `emulatorSrc`) and, on mismatch, delete the stale `<project>/.ds-ide/build` directory and reconfigure fresh — automatically, with no user confirmation required.

AC: building a project whose `.ds-ide/build/CMakeCache.txt` was configured against a different `emulator/` source path succeeds without the user seeing any CMake source-mismatch error, and without any manual deletion of `.ds-ide/build/`.

AC: the build dir is wiped and reconfigured automatically on mismatch — no confirmation prompt, per user decision (2026-08-26) to prioritize a transparent "clean rebuild" experience over an extra click.

AC: a build whose cache already matches the current `emulatorSrc` is unaffected — no unnecessary wipe/reconfigure occurs, and existing incremental-build performance is preserved.

AC: unit/integration test covers the mismatch-detection path directly (seed a `.ds-ide/build/CMakeCache.txt` with a different `CMAKE_HOME_DIRECTORY`, call `build()`, assert the stale directory is removed and CMake reconfigures against the current source without error).

---
