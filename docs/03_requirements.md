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
