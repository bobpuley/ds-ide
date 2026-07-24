# M49 — Controls Editor as Preview Surface (OLED Embedding)

**Version:** 0.15.1
**Status:** planned
**Source:** intake 2026-07-24 — feature request

## Goal

Fold the OLED live view into the Controls Editor as its default embedded view when the `oled`
peripheral is enabled, with a "show in separate view" option that still opens today's standalone
OLED panel for detailed inspection. This is the first, deliberately narrow step toward the
Controls Editor becoming a general real-world preview surface — future pedal/board/rack layouts
would live here too — without committing to a panel rename or the full reframing this milestone.

## Sprint Tasks

### [ ] feat: embed OLED live view as Controls Editor's default view (FR-CE-2)

`ControlsViewProvider` (sidebar `WebviewView`) and `OledPanel` (editor-column `WebviewPanel`) are
separate infrastructure with no shared abstraction today. Route the OLED framebuffer into the
Controls Editor as its default rendering when `oled` is enabled, and add a pop-out action that
reuses the existing `hasLiveView`/`viewPeripheral` flow unchanged.

Before implementation: build a standalone-HTML mockup of the embedded view (including the
pop-out affordance and how it coexists with the existing controls-layout canvas) and have it
reviewed/approved — this changes the Controls Editor's default content, not just adding a section.

**Affected files:** `src/sidebar/controls-editor-panel.ts`, `src/webview/controls-webview.ts`,
`src/webview/oled-frame.ts`, `src/webview/messages.ts`, `src/extension.ts`,
`src/emulator/manager.ts`

**DoD:**
- Enabling `oled` and opening the Controls Editor shows the live OLED framebuffer by default,
  without requiring the separate OLED panel to be opened first.
- A "show in separate view" action opens the existing standalone `OledPanel`, unchanged from
  today's behavior.
- Disabling `oled` reverts the Controls Editor to the plain controls-layout view.
- No change to command IDs, package.json contribution labels, or user-facing panel naming — scope
  is behavior only, per the recorded decision in `02_assumptions-and-risks.md`.
- No change to `wiring-webview.ts`'s View button behavior for midiTrs/midiUsb.
- Mockup reviewed and approved before the real webview implementation lands.
