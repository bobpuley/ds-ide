# 04 — Architecture (v15)

> **v14 complete** — full v14 architecture in
> [`docs/v14/04_architecture.md`](v14/04_architecture.md).

No new architecture/systems introduced yet — v15 work so far extends existing patterns. See notes
below, one per requirement.

## Intake notes

- **FR-CE-1 (Controls Editor layout-persistence fix):** no architecture impact. The fix conforms
  to the existing extension-host-authoritative-cache + push-on-visibility-change pattern
  (`ControlsViewProvider`) already documented in prior versions — it corrects an omitted refresh
  call (`onEditorSave` never re-pushing the cache after its direct `fs.writeFile`), not a new
  data flow or component.
- **FR-SD-1 (SD content viewer):** small data-flow addition, no new system. Extension host reads
  `./sdcard/`'s root entries via `fs.readdir` (and `fs.readFile`, size-capped, for the `.txt`
  preview) on-demand — webview focus or explicit refresh, not a persistent watch — and pushes an
  `sdContents` message to the Controls Editor webview. Mirrors the read-on-open pattern already
  used elsewhere (no new cache, so FR-CE-1's fix doesn't need to cover this path).
- **FR-MIDI-1 (complete MIDI monitor):** two new pieces on top of M47's plumbing. (1)
  `SendMessage(uint8_t* buff, size_t size)` added to both `MidiUsbHandler` and `MidiUartHandler`
  shims — an effect calling it enqueues onto a new outbound path. (2) That path reuses M47's
  existing dedicated `midi_queue` (`SpscIpcQueue`, emulator→extension) rather than adding a second
  queue — it already carries one MIDI-monitor message kind (`midiRx`) to the same panel; a new
  `midiTx` message kind shares the channel, since both are "traffic the panel displays," not
  RT-path telemetry with different producer/consumer needs. `messages.ts` gains the `midiTx`
  webview message kind alongside `midiRx`. Send-to-effect UI (Program Change/Control Change) uses
  the existing `midiEvent` wire message (extension→emulator) M47 already defined — no new inbound
  message type needed, just new webview UI producing more of the same byte-triplet shape.
- **FR-CE-3 (persist encoder/toggle/rgbled positions):** extends `controllers.yaml` with a section
  per device kind (mirroring `controllers:`/`buttons:`/`leds:`), each entry carrying its own
  `editor_pos` — the same field/round-trip convention `ControllerDef`/`ButtonDef`/`LedDef` already
  use, rather than inventing a new storage shape or piggybacking position onto the source
  annotation. `buildControlsConfig()`'s `placements` array (currently only derived from
  `yamlCfg.pots/buttons/leds`) gains these three kinds; the webview's convention-mode Save handler
  needs a parallel `updatedEncoders`/`updatedToggles`/`updatedRgbLeds` branch alongside its existing
  `updatedPots`/`updatedButtons`/`updatedLeds`. Not designed in further detail here — resolve the
  concrete `ControllerConfig` shape change (new fields vs. new top-level arrays) when M50 starts.
- **FR-CE-2 (OLED embedding in Controls Editor):** `ControlsViewProvider` (sidebar `WebviewView`,
  `src/sidebar/controls-editor-panel.ts`) and `OledPanel` (editor-column `WebviewPanel`,
  `src/webview/oled-panel.ts`) are separate infrastructure today with no shared abstraction.
  Embedding requires: (1) `EmulatorManager`'s `'message'` → `oledFrame` subscription, currently
  only wired in `OledPanel`'s constructor, relocated or dual-subscribed so `ControlsViewProvider`
  also receives frames when `oled` is enabled; (2) `controls-webview.js` gains a docked-strip
  canvas render path (a new `#oled-strip` element above the existing `#design-area`, collapsed to
  zero height when `oled` is disabled) reusing `oled-frame.ts`'s existing render logic — the
  layout canvas below it is otherwise untouched, both are visible at once (mockup Variant B,
  `docs/mockups/m49-oled-embed.html`); (3) a new embedded-view message contract in `messages.ts`
  (distinct from the pop-out path). The pop-out ("show in separate view") action reuses today's
  `hasLiveView`/`viewPeripheral` flow unchanged — `OledPanel` itself doesn't change. No change to
  `wiring-webview.ts`'s existing View button for other `hasLiveView` peripherals (midiTrs/midiUsb)
  — this milestone only embeds OLED. Note: the mockup's mini layout editor deliberately omits
  `#palette` — real code still has it, but it isn't rendered in practice today (kept for now in
  case pre-stability work needs it again).
