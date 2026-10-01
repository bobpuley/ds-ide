# M73 — Reachability

**Version:** 0.24.0
**Status:** released
**Source:** feature intake session, 2026-10-01 (01_input-ideas.md; design_plan.md P0-2, P1-4, P2-3, P1-3)

## Goal

Closed surfaces cannot be reopened without a rebuild, first-run users see empty views with no guidance, README command names drift from the manifest, and the Controls Editor layout is lost unless the user finds a small save button. After this milestone every ds-ide surface can be reopened from the Command Palette, a new user is guided by welcome content and a walkthrough, docs are checked against the manifest, and layout changes save themselves.

## Sprint Tasks

### [x] feat: show / focus commands for every surface (FR-RCH-1)

Closing the Scope tab costs a full rebuild and relaunch to undo; OLED and MIDI can only be reopened from a conditionally rendered button.

**Affected files:** `package.json`, `src/extension.ts`, `src/webview/scope-panel.ts`, `src/webview/oled-panel.ts`, `src/webview/midi-panel.ts`, `src/test/unit/extension.test.ts`

**DoD:**
- `ds-ide.showScope`, `showOled`, `showMidi`, `focusControls`, `focusWiring` are contributed and listed as `Daisy IDE: …`
- each reveals an open surface or opens a closed one without building or deploying; Show Scope with no emulator opens the idle panel
- Show OLED / Show MIDI work with the peripheral disabled
- unit tests cover registration and the closed → reopened path

---

### [x] feat: welcome content for empty views (FR-RCH-2)

`viewsWelcome` only renders in tree views, so the Daisy tree view carries the not-a-project state and the Controls Editor gets an in-webview button.

**Affected files:** `package.json`, `src/views/daisy-view.ts`, `src/extension.ts`, `src/webview/messages.ts`, `src/sidebar/controls-editor-panel.ts`, `src/webview/controls/`, `src/test/unit/views/daisy-view.test.ts`, `src/test/unit/build/package-metadata.test.ts`

**DoD:**
- the Daisy view is visible in every workspace; outside a Daisy project it has no rows and `viewsWelcome` shows a *Create New Effect Project* button
- the Controls Editor's empty-canvas hint has an *Open Wiring Editor* button that runs `ds-ide.focusWiring` (validated `focusWiring` webview message)
- a manifest test checks every `viewsWelcome` command exists in `contributes.commands`

---

### [x] feat: Get started walkthrough (FR-RCH-3)

**Affected files:** `package.json`, `media/walkthrough/`

**DoD:**
- `contributes.walkthroughs` has a "Get started with Daisy Seed" entry: create project, wire a pin, Run, watch the scope
- each step has a markdown description and a command link
- confirmed on a clean VS Code profile that it appears on the Welcome page (manual test)

---

### [x] chore: README/manifest consistency lint (FR-RCH-4)

README still says "Open Wiring Editor", a command removed in M21.

**Affected files:** `README.md`, `scripts/check-doc-commands.js`, `src/test/unit/scripts/check-doc-commands.test.ts`, `package.json`

**DoD:**
- the script fails, naming file and line, when a `Daisy IDE: <title>` mention or a `(command:<id>)` link in `README.md` or the walkthrough is not in `contributes.commands` (bare `ds-ide.<name>` in prose is ignored: it also names settings and state keys)
- the stale README text is corrected and the script passes
- the script runs as part of `npm run lint`

---

### [x] feat: auto-save Controls Editor layout (FR-RCH-5)

**Affected files:** `src/webview/controls/auto-save.ts`, `src/webview/controls/save.ts`, `src/webview/controls/drag.ts`, `src/webview/controls/convention-canvas.ts`, `src/webview/controls/yaml-editor-canvas.ts`, `src/webview/controls-webview.ts`, `src/sidebar/controls-editor-panel.ts`, `src/test/unit/webview/controls-auto-save.test.ts`

**DoD:**
- layout is saved about 500 ms after a drag ends via the existing `editorSave` message; rapid drags coalesce into one save
- the "💾 layout" button is removed
- legacy YAML-mode field edits and card deletes also auto-save, on commit (blur / select change), never per keystroke
- a drag that starts while a save is pending cancels it; a pending save is flushed when the view is hidden
- a failed write is reported to the user (existing host error path)
- unit tests cover debounce, coalescing, cancel and flush
