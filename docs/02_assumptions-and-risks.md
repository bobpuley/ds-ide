# 02 — Assumptions & Risks (v19)

> **All prior versions complete** — full bet/risk history in their respective archives.
> **v18 complete** — all v18 bets held; risks resolved or managed.
> Archived: [`docs/v18/02_assumptions-and-risks.md`](v18/02_assumptions-and-risks.md).

*v19 bets and risks to be defined during planning.*

---

> ⚠️ ASSUMPTION: `daisy-debug` attach sessions (`src/debug/debug-adapter.ts`) can rely on lldb-dap's default attach/disconnect behavior without ds-ide mediating the DAP message stream. FR-UX-7/M58 (2026-08-26) showed this is false in at least one case — lldb-dap's own detach mechanics surface a spurious `stopped`/`exception` event (`signal SIGSTOP`) that a bare `DebugAdapterExecutable` passthrough has no way to filter. Not logged as an open risk since M58 addresses it directly (filtering proxy adapter); flagged here in case future `daisy-debug` work (e.g. new attach/launch configuration options) reintroduces reliance on unmediated lldb-dap defaults elsewhere.
