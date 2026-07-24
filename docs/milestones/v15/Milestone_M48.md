# M48 — Controls Editor Fix & I/O Monitor UIs

**Version:** 0.15.0
**Status:** released
**Source:** intake 2026-07-24 — bug report + 2 feature requests

## Goal

Close the Controls Editor's layout-persistence bug (saved positions get clobbered by a stale
cache on the next panel switch) and give the developer two I/O surfaces that are currently
invisible: a browsable view of what's on the emulated SD card, and a fuller MIDI monitor that can
send arbitrary messages (not just notes) and show the Seed's own MIDI output in real time. After
this milestone, the Controls Editor reflects the last save reliably, and both SD and MIDI
peripherals have an on-screen way to inspect what the effect is actually doing with them — the
same observability principle FR-DEV-15/18 established for OLED and MIDI note input.

## Sprint Tasks

### [x] fix: keep Controls Editor cache in sync after layout save (FR-CE-1)

`onEditorSave` (`src/extension.ts:436-451`) writes `controllers.yaml` straight to disk via
`fs.promises.writeFile`, bypassing VS Code's document model — so `ControlsViewProvider`'s cached
`lastEditorCfg`/`lastControlsConfig` never refreshes. The next `onDidChangeVisibility` flush
(switching back to the Controls Editor) re-pushes that stale cache and overwrites the correct,
just-saved positions with the pre-save/default layout.

**Affected files:** `src/extension.ts`, `src/sidebar/controls-editor-panel.ts`

**DoD:**
- `onEditorSave` re-pushes the just-written config to `ControlsViewProvider` (via its existing
  `postControlsConfig`/`loadEditor` path) immediately after the disk write succeeds, so
  `lastEditorCfg`/`lastControlsConfig` match what's on disk.
- Manual repro from the bug report (open → rearrange → save → switch to Wiring Editor → switch
  back) shows the saved positions, not the defaults.
- Regression test covering `onEditorSave` asserts the provider's cache is refreshed after a save.

---

### [x] feat: add SD card root content viewer to Controls Editor (FR-SD-1)

The `sdcard` peripheral already mirrors its simulated storage to a real, workspace-relative
`./sdcard/` folder (M45) — trivially browsable on disk, but invisible from inside ds-ide. Add a
read-only root-level listing (name, size) to the Controls Editor when `sdcard` is enabled, with
`.txt` file preview as a nice-to-have.

Mockup reviewed and approved (`docs/mockups/m48-io-monitors.html`, "SD Card Content Viewer" tab):
**inline accordion** layout — a `#sdcard-contents` section below `#design-area`, styled like the
Wiring Editor's `#peripherals` (`.section-hdr` + row list); clicking a row expands its preview
directly beneath it, mirroring the mockup's Variant A.

**Affected files:** `src/webview/controls-webview.ts`, `src/sidebar/controls-editor-panel.ts`,
`src/extension.ts`, `src/webview/messages.ts`

**DoD:**
- Enabling `sdcard` and opening the Controls Editor shows `./sdcard/`'s root entries (name, size)
  in the inline-accordion section below the canvas; disabling `sdcard` hides the section.
- Listing refreshes on webview focus and via an explicit refresh action — no stale content if
  files changed on disk since last open.
- Clicking a `.txt` row expands an inline preview directly below that row (collapses on a second
  click); a non-UTF-8 file expands to "preview not available" instead of erroring.
- Empty state (`sdcard` enabled, no files) renders "SD card is empty" rather than a blank section.

---

### [x] feat: add MIDI SendMessage shim + complete MIDI monitor UI (FR-MIDI-1)

M47 delivered inbound MIDI (virtual keyboard → effect) and a monitor that shows what the shim
confirms it parsed, but nothing lets the *effect* send MIDI out, and nothing lets a developer send
message types besides notes. Add `SendMessage()` to both `MidiUsbHandler` and `MidiUartHandler`,
route it through the existing `midi_queue` as a new `midiTx` message kind, and extend `MidiPanel`
with a Program Change / Control Change sender and a real-time outbound-message list — all in the
same webview as the existing keyboard and inbound monitor (one "complete MIDI monitor", not a
second panel).

Mockup reviewed and approved (`docs/mockups/m48-io-monitors.html`, "MIDI Monitor" tab): **stacked**
layout — keyboard, then a Program Change / Control Change sender toolbar, then the unified
Rx/Tx monitor table, top to bottom in the same narrow sidebar-webview footprint the MIDI panel
already uses, matching the mockup's Variant A.

**Affected files:** `emulator/shim/include/daisy/midi_usb_handler.h`,
`emulator/shim/src/midi_usb_handler.cpp`, `emulator/shim/include/daisy/midi_uart_handler.h`,
`emulator/shim/src/midi_uart_handler.cpp`, `emulator/runtime/ipc_server.cpp`,
`emulator/runtime/audio_engine.cpp`, `src/webview/messages.ts`, `src/webview/midi-panel.ts`,
`src/webview/midi-webview.ts`, `src/webview/midi-monitor.ts`, `src/emulator/manager.ts`

**DoD:**
- `MidiUsbHandler::SendMessage(uint8_t*, size_t)` / `MidiUartHandler::SendMessage(uint8_t*, size_t)`
  parse the buffer with the shared `MidiEvent` parser (M47) and enqueue a `midiTx` message onto the
  existing `midi_queue` — no second queue.
- `MidiPanel` renders a Program Change selector and a Control Change (controller number + value)
  sender alongside the existing keyboard, each translating to the existing `midiEvent` wire
  message.
- The monitor lists both inbound (`midiRx`) and outbound (`midiTx`) traffic in one real-time,
  bounded-history list (reuses `pushMonitorEntry`'s shape from M47), visually distinguishing
  direction.
- Unit tests cover: `SendMessage` → `midiTx` enqueue (both shim classes), the PC/CC webview →
  byte-triplet translation, and the monitor reducer handling both message kinds.
- Monitor rows visually distinguish direction (Rx vs Tx) via a label/color, not just raw data.
