# M58 — Debug-Attach Detach Noise Fix

**Version:** 0.17.6
**Status:** released
**Source:** human-driven test finding, M53 sprint-close (2026-08-25); triaged via `/doc-creator-driver:intake` (2026-08-26)

## Goal

Stopping a `daisy-debug` attach session currently surfaces a spurious `Exception has occurred: signal SIGSTOP` message in the Debug Console — a benign artifact of lldb-dap's own detach mechanics, not a real fault, but confusing enough that a developer could reasonably mistake it for a crash. After this milestone, stopping a `daisy-debug` attach session (via the Stop button, for both the PID-attach and F5 launch-configuration paths) never shows this message, while every other DAP event (including real exceptions and breakpoint stops) passes through unchanged.

## Sprint Tasks

### [x] fix: filter the spurious detach-time SIGSTOP exception out of the Debug Console (FR-UX-7)

`DaisyDebugAdapterFactory.createDebugAdapterDescriptor()` (`src/debug/debug-adapter.ts`) returns a direct `vscode.DebugAdapterExecutable`, so lldb-dap's stdio is wired straight to VS Code with nothing able to observe-and-drop a single message (`vscode.DebugAdapterTracker` is read-only). Replace it with an inline filtering adapter — following the `DsIdeTerminatingAdapter` pattern already used in `src/debug/run-config-provider.ts` — that spawns lldb-dap itself, relays all DAP traffic unchanged in both directions, and drops only the `stopped` event whose `reason` is `exception` and whose description/text references `SIGSTOP`.

**Affected files:** `src/debug/debug-adapter.ts`, `src/test/unit/debug/debug-adapter.test.ts`

**DoD:**
- Stopping a `daisy-debug` attach session (PID-attach and F5 paths) never shows `Exception has occurred: signal SIGSTOP` in the Debug Console.
- A real `stopped`/`exception` DAP event (any reason/description other than the detach-time `SIGSTOP` one) still reaches the client unchanged — verified by a unit test that feeds the filtering adapter a raw DAP message stream containing both the spurious event and a genuine exception event, asserting only the former is dropped.
- `MuteOnBreakpointTracker`'s mute-on-breakpoint behavior (audio mode switching on `stopped`/`continued`/`exited`/`terminated`) is unaffected — existing tests for it still pass unmodified.
