# 02 — Assumptions & Risks (v19)

> **All prior versions complete** — full bet/risk history in their respective archives.
> **v18 complete** — all v18 bets held; risks resolved or managed.
> Archived: [`docs/v18/02_assumptions-and-risks.md`](v18/02_assumptions-and-risks.md).

*v19 bets and risks to be defined during planning.*

---

> ⚠️ ASSUMPTION: `daisy-debug` attach sessions (`src/debug/debug-adapter.ts`) can rely on lldb-dap's default attach/disconnect behavior without ds-ide mediating the DAP message stream. FR-UX-7/M58 (2026-08-26) showed this is false in at least one case — lldb-dap's own detach mechanics surface a spurious `stopped`/`exception` event (`signal SIGSTOP`) that a bare `DebugAdapterExecutable` passthrough has no way to filter. Not logged as an open risk since M58 addresses it directly (filtering proxy adapter); flagged here in case future `daisy-debug` work (e.g. new attach/launch configuration options) reintroduces reliance on unmediated lldb-dap defaults elsewhere.

> ⚠️ ASSUMPTION: `<project>/.ds-ide/build`'s CMake cache is valid for the lifetime of the project, independent of which `extensionPath` (dev-host checkout vs. installed extension, or across extension version upgrades) produced it. FR-PKG-2/M59 (2026-08-26) showed this is false — CMake hardcodes the `-S` source path into `CMAKE_HOME_DIRECTORY`, and switching contexts (as any user will when moving from F5 dev-host testing to a locally installed `.vsix`) invalidates the cache outright with no built-in recovery. M59 addresses it directly (mismatch detection + auto-clean in `build()`); flagged here in case other per-project persistent state ds-ide manages (outside `.ds-ide/build`) makes the same implicit assumption about `extensionPath` stability.
