> **v26 complete** — archived to `docs/v26/` on 2026-11-14. This file now seeds v27 planning.

# 03 — Requirements (v27)

> **v23 complete** — all v23 requirements implemented; ACs green.
> Archived: [`docs/v23/03_requirements.md`](v23/03_requirements.md).
>
> **v24 complete** — all v24 requirements implemented; ACs green.
> Archived: [`docs/v24/03_requirements.md`](v24/03_requirements.md).
>
> **v26 complete** — all v26 requirements implemented; ACs green.
> Archived: [`docs/v26/03_requirements.md`](v26/03_requirements.md).

## AI agent guide — `FR-AIG-*` (intake 2026-11-15)

Source: `01_input-ideas.md`, 2026-11-15. Milestone: **M92**. Decisions (owner, 2026-11-15): ship the guide in the VSIX; a command copies it into a project; the wizard adds it to every new project; the file is `DAISY_IDE_AI_GUIDE.md`; new projects also get an `AGENTS.md` that points to it; for existing projects the command finds the common agent files and appends a pointer line.

**FR-AIG-1 — The guide.** The extension ships one Markdown file, `DAISY_IDE_AI_GUIDE.md`, written for a coding agent (imperative rules and checklists, not a tutorial). It states how to write a new effect, or adapt an existing libDaisy effect, so that it builds and runs in Daisy IDE: project layout and where the effect source lives; the `ds-ide:controls` block (markers, annotation format, kinds, pin ranges, id uniqueness, who maintains it); `controllers.yaml` (sections, fields, defaults, ranges); the audio callback forms the emulator supports; which libDaisy and DaisySP APIs the host compatibility layer provides and which are missing or behave differently; hardware-only code to keep out of the emulator path; the build and run commands; and an adaptation checklist with what to ask the human when something is ambiguous. It also tells the agent what not to do (do not hand-edit `editor_pos`, do not rename ids in one file only, do not add host-only code to the hardware build). The file carries the extension version it describes and the date it was last verified.

**FR-AIG-2 — The guide stays true.** A unit test reads the shipped guide and fails when it disagrees with the product: it must contain the `ds-ide:controls:begin` and `:end` markers, every control `kind`, every `controllers.yaml` section and field name the schema accepts, and the ADC and GPIO ranges the validators enforce; the code sample of the guide must match the wizard's effect template structure; the file must be present in the packaged VSIX (`verify:package` checks it). The guide's length stays under a fixed line budget set by the test.

**FR-AIG-3 — New projects get it.** The new-effect wizard writes `DAISY_IDE_AI_GUIDE.md` (a real copy, not a symlink, for the same reason as FR-PKG-3) and an `AGENTS.md` into every new project. `AGENTS.md` is a few lines: it names the project as a Daisy IDE effect and tells the agent to read `DAISY_IDE_AI_GUIDE.md` before changing the source. The wizard's final message mentions both files. A failure to write them does not abort project creation.

**FR-AIG-4 — Add the guide to an existing project.** A command **Daisy: Add AI Guide to Project** (`ds-ide.addAiGuide`, in the Command Palette and the Daisy view) copies the guide to the root of the chosen workspace folder (multi-root: the user picks the folder). If a `DAISY_IDE_AI_GUIDE.md` already exists and differs, the user is asked before it is replaced; if identical, nothing is written. The command then looks in that folder for the common agent files — `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, `.cursorrules`, `.windsurfrules`, `.clinerules` — and shows the ones found as a multi-select list with all selected. For each selected file it appends one line, preceded by a blank line, `<!-- ds-ide:ai-guide --> Read DAISY_IDE_AI_GUIDE.md before editing the effect source (Daisy IDE conventions).`, unless the marker is already present (idempotent). Existing content is never rewritten. When no agent file exists, the user is offered to create `AGENTS.md` with the same content as in FR-AIG-3. The command ends with a message naming the files it changed or created.

**FR-AIG-5 — Documented for humans.** The README gains a short section "Working with an AI coding agent" that says what the guide is, how it reaches a project (wizard and command), which agent files the command recognises, and that the command only appends a marked line. `CHANGELOG.md` records the feature. The Marketplace description and keywords are unchanged unless the owner asks.

**FR-AIG-6 — Editors follow changes made outside VS Code.** When the project's effect source (the `.cpp` in the root, `src/` or `source/`, or the file set by `ds-ide.effectSource`) or its `controllers.yaml` is created, changed or deleted by anything other than a save in the VS Code editor — a coding agent, git, a command run in a terminal — the Controls Editor, the Wiring Editor, the peripheral state (SD card, OLED) and the Daisy-project context (`ds-ide.isDaisyProject`, status items) are refreshed from disk without reloading the window. A burst of events is coalesced into one refresh (about 300 ms after the last), a refresh never overlaps another, and a failing refresh does not stop the watcher. Vendored and generated code (`DaisySP/`, `.ds-ide/`) does not trigger it. The existing save listener stays.

**Acceptance criteria**

- AC-AIG-1: the VSIX contains `DAISY_IDE_AI_GUIDE.md`, and the guide test (FR-AIG-2) passes.
- AC-AIG-2: a project created by the wizard contains `DAISY_IDE_AI_GUIDE.md` and an `AGENTS.md` that names it.
- AC-AIG-3: on a project with a `CLAUDE.md` and a `.github/copilot-instructions.md`, the command offers both, appends the marked line to the ones picked, and a second run changes nothing.
- AC-AIG-4: on a project with no agent file, the command offers to create `AGENTS.md`; declining leaves only the guide copied.
- AC-AIG-6: with the Controls and Wiring editors open, rewriting the effect source on disk (for example `echo >> effect.cpp` from a terminal, or an agent edit) so its `ds-ide:controls` block declares a control makes that control appear in both editors without a reload.
- AC-AIG-5: manual check with two different agents (one is Claude Code): each, given only the pointer and the guide, adapts a sample bare-libDaisy effect that then builds and runs in the emulator with its controls detected.
