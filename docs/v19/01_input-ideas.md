# 01 — Input Ideas (v19)

> **v1 complete** — ds-ide 0.1.0–0.1.7 (M0–M7), all ACs green. Full v1 ideas archived in
> [`docs/v1/01_input-ideas.md`](v1/01_input-ideas.md).
>
> **v2 complete** — ds-ide 0.2.0–0.2.9 (M8–M15), all ACs green. Full v2 ideas archived in
> [`docs/v2/01_input-ideas.md`](v2/01_input-ideas.md).
>
> **v3 complete** — ds-ide 0.3.0–0.3.3 (M16–M18), all ACs green. Full v3 ideas archived in
> [`docs/v3/01_input-ideas.md`](v3/01_input-ideas.md).
>
> **v4 complete** — ds-ide 0.4.0–0.4.3 (M19–M22), all ACs green. Full v4 ideas archived in
> [`docs/v4/01_input-ideas.md`](v4/01_input-ideas.md).
>
> **v5 complete** — ds-ide 0.5.0–0.5.1 (M23–M24), all ACs green. Full v5 ideas archived in
> [`docs/v5/01_input-ideas.md`](v5/01_input-ideas.md).
>
> **v6 complete** — archived to `docs/v6/` on 2026-06-21. Full v6 ideas archived in
> [`docs/v6/01_input-ideas.md`](v6/01_input-ideas.md).
>
> **v7 complete** — archived to `docs/v7/` on 2026-06-21. Full v7 ideas archived in
> [`docs/v7/01_input-ideas.md`](v7/01_input-ideas.md).
>
> **v8 complete** — archived to `docs/v8/` on 2026-06-22. Full v8 ideas archived in
> [`docs/v8/01_input-ideas.md`](v8/01_input-ideas.md).
>
> **v9 complete** — archived to `docs/v9/` on 2026-06-29. Full v9 ideas archived in
> [`docs/v9/01_input-ideas.md`](v9/01_input-ideas.md).
>
> **v10 complete** — archived to `docs/v10/` on 2026-06-30. Full v10 ideas archived in
> [`docs/v10/01_input-ideas.md`](v10/01_input-ideas.md).
>
> **v11 complete** — archived to `docs/v11/` on 2026-07-04. Full v11 ideas archived in
> [`docs/v11/01_input-ideas.md`](v11/01_input-ideas.md).
>
> **v12 complete** — archived to `docs/v12/` on 2026-07-05. Full v12 ideas archived in
> [`docs/v12/01_input-ideas.md`](v12/01_input-ideas.md).
>
> **v13 complete** — archived to `docs/v13/` on 2026-07-05. Full v13 ideas archived in
> [`docs/v13/01_input-ideas.md`](v13/01_input-ideas.md).
>
> **v14 complete** — archived to `docs/v14/` on 2026-07-22. Full v14 ideas archived in
> [`docs/v14/01_input-ideas.md`](v14/01_input-ideas.md).
>
> **v15 complete** — archived to `docs/v15/` on 2026-07-25. Full v15 ideas archived in
> [`docs/v15/01_input-ideas.md`](v15/01_input-ideas.md).
>
> **v16 complete** — archived to `docs/v16/` on 2026-07-25. Full v16 ideas archived in
> [`docs/v16/01_input-ideas.md`](v16/01_input-ideas.md).
>
> **v17 complete** — archived to `docs/v17/` on 2026-08-23. Full v17 ideas archived in
> [`docs/v17/01_input-ideas.md`](v17/01_input-ideas.md).
>
> **v18 complete** — archived to `docs/v18/` on 2026-08-25. Full v18 ideas archived in
> [`docs/v18/01_input-ideas.md`](v18/01_input-ideas.md).

## Bugs received

- **Stale CMake build cache breaks builds when the `emulator/` source path changes** (bug report, 2026-08-26, found while validating the M58 packaged `.vsix` install). Observed: after packaging and installing `ds-ide` as a normal VS Code extension (`~/.vscode/extensions/daisy-ide.ds-ide-<version>/`), building a project previously built from the dev-host checkout fails with `CMake Error: The source "<extensionPath>/emulator/CMakeLists.txt" does not match the source "..." used to generate cache. Re-run cmake with a different source directory.` Expected: the build should succeed transparently regardless of which `extensionPath` (dev-host checkout vs. installed extension, or an upgraded extension version) produced a project's existing `.ds-ide/build/` cache. Root cause (confirmed via code read of `src/emulator/manager.ts` and `src/commands/build.ts`): the build dir is per-project (`<project>/.ds-ide/build`), persists indefinitely, and CMake hardcodes the `-S` source path (`<extensionPath>/emulator`) it was configured with into `CMakeCache.txt`'s `CMAKE_HOME_DIRECTORY`. `extensionPath` differs between dev-host and installed-extension contexts, and CMake refuses to reconfigure a cache against a different source path. No cache-invalidation/mismatch-detection logic exists anywhere in `build()` today. Reproduced across 12 test projects after installing the packaged `.vsix`; required manually deleting each `.ds-ide/build/` to unblock.

- **`daisy-debug` attach session throws "Exception has occurred: signal SIGSTOP" on stop** (human-driven test finding, M53 sprint-close, 2026-08-25; carried over from v18 — untriaged there). Observed: stopping a `daisy-debug` attach session (lldb-dap, `src/debug/debug-adapter.ts`) surfaces `Exception has occurred: signal SIGSTOP` in the Debug Console. Confirmed present on `main` prior to the M53 branch — unrelated to the `resolveActiveFolder()`/`startDebugging()` folder-argument changes (FR-UX-6), so was out of scope there. Root cause (per `/doc-creator-driver:intake` code review of `src/commands/debug-deploy.ts`): the attach request (`request: 'attach', pid`, no `stopOnEntry`/signal config) relies entirely on lldb-dap defaults. Attaching via PID on macOS necessarily delivers `SIGSTOP` to halt the target for the debugger; lldb-dap has no dedicated DAP "signal" stop reason, so it reports the mandatory attach-time stop as a `stopped` event with `reason: "exception"`, which VS Code renders as "Exception has occurred: ...". This is very likely benign/expected lldb-dap behavior, not an actual fault — but it reads as a crash to a developer and needs a product decision on whether to suppress it client-side or document it as expected.
