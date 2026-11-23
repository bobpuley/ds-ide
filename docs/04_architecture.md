> **v25 complete** — archived to `docs/v25/` on 2026-11-23. This file now seeds v26 planning.

> **v26 complete** — archived to `docs/v26/` on 2026-11-14. This file now seeds v27 planning.

# 04 — Architecture (v27)

> **v23 complete** — full v23 architecture in
> [`docs/v23/04_architecture.md`](v23/04_architecture.md).
>
> **v24 complete** — full v24 architecture in
> [`docs/v24/04_architecture.md`](v24/04_architecture.md).
>
> **v26 complete** — full v26 architecture in
> [`docs/v26/04_architecture.md`](v26/04_architecture.md).

## AI agent guide (M92, intake 2026-11-15)

**Asset.** `ai/DAISY_IDE_AI_GUIDE.md` in the repository, shipped in the VSIX (not excluded by `.vscodeignore`); read at run time from `extensionPath`. One file, no templating, so the packaged text is exactly what the test checks.

**Code.** A new module `src/commands/add-ai-guide.ts`:
- pure helpers with injected file-system functions, unit-testable without VS Code: `AGENT_FILES` (the one constant that lists recognised agent files), `detectAgentFiles(root, exists)`, `appendPointer(existingText)` (returns the new text, or the same text when the marker is present), `agentsMdTemplate()`;
- `copyGuide(extensionPath, targetUri)` shared by the command and the wizard (real copy, as FR-PKG-3);
- the command handler `ds-ide.addAiGuide`: folder pick (multi-root), overwrite confirmation, multi-select QuickPick of detected files, append, optional `AGENTS.md` creation, result message.

`create-effect-project.ts` calls `copyGuide` and writes `AGENTS.md` after the existing scaffold writes, inside its own try/catch so a failure here only warns.

**Contribution.** `package.json` adds the command `ds-ide.addAiGuide` (Command Palette, enabled when `ds-ide.isDaisyProject` or any workspace folder is open, so an effect not yet detected can still receive the guide) and a button or entry in the Daisy view.

**Data flow.** Command → resolve target folder → copy guide → scan for agent files → user picks → append marked line (`vscode.workspace.fs`, read–modify–write per file) → message. No emulator, IPC or native code is touched.

**Verification.** `ai-guide.test.ts` (FR-AIG-2: content vs product facts and size budget), `add-ai-guide.test.ts` (helpers and handler with fakes), wizard test extended, `verify:package` extended to require the file in the VSIX.

**Refresh on external changes (FR-AIG-6).** New module `src/workspace/project-watcher.ts`: a `FileSystemWatcher` on `**/{*.cpp,controllers.yaml}`, filtered by `isProjectFile` (root, `src/`, `source/`, the configured effect source), debounced, serialised (one refresh at a time, one more if events arrived meanwhile), calling the existing `initViewsFromProject()`. Registered in `activate()` next to the save listener, which stays for saves made in the editor.

**Trade-offs considered.** Writing per-vendor files (`CLAUDE.md`, Copilot instructions) from one source was rejected: more files to keep in step and a higher chance of overwriting user content. A pointer line to one guide keeps a single source of truth.
