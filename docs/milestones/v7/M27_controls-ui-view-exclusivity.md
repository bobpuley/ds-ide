# M27 — Controls Editor UI Polish & View Exclusivity

**Semver:** 0.8.0
**Status:** in progress
**Branch:** feat/m27-controls-ui-exclusivity

---

## Goals

1. Redesign the Controls Editor runtime (convention) mode cards to be more compact and visually cleaner.
2. Make the Controls Editor and Wiring Editor panels mutually exclusive in the sidebar.

---

## Sprint tasks

### T1 — Controls Editor runtime card compact redesign (FR-CE-10) — done

Implement the visual changes to `buildConventionCard()` in `controls-view-provider.ts`:

- Remove kind badge (`card-kind` span) and pin label (`card-pin-label` span) from the `ctrl-handle`; add a `title` attribute to the handle div with format `"Kind · pin N"`.
- Truncate displayed control IDs > 15 chars with `…`; set `title` on the id-label span to the full ID.
- Add `justify-content: center` to `.ctrl-body` in the runtime card styles.
- Replace the button body's `<button class="btn-ce">` text content (which currently shows the control ID) with an empty square pad: same height as before (matching `padding: 7px`), raised `box-shadow: 0 3px 0 #111`, pressed state collapses shadow + `translateY(3px)`.
- Remove the `vled-label` span from the LED body; leave only the `vled-dot`.

**DoD:**
- AC-58 passes (all eight sub-checks verified manually).
- Legacy YAML-only editor mode (`buildCard()`) is visually unchanged.
- No regressions to pot drag interaction, button press/release/latch, or LED state updates from emulator.

### T2 — View exclusivity: Controls Editor ↔ Wiring Editor (FR-VW-1) — done

Wire mutual exclusion via `onDidChangeVisibility` in `extension.ts` (or in each provider):

- When `ControlsViewProvider`'s view becomes visible, programmatically collapse the Wiring Editor panel.
- When `WiringViewProvider`'s view becomes visible, programmatically collapse the Controls Editor panel.
- Investigate and confirm the correct VS Code API call to collapse a `WebviewView` panel (likely via `workbench.view.*` command or focusing the parent container).

**DoD:**
- AC-59 passes (both directions verified, command palette trigger verified).
- No infinite-collapse loop if both views start collapsed.
- No regression to either view's normal open/close behavior.

**Known limitation:** AC-59 does not reliably collapse the sibling panel at runtime. VS Code exposes no public API to programmatically collapse a `WebviewView` sidebar section (only `TreeView` sections have an auto-registered `.collapse` command). The three-step workaround (focus sibling → `workbench.action.collapseSection` → refocus self) is best-effort and depends on VS Code internals that are not guaranteed to work in all builds. The feature is shipped as-is; a proper fix would require a VS Code API addition or a redesign using `TreeView`-based panels.
