# 01 — Input Ideas (v18)

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

## Bugs received

- **Debug-attach ignores the active workspace folder in multi-root workspaces** (reconciled from parallel code reviews `docs/06_nodejs_review.md` and `docs/06_vscode_extension_review.md`, 2026-08-25). Observed: `src/commands/debug-deploy.ts:39` and `src/debug/run-config-provider.ts:42` both read `vscode.workspace.workspaceFolders?.[0]` directly when starting the `daisy-debug` attach session, instead of going through `resolveActiveFolder()` (`src/workspace/active-folder.ts`) — the helper built in v11/v12 (FR-UX-4) specifically so multi-root workspaces respect the user's selected active folder. Build and deploy target the correct folder; the resulting debug session's folder association does not. Expected: the debug session started for both the `ds-ide.debug` (PID-attach) command and the F5 launch-configuration path should resolve the same active folder as every other workspace-scoped command. Severity reconciled at MEDIUM (correctness/consistency issue, not a crash or security issue; only affects multi-root workspaces).

- **Remaining HIGH/MEDIUM findings from the 2026-08-25 parallel code reviews**, batch-intaked 2026-08-25 (all LOW findings and the VS Code review's LOW finding deferred — not intaked). Full evidence for every item lives in the source review file; only summary + FR-ID mapping is kept here.
  - `docs/06_emulator_review.md` (2 HIGH, 1 MEDIUM) → FR-EMU-9, FR-EMU-10, FR-EMU-11 → M54
  - `docs/06_nodejs_review.md` (6 remaining HIGH, 28 MEDIUM) → FR-EXT-6..FR-EXT-39 → M55, M56, M57

- **`daisy-debug` attach session throws "Exception has occurred: signal SIGSTOP" on stop** (human-driven test finding, M53 sprint-close, 2026-08-25). Observed: during manual testing of the M53 debug-attach active-folder fix, stopping a `daisy-debug` attach session (lldb-dap, `src/debug/debug-adapter.ts`) surfaces `Exception has occurred: signal SIGSTOP` in the Debug Console. Confirmed present on `main` before the M53 branch — unrelated to `resolveActiveFolder()`/`startDebugging()` folder-argument changes, so out of scope for FR-UX-6. Not yet triaged into a requirement or milestone; needs `/doc-creator-driver:intake` to determine root cause (likely lldb-dap surfacing its own attach-time SIGSTOP as an "exception" event) and expected behavior (suppress/filter vs. document as expected).
