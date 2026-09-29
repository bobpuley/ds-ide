# M68 — Extension Views Follow the IDE Theme

**Version:** 0.20.3
**Status:** planned
**Source:** feature intake session, 2026-09-29 (01_input-ideas.md; layout per docs/mockups/v22-themes.html, built as this milestone's first task)

## Goal

All five webviews (Scope, OLED and MIDI panels, Controls Editor, Wiring Editor) hardcode the
Dark+ palette, with about 370 colour literals and no theme variables, so they look wrong in light
and high-contrast themes. After this milestone every view follows the active theme through one
shared `--ds-*` theme layer: UI chrome and data colours come from VS Code's tokens, device accents
have light and dark variants, hardware depictions keep their colours in a themed frame, theme
switches repaint live, and a guard test keeps hardcoded colours from coming back.

## Sprint Tasks

### [x] docs: theme mockup across the four theme kinds (FR-THM-1)

The token map and the accent light variants are UI decisions, so they are evaluated in a
standalone mockup before any view changes.

**Affected files:** `docs/mockups/v22-themes.html`, `docs/04_architecture.md`

**DoD:**
- a standalone HTML mockup renders representative parts of all five views (scope with traces and grid, OLED frame, MIDI keyboard / monitor, Controls Editor controls, Wiring Editor board with palette tiles and a popover) under switchable Light+, Dark+, High Contrast Dark and High Contrast Light token values
- it shows every device accent's dark and light variant on its theme background
- the user has evaluated it; the confirmed token map and accent variants are written back to 04_architecture.md's token map

---

### [x] feat: shared theme layer and per-theme accent colours (FR-THM-3)

**Affected files:** `src/webview/theme/theme-css.ts`, `src/webview/theme/theme-runtime.ts`, `src/devices/registry.ts`, `src/test/unit/webview/theme-css.test.ts`, `src/test/unit/webview/theme-runtime.test.ts`, `src/test/unit/devices/registry.test.ts`

**DoD:**
- `themeCss({ surface })` emits the `--ds-*` → `--vscode-*` aliases (editor or sidebar surface), per-kind accent variables generated from `REGISTRY`, and high-contrast rules (contrast border, visible focus); unit-tested for both surfaces and all four body theme classes
- `DeviceDescriptor.accent: { dark, light }` replaces `accentColor`; every existing use reads `var(--ds-accent-<id>)`; a device without both variants fails to type-check
- a unit test checks every accent variant for WCAG 3:1 against `#ffffff` (light) and `#1e1e1e` (dark)
- `readThemeColor()` and `onThemeChange()` unit-tested (the observer fires once per body class change and disposes cleanly)
- `npm test` green

---

### [ ] feat: Scope panel follows the theme, with live repaint (FR-THM-5)

**Affected files:** `src/webview/scope-panel.ts`, `src/webview/scope-webview.ts`, `src/test/unit/webview/scope-panel.test.ts`

**DoD:**
- panel chrome uses `themeCss({ surface: 'editor' })` and `--ds-*` only (FR-THM-1)
- scope and spectrum backgrounds, grid, axis labels, input / output traces and the running / stopped indicator are drawn with `readThemeColor()` colours (FR-THM-2)
- colours are read once per theme change, not per frame; switching theme with a stopped scope visible repaints it in the new colours (FR-THM-5)
- `npm test` green; manual check in the four theme kinds

---

### [ ] feat: OLED and MIDI panels follow the theme (FR-THM-4)

**Affected files:** `src/webview/oled-panel.ts`, `src/webview/midi-panel.ts`, `src/test/unit/webview/midi-monitor.test.ts`

**DoD:**
- both panels use `themeCss({ surface: 'editor' })` and `--ds-*` for chrome (FR-THM-1)
- the OLED glass and pixels keep their fixed colours inside a themed frame (FR-THM-4)
- MIDI monitor text, keyboard keys and note highlights follow the theme (FR-THM-2)
- `npm test` green; manual check in the four theme kinds

---

### [ ] feat: Controls Editor follows the theme (FR-THM-1)

**Affected files:** `src/sidebar/controls-editor-panel.ts`, `src/webview/controls/convention-canvas.ts`, `src/test/unit/sidebar/controls-editor-panel.test.ts`

**DoD:**
- the view uses `themeCss({ surface: 'sidebar' })` and `--ds-*` for chrome; controls use the device accent variables (FR-THM-1, FR-THM-3)
- the canvas repaints on theme change (FR-THM-5)
- the docked OLED strip keeps its fixed glass in a themed frame (FR-THM-4)
- `npm test` green; manual check in the four theme kinds

---

### [ ] feat: Wiring Editor follows the theme (FR-THM-4)

**Affected files:** `src/wiring/wiring-panel.ts`, `src/webview/wiring-webview.ts`, `src/wiring/device-popover.ts`, `src/wiring/device-icons.ts`, `src/test/unit/sidebar/wiring-editor-panel.test.ts`

**DoD:**
- chrome, the palette, drag feedback (pulse, amber conflict hatch, dimming), popovers and the cursor label use `themeCss({ surface: 'sidebar' })`, `--ds-*` and the accent variables (FR-THM-1, FR-THM-3)
- the board drawing and the illustrated device icons keep their colours inside themed frames (FR-THM-4)
- bus brackets, pin tooltips and the micro-USB indicator keep their meaning in all four theme kinds
- `npm test` green; manual check in the four theme kinds

---

### [ ] chore: guard against hardcoded colours (FR-THM-6)

**Affected files:** `src/test/unit/webview/no-hardcoded-colours.test.ts`

**DoD:**
- the test scans `src/webview`, `src/sidebar` and `src/wiring` for hex, `rgb()` and `hsl()` colour literals outside the allow-list (accent palette, board art, device icons, OLED glass) and fails naming each file and line
- it passes on the converted codebase and fails on a deliberately added literal (verified in the test itself with a fixture)
- `npm test` green
