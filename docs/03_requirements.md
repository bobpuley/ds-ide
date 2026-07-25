# 03 — Requirements (v15)

> **v14 complete** — all v14 requirements implemented; ACs green.
> Archived: [`docs/v14/03_requirements.md`](v14/03_requirements.md).

### M48 — Controls Editor Fix & I/O Monitor UIs

**FR-CE-1 — Controls Editor reflects the saved layout after a panel-visibility round-trip**
After `editorSave` writes `controllers.yaml` to disk, the extension host must re-push the
just-written config to `ControlsViewProvider`'s cached `lastEditorCfg`/`lastControlsConfig`
(the same cache `_flush()` re-sends on `onDidChangeVisibility`), so a later flush cannot clobber
live/saved positions with a stale pre-save snapshot. Historical predecessor: `FR-VE-3` (v2, save
round-trips `editor_pos` through `controllers.yaml`) verified only the disk write, never the
extension-host cache staying in sync with it — this requirement closes that gap explicitly.

**FR-SD-1 — Controls Editor shows the SD card's root content list**
When the `sdcard` peripheral is enabled, the Controls Editor displays a read-only listing of
`./sdcard/`'s root-level entries (name, size), refreshed on webview focus / explicit refresh —
root-level only, not recursive (matches the "root content list" scope of the request; recursive
browsing is future work if needed). Selecting a `.txt` entry previews its contents inline
(nice-to-have, not blocking the listing itself if a file can't be decoded as UTF-8).

**FR-MIDI-1 — Complete MIDI monitor: send arbitrary messages, view output in real time**
Extends M47's `MidiPanel` (virtual keyboard + inbound `midiRx` monitor) into one unified MIDI
monitor: a UI to send Program Change and Control Change messages (in addition to the existing
note on/off keyboard) to the effect, and a real-time list of MIDI messages the effect itself
transmits (`SendMessage`), shown in the same webview as inbound traffic — not a separate panel.

*v15 requirements beyond M48 continue below (M49).*

### M49 — Controls Editor as Preview Surface (OLED Embedding)

**FR-CE-2 — OLED live view is docked in the Controls Editor, with a pop-out option**
When the `oled` peripheral is enabled, the Controls Editor shows the OLED framebuffer in a docked
strip above the controls-layout canvas — visible at the same time as the layout, not a mode the
user switches into — instead of requiring the user to open a separate panel. A "show in separate
view" action still opens the existing standalone OLED panel for detailed inspection. Disabling
`oled` collapses the strip back to today's exact layout. This is the first step toward the
Controls Editor as a general real-world preview surface (future: pedal/board/rack layouts) — that
broader reframing, and any panel rename, is explicitly out of scope for this milestone (see
`02_assumptions-and-risks.md`).

### M50 — Persist Editor Positions for Encoder, Toggle, and RGB LED

**FR-CE-3 — Controls Editor persists canvas positions for encoder, toggle, and RGB LED**
Today only pot/button/led carry an `editor_pos` field in `controllers.yaml`; encoder, toggle, and
RGB LED positions have no persistence mechanism at all, so the canvas always auto-layouts them
fresh on every render regardless of how the user dragged them (discovered during M48/FR-CE-1
manual testing, confirmed distinct from that milestone's cache-sync bug — pot/button/led positions
round-trip correctly). Add an equivalent position-persistence path for these three device kinds so
dragging them in the Controls Editor sticks across saves and panel-visibility round-trips, matching
the existing pot/button/led behavior.
