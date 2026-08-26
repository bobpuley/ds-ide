# 04 — Architecture (v19)

> **v18 complete** — full v18 architecture in
> [`docs/v18/04_architecture.md`](v18/04_architecture.md).

*v19 architecture not yet defined.*

## v19 notes

- **FR-UX-7 (suppress spurious `daisy-debug` disconnect exception):** architecture impact. `DaisyDebugAdapterFactory.createDebugAdapterDescriptor()` (`src/debug/debug-adapter.ts`) currently returns a direct `vscode.DebugAdapterExecutable` — VS Code spawns lldb-dap and wires its stdio straight to the client with no message in the middle. This must change to a filtering inline adapter, following the pattern `DsIdeTerminatingAdapter` already establishes in `src/debug/run-config-provider.ts` for the `ds-ide` wrapper type: the factory spawns lldb-dap itself as a child process (`vscode.DebugAdapterInlineImplementation` wrapping a `vscode.DebugAdapter` that owns the child's stdio), relays every DAP message in both directions unchanged, except it drops the one spurious `stopped` event (`reason: "exception"`, description referencing `SIGSTOP`) that lldb-dap emits during attach-session detach. `MuteOnBreakpointTracker`/`DaisyDebugAdapterTrackerFactory` are unaffected — they observe via the separate read-only `DebugAdapterTracker` hook and keep working against the (now filtered) message stream.
