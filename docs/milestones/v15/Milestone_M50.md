# M50 — Persist Editor Positions for Encoder, Toggle, and RGB LED

**Version:** 0.15.2
**Status:** released
**Source:** discovered during M48/FR-CE-1 manual testing (2026-07-24) — a distinct, out-of-scope
gap from the cache-sync bug that milestone fixed

## Goal

Today only pot/button/led carry an `editor_pos` field in `controllers.yaml`; encoder, toggle, and
RGB LED positions have no persistence mechanism at all, so the Controls Editor canvas always
auto-layouts them fresh on every render regardless of how the user dragged them. After this
milestone, dragging any of these three device kinds in the Controls Editor sticks across saves and
panel-visibility round-trips, matching the existing pot/button/led behavior.

## Sprint Tasks

### [x] feat: persist encoder/toggle/rgbled canvas positions in controllers.yaml (FR-CE-3)

Extends `controllers.yaml` with a section per device kind (mirroring `controllers:`/`buttons:`/
`leds:`), each entry carrying its own `editor_pos` — the same field/round-trip convention
`ControllerDef`/`ButtonDef`/`LedDef` already use. `buildControlsConfig()`'s `placements` array
(currently only derived from `yamlCfg.pots/buttons/leds`) needs the same three kinds added; the
webview's convention-mode Save handler needs a parallel `updatedEncoders`/`updatedToggles`/
`updatedRgbLeds` branch alongside its existing `updatedPots`/`updatedButtons`/`updatedLeds`. The
concrete `ControllerConfig` shape change (new fields vs. new top-level arrays) is not decided yet —
resolve it when this task starts.

**Affected files:** `src/controllers/controller-config.ts`, `src/extension.ts`,
`src/webview/controls-webview.ts`, `src/sidebar/controls-editor-panel.ts`

**DoD:**
- Dragging an encoder, toggle, or RGB LED control in the Controls Editor and saving the layout
  persists its position to `controllers.yaml`.
- Switching away from and back to the Controls Editor (or reopening the project) shows the encoder/
  toggle/RGB LED at its last-saved position, not an auto-layout position.
- Existing pot/button/led position persistence is unaffected.
- Regression test covering the round trip (drag → save → reload) for at least one of the three
  newly-persisted kinds.
