# M49 — Controls Editor as Preview Surface (OLED Embedding)

**Version:** 0.15.1
**Status:** planned
**Source:** intake 2026-07-24 — feature request

## Goal

Dock the OLED live view above the Controls Editor's layout canvas when the `oled` peripheral is
enabled — visible at the same time as the layout, not a mode the user switches into — with a
"show in separate view" option that still opens today's standalone OLED panel for detailed
inspection. This is the first, deliberately narrow step toward the Controls Editor becoming a
general real-world preview surface — future pedal/board/rack layouts would live here too —
without committing to a panel rename or the full reframing this milestone.

## Sprint Tasks

### [x] feat: dock OLED live view above the Controls Editor's layout canvas (FR-CE-2)

`ControlsViewProvider` (sidebar `WebviewView`) and `OledPanel` (editor-column `WebviewPanel`) are
separate infrastructure with no shared abstraction today. Route the OLED framebuffer into a new
docked strip above the Controls Editor's existing `#design-area` when `oled` is enabled (collapsed
to zero height when disabled — today's exact layout is unaffected), and add a pop-out action that
reuses the existing `hasLiveView`/`viewPeripheral` flow unchanged.

Mockup reviewed and approved (`docs/mockups/m49-oled-embed.html`): **Variant B, docked strip** —
chosen over a tabbed Layout/Preview split so the layout canvas and the OLED preview stay visible
simultaneously. The mockup's mini layout editor omits the `#palette` column since it isn't
rendered in the real Controls Editor today (source keeps it, per `02_assumptions-and-risks.md`).

**Affected files:** `src/sidebar/controls-editor-panel.ts`, `src/webview/controls-webview.ts`,
`src/webview/oled-frame.ts`, `src/webview/messages.ts`, `src/extension.ts`,
`src/emulator/manager.ts`

**DoD:**
- Enabling `oled` and opening the Controls Editor shows a docked strip above the layout canvas
  with the live OLED framebuffer, without requiring the separate OLED panel to be opened first;
  the layout canvas remains fully visible and usable below it.
- A "show in separate view" action opens the existing standalone `OledPanel`, unchanged from
  today's behavior.
- Disabling `oled` collapses the strip entirely — canvas reverts to today's exact full height.
- No change to command IDs, package.json contribution labels, or user-facing panel naming — scope
  is behavior only, per the recorded decision in `02_assumptions-and-risks.md`.
- No change to `wiring-webview.ts`'s View button behavior for midiTrs/midiUsb.
