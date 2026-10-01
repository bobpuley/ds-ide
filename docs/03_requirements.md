# 03 — Requirements (v24)

> **v23 complete** — all v23 requirements implemented; ACs green.
> Archived: [`docs/v23/03_requirements.md`](v23/03_requirements.md).

## Reachability — `FR-RCH-*` (intake 2026-10-01)

Source: `01_input-ideas.md`, 2026-10-01; `design_plan.md` P0-2, P1-4, P2-3, P1-3. Milestone: **M73**.

**Decisions recorded 2026-10-01:** Show Scope with no emulator opens the idle panel (never builds); the "💾 layout" button is removed in favour of auto-save; `panelState` is out of scope.

**FR-RCH-1 — Show / focus commands.** The palette has `Daisy IDE: Show Scope`, `Show OLED`, `Show MIDI`, `Focus Controls Editor` and `Focus Wiring Editor`. Each reveals the surface if it exists, or opens it if it was closed, without a build or deploy. Show OLED / Show MIDI work even when the peripheral is disabled, showing the panel's idle state.

**FR-RCH-2 — Welcome content.** The Controls Editor and Wiring Editor views contribute `viewsWelcome` gated on `ds-ide.isDaisyProject`: not a Daisy project → *Create New Effect Project* button; Daisy project with nothing wired → button to focus the Wiring Editor.

**FR-RCH-3 — Walkthrough.** A "Get started with Daisy Seed" walkthrough (create project → wire a pin → Run → watch the scope) is contributed, with command links, so VS Code lists it on the Welcome page.

**FR-RCH-4 — Docs/manifest lint.** A static check (precedent: `scripts/check-active-folder-convention.sh`) fails when a `Daisy IDE: <title>` or `ds-ide.<id>` reference in `README.md` or the walkthrough is not in `contributes.commands`. The stale "Open Wiring Editor" README text is corrected.

**FR-RCH-5 — Auto-save layout.** The Controls Editor persists card positions ~500 ms after a drag ends, using the existing `editorSave` path. The "💾 layout" button is removed. A failed save is reported, not silent.
