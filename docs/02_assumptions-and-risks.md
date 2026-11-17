> **v26 complete** — archived to `docs/v26/` on 2026-11-14. This file now seeds v27 planning.

# 02 — Assumptions & Risks (v27)

> **All prior versions complete** — full bet/risk history in their respective archives.
> **v23 complete** — all v23 bets held; risks resolved or managed.
> Archived: [`docs/v23/02_assumptions-and-risks.md`](v23/02_assumptions-and-risks.md).
>
> **v24 complete** — all v24 bets held; risks resolved or managed.
> Archived: [`docs/v24/02_assumptions-and-risks.md`](v24/02_assumptions-and-risks.md).
>
> **v26 complete** — all v26 bets held; risks resolved or managed.
> Archived: [`docs/v26/02_assumptions-and-risks.md`](v26/02_assumptions-and-risks.md).

## AI agent guide (intake 2026-11-15)

> ⚠️ ASSUMPTION: the mainstream coding agents (Claude Code, Copilot, Codex, Cursor, Windsurf, Gemini CLI, Cline) read a project-root instruction file by convention (`CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`, `.cursorrules`, `.windsurfrules`, `GEMINI.md`, `.clinerules`) and follow a line in it that points to another file. A guide that sits in the project but is referenced from none of these files is not read, which is why the feature adds the pointer and does not only ship the guide.

> ⚠️ ASSUMPTION: a single Markdown file written as imperative rules plus checklists is understood by every agent regardless of vendor; no per-vendor variant is needed. Verify by pointing at least two different agents at the guide and asking each to adapt the same sample effect.

> ⚠️ ASSUMPTION: the file list above covers the agent files that matter for the first release. New conventions appear often; the list lives in one constant so adding a name is a one-line change.

> **Risk — guide drifts from the product.** The guide states rules (block syntax, `controllers.yaml` fields, supported libDaisy surface, pin limits) that the code enforces elsewhere. If the code changes and the guide does not, agents generate code that no longer works, and the failure looks like an IDE bug. Mitigation: a unit test checks the guide against the shipped schema facts (markers, kinds, field names, ADC and GPIO ranges) and the wizard template; CHANGELOG and milestone DoDs for any convention change must name the guide. Residual risk accepted for statements the test cannot check (supported-API list); the guide marks the date it was last verified.

> **Risk — editing the developer's own files.** Appending to a shared `CLAUDE.md` or `AGENTS.md` changes a file a team may own. Mitigation: the command lists the detected files and the user picks which to update, appends one marked line only (never rewrites), is idempotent, and the change is visible in the normal VS Code diff and git status.

> **Risk — guide too long for an agent's context.** A long file is read less reliably and costs tokens on every request. Mitigation: target a few hundred lines, rules first, reference tables last; the guide links to the README for human-oriented explanations instead of repeating them.

> **Assumption disproved (M92 manual test, 2026-11-17):** "the editors refresh on every change of the effect source" held only for saves made in the VS Code editor (`onDidSaveTextDocument`). A coding agent edits the file on disk, VS Code reloads the buffer without a save event, and both editors kept showing the old state. Replaced by a file watcher on the project's effect source and `controllers.yaml` (FR-AIG-6).

*Other v27 bets and risks to be defined during planning.*
