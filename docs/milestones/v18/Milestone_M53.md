# M53 — Multi-Root Debug-Attach Fix

**Version:** 0.17.1
**Status:** planned
**Source:** parallel code-review reconciliation (C/C++ emulator, Node.js/TS, VS Code extension reviews, 2026-08-25)

## Goal

Debug-attach sessions (`ds-ide.debug` PID-attach and the F5 launch-configuration path) currently ignore the user's selected active folder in a multi-root workspace, silently regressing the bug class FR-UX-4 fixed in v11/v12. After this milestone, both debug-attach paths resolve the same active folder as every other workspace-scoped command, and a static check prevents this specific regression class from landing silently again.

## Sprint Tasks

### [x] fix: route debug-attach through resolveActiveFolder() (FR-UX-6)

`src/commands/debug-deploy.ts:39` and `src/debug/run-config-provider.ts:42` both read `vscode.workspace.workspaceFolders?.[0]` directly instead of `resolveActiveFolder()`, so in a multi-root workspace with a non-first folder selected active, the debug session gets associated with the wrong folder even though build/deploy target the correct one.

**Affected files:** `src/commands/debug-deploy.ts`, `src/debug/run-config-provider.ts`

**DoD:**
- `debug-deploy.ts` and `run-config-provider.ts` thread the resolved active folder (via `resolveActiveFolder(workspaceState)` or an already-resolved `vscode.WorkspaceFolder` passed in) into `vscode.debug.startDebugging(folder, ...)` instead of `workspaceFolders?.[0]`
- In a multi-root workspace with a non-first folder selected active, both the `ds-ide.debug` command and the F5 launch-configuration path start the `daisy-debug` attach session against that folder
- Single-root workspace behavior is unchanged

---

### [ ] chore: add static check preventing new workspaceFolders[0] call sites (FR-UX-6)

Nothing currently enforces that new workspace-scoped code routes through `resolveActiveFolder()` — the task above is fixing the second silent regression of this exact bug class since FR-UX-4 shipped, and there is no tooling gate to catch a third.

**Affected files:** `scripts/check-active-folder-convention.sh` (new), `package.json`

**DoD:**
- A script greps `src/` (excluding `src/workspace/active-folder.ts` and `src/test/`) for direct indexed/optional-chained access to `workspace.workspaceFolders` and exits non-zero if any match is found
- The script is wired into `npm run lint` so it runs in the existing lint path
- Verified to catch the exact regression fixed in the task above (temporarily reintroduce `workspaceFolders?.[0]` in `debug-deploy.ts` locally and confirm the script fails)
