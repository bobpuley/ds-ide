# M92 — AI Agent Guide

**Version:** 0.25.1
**Status:** in progress
**Source:** intake session, 2026-11-15 (an AI-oriented conventions file for developers who work with coding agents)

## Goal

A developer who asks a coding agent to write or adapt a Daisy effect gets code that builds and runs in Daisy IDE on the first try, because the agent has the IDE's conventions in a file written for it. After this milestone the extension ships `DAISY_IDE_AI_GUIDE.md`, new projects include it with an `AGENTS.md` pointer, and one command adds it to an existing project and appends a pointer line to the agent files the project already has.

## Sprint Tasks

### [x] feat: write the AI agent guide (FR-AIG-1)

The conventions are spread across the README appendix, the wizard templates and the code. An agent needs them in one imperative document.

**Affected files:** `ai/DAISY_IDE_AI_GUIDE.md`, `.vscodeignore`

**DoD:**
- The file covers every topic listed in FR-AIG-1 and states the extension version and the verification date.
- Supported and missing libDaisy/DaisySP APIs are taken from the emulator sources, not from memory.
- The file is not excluded from the VSIX by `.vscodeignore`.

---

### [x] test: keep the guide true to the product (FR-AIG-2)

**Affected files:** `src/test/unit/build/ai-guide.test.ts`, `scripts/verify-vsix.sh`, `package.json`

**DoD:**
- A unit test fails when the guide lacks the controls markers, a control kind, a `controllers.yaml` section or field, or the ADC/GPIO ranges the validators enforce.
- The test checks the guide's sample against the wizard effect template and enforces a line budget.
- `verify:package` fails when the VSIX does not contain the guide.

---

### [ ] feat: add the guide and AGENTS.md to new projects (FR-AIG-3)

**Affected files:** `src/commands/add-ai-guide.ts`, `src/commands/create-effect-project.ts`, `src/test/unit/commands/create-effect-project.test.ts`

**DoD:**
- A wizard-created project contains `DAISY_IDE_AI_GUIDE.md` (a real copy) and an `AGENTS.md` that names it.
- A failure writing either file shows a warning and does not abort project creation.
- Unit tests cover the success path and the failure path.

---

### [ ] feat: add the "Add AI Guide to Project" command (FR-AIG-4)

**Affected files:** `src/commands/add-ai-guide.ts`, `src/extension.ts`, `package.json`, `src/test/unit/commands/add-ai-guide.test.ts`

**DoD:**
- `ds-ide.addAiGuide` is in the Command Palette and the Daisy view and works in a multi-root workspace (folder pick).
- It copies the guide, asks before replacing a different existing copy, and writes nothing when identical.
- It lists the detected agent files (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, `.cursorrules`, `.windsurfrules`, `.clinerules`), appends the marked line once to each selected file, and a second run changes nothing.
- With no agent file present it offers to create `AGENTS.md`; declining leaves only the guide copied.
- Existing file content is never rewritten; unit tests cover each branch with fakes.

---

### [ ] docs: document the guide for humans (FR-AIG-5)

**Affected files:** `README.md`, `CHANGELOG.md`, `src/test/unit/build/ai-guide.test.ts`

**DoD:**
- The README has a "Working with an AI coding agent" section covering the guide, the wizard and the command, the recognised agent files, and the append-only behaviour.
- A test checks that the README section exists and names `DAISY_IDE_AI_GUIDE.md`.
- `CHANGELOG.md` records the feature under the release version.
