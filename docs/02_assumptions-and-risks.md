# 02 — Assumptions & Risks (v15)

> **All prior versions complete** — full bet/risk history in their respective archives.
> **v14 complete** — all v14 bets held; risks resolved or managed.
> Archived: [`docs/v14/02_assumptions-and-risks.md`](v14/02_assumptions-and-risks.md).

v15 risk-tracking is underway — see below.

## v15 risks

> ⚠️ ASSUMPTION (revealed false by FR-CE-1's bug): a direct `fs.writeFile` persistence path was
> assumed to need no explicit cache refresh, because most save paths in this codebase go through
> VS Code's document model (`onDidSaveTextDocument`), which already triggers a refresh. Any
> extension-host write path that bypasses the document model (raw `fs.writeFile`/`fs.promises.*`)
> must explicitly re-push its result to any webview-side cache that a later visibility-change
> flush could otherwise clobber with stale data. Relevant to M48's SD content viewer and MIDI
> monitor, both of which read/write outside the document model.

> ⚠️ ASSUMPTION: the SD content viewer (FR-SD-1) reads `./sdcard/` directly from host disk
> on-demand (webview focus / explicit refresh), the same read-on-open pattern other panels
> already use — no new cache, so FR-CE-1's stale-cache risk above doesn't apply here. A file that
> fails UTF-8 decoding is listed but not preview-able (skips the txt-preview nice-to-have) rather
> than erroring the whole listing.

> ⚠️ ASSUMPTION: FR-MIDI-1's `SendMessage(uint8_t* buff, size_t size)` on `MidiUsbHandler`/
> `MidiUartHandler` is modeled from general libDaisy knowledge, not corpus-confirmed — the
> `daisy-seed-knowledge` corpus's one MIDI example (`USB_MIDI.cpp`) never calls `SendMessage` or
> mentions it. Same shape/risk as M47's `MidiUartHandler::Config` assumption (see "Carried-over
> open items" below): doesn't affect emulator behavior (the shim defines its own signature
> regardless), but verify the exact signature against real libDaisy before a hardware build is
> attempted.

> ⚠️ ASSUMPTION (scope decision): M49 (FR-CE-2, OLED-embedding) changes the Controls Editor's
> *behavior* only — it keeps the panel's existing name, command IDs, and package.json contribution
> labels unchanged. The broader "reframe Controls Editor as a general preview surface" idea
> (pedal/board/rack layouts, possible rename) is recorded as future intent, not scoped into this
> milestone — revisit when a second real preview surface (beyond OLED) is actually proposed, same
> deferral pattern M47 used for `INTERNAL` MIDI USB's connector attachment.

> ⚠️ ASSUMPTION: `ControlsViewProvider` (sidebar `WebviewView`) and `OledPanel` (editor-column
> `WebviewPanel`) are today fully separate infrastructure — no shared panel class or message
> helper, each hand-rolling its own `onDidReceiveMessage`/`postMessage`/CSP setup. Embedding OLED's
> `oledFrame` rendering into the Controls Editor means either relocating or dual-subscribing
> `EmulatorManager`'s `'message'` listener (currently only in `OledPanel`'s constructor) and adding
> a new embedded-rendering message contract to `messages.ts` — there's no existing "peripheral
> live-view" abstraction to embed for free.

> ⚠️ ASSUMPTION: `src/sidebar/controls-editor-panel.ts`'s `#palette` (drag-and-drop control-type
> list, `paletteItemsHtml()`/`paletteCssRules()`) is still present in source but, per direct
> confirmation, isn't actually rendered in the Controls Editor today. Left in place deliberately
> (not dead code to delete) in case it's needed again before the extension is stable. FR-CE-2's
> docked-strip layout (M49) was designed around the palette's *absence* — if the palette is
> reinstated later, revisit the strip's placement/width alongside it.

> ⚠️ ASSUMPTION (known gap, deliberately deferred): encoder/toggle/rgbled canvas positions have no
> persistence mechanism at all — no `editor_pos`-equivalent field exists for them anywhere (they're
> not declared in `controllers.yaml`, same M44 scope decision that excluded toggle), so
> `renderConventionCanvas()` always falls back to auto-layout (`nextPos()`) for these kinds on every
> render, independent of anything the user drags or saves. Discovered during M48/FR-CE-1 manual
> testing and confirmed distinct from that milestone's cache-sync bug (pot/button/led positions do
> round-trip correctly). Logged as a future feature request (01_input-ideas.md), not fixed here.

## Carried-over open items

- **`MidiUartHandler::Config` field names unverified against real hardware** — M47
  (`docs/v14/05_dev-plan.md` / [`docs/milestones/v14/Milestone_M47.md`](milestones/v14/Milestone_M47.md))
  modeled `MidiUartHandler` on the corpus-confirmed `MidiUsbHandler` shape rather than a confirmed
  header, since no corpus example exercises `MidiUartHandler`. Doesn't affect emulator behavior (the
  shim defines its own type regardless), but must be verified against real libDaisy before any v15
  milestone attempts a hardware build touching MIDI TRS.
