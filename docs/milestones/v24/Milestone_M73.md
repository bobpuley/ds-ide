# M73 — Reachability

**Version:** 0.24.0
**Status:** in progress
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

### [ ] feat: welcome content for empty views (FR-RCH-2)

**Affected files:** `package.json`, `src/test/unit/manifest.test.ts`

**DoD:**
- both webview views contribute `viewsWelcome` gated on `ds-ide.isDaisyProject`
- not a Daisy project → *Create New Effect Project* button; Daisy project with nothing wired → button running `ds-ide.focusWiring`
- a manifest test checks every welcome command exists in `contributes.commands`

---

### [ ] feat: Get started walkthrough (FR-RCH-3)

**Affected files:** `package.json`, `media/walkthrough/`

**DoD:**
- `contributes.walkthroughs` has a "Get started with Daisy Seed" entry: create project, wire a pin, Run, watch the scope
- each step has a markdown description and a command link
- confirmed on a clean VS Code profile that it appears on the Welcome page (manual test)

---

### [ ] chore: README/manifest consistency lint (FR-RCH-4)

README still says "Open Wiring Editor", a command removed in M21.

**Affected files:** `README.md`, `scripts/check-doc-commands.sh`, `package.json`

**DoD:**
- the script fails, naming file and line, when a `Daisy IDE: <title>` or `ds-ide.<id>` reference in `README.md` or the walkthrough is not in `contributes.commands`
- the stale README text is corrected and the script passes
- the script runs with the existing static-lint step

---

### [ ] feat: auto-save Controls Editor layout (FR-RCH-5)

**Affected files:** `src/webview/controls/save.ts`, `src/webview/controls/drag.ts`, `src/sidebar/controls-editor-panel.ts`, `src/test/unit/webview/controls/save.test.ts`

**DoD:**
- layout is saved about 500 ms after a drag ends via the existing `editorSave` message; rapid drags coalesce into one save
- the "💾 layout" button is removed
- a failed save is reported to the user
- unit tests cover debounce and coalescing
