# 03 — Requirements (v24)

> **v23 complete** — all v23 requirements implemented; ACs green.
> Archived: [`docs/v23/03_requirements.md`](v23/03_requirements.md).

## Reachability — `FR-RCH-*` (intake 2026-10-01)

Source: `01_input-ideas.md`, 2026-10-01; `design_plan.md` P0-2, P1-4, P2-3, P1-3. Milestone: **M73**.

**Decisions recorded 2026-10-01:** Show Scope with no emulator opens the idle panel (never builds); the "💾 layout" button is removed in favour of auto-save; `panelState` is out of scope.

**FR-RCH-1 — Show / focus commands.** The palette has `Daisy IDE: Show Scope`, `Show OLED`, `Show MIDI`, `Focus Controls Editor` and `Focus Wiring Editor`. Each reveals the surface if it exists, or opens it if it was closed, without a build or deploy. Show OLED / Show MIDI work even when the peripheral is disabled, showing the panel's idle state.

**FR-RCH-2 — Welcome content.** (Revised 2026-10-01: VS Code renders `viewsWelcome` only in tree views, never in webview views.) The native Daisy tree view is visible in every workspace and, outside a Daisy project, is empty with `viewsWelcome` content: a *Create New Effect Project* button. The Controls Editor's empty canvas shows an *Open Wiring Editor* button (the webview posts a `focusWiring` message; the host runs `ds-ide.focusWiring`). The Wiring Editor keeps its existing hint line.

**FR-RCH-3 — Walkthrough.** A "Get started with Daisy Seed" walkthrough (create project → wire a pin → Run → watch the scope) is contributed, with command links, so VS Code lists it on the Welcome page.

**FR-RCH-4 — Docs/manifest lint.** A static check (precedent: `scripts/check-active-folder-convention.sh`) fails when a `Daisy IDE: <title>` mention or a `(command:<id>)` link in `README.md` or the walkthrough is not in `contributes.commands`. Bare `ds-ide.<name>` in prose is ignored, since the prefix also names settings and state keys. The stale "Open Wiring Editor" README text is corrected.

**FR-RCH-5 — Auto-save layout.** The Controls Editor persists card positions ~500 ms after a drag ends, using the existing `editorSave` path. The "💾 layout" button is removed. A failed save is reported, not silent.

## Editor polish — `FR-WLG-*`, `FR-CEH-*` (intake 2026-10-01)

Source: `01_input-ideas.md`, 2026-10-01; `design_plan.md` P1-6, P2-2. Milestone: **M74**.

**Decisions recorded 2026-10-01:** the header gets *Align to grid*, *Auto-arrange* and *Reset positions* (snap-while-dragging, align/distribute and layout undo are out of scope); the card dimming stays.

**FR-WLG-1 — Wiring legend.** The Wiring Editor has a legend explaining every pin state it draws: ADC-capable free pin, other free pin, claimed by a bus peripheral, wired device (with the device accent colours), power/non-assignable. It uses theme tokens, and each entry pairs the colour with a shape or text, not colour alone.

**FR-CEH-1 — No run marker in the header.** The ▶/■ marker (`ce-emu-status`) is removed from the Controls Editor header. Cards still dim while the emulator is not running.

**FR-CEH-2 — Align to grid.** A header button snaps every card to a 20 px grid. The result is saved through the existing auto-save (FR-RCH-5).

**FR-CEH-3 — Auto-arrange.** A header button lays the cards out in rows, in the order of the effect's controls block, wrapping at the canvas width; cards not in code follow. Saved through auto-save.

**FR-CEH-4 — Reset positions.** A header button returns every card to the default cascade (the layout used when no position is stored). Saved through auto-save.