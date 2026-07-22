# M46 — OLED Display

**Version:** 0.14.3
**Status:** in progress
**Source:** intake 2026-07-21 — device support expansion

## Goal

Make menu-driven firmware debuggable. A large fraction of non-trivial Daisy projects drive an
SSD1306 over SPI or I2C, and today none of that is observable in ds-ide at all — the developer is
back to flashing hardware to see whether a menu renders. After this milestone the emulator captures
the display framebuffer off the real-time path and a webview panel renders it at native 128×64, so
UI logic can be stepped through and watched in place.

OLED is also the registry's first peripheral with more than one candidate bus (SPI1 or I2C1, per
[`docs/mockups/v14-peripheral-ux.html`](../../mockups/v14-peripheral-ux.html)) — `sdcard`'s single
fixed `bus` field (`registry.ts:87-94`) was deliberately left to be extended "once it actually
needs" a choice; this milestone is that moment.

> ⚠️ ASSUMPTION: real libDaisy's `OledDisplay` exposes `WriteString()`/`SetCursor()` backed by its
> own font bitmap tables (`Font_6x8`/`Font_11x18`/etc.) — the only corpus example
> (`daisy-seed-knowledge/examples/OLED/OLED.cpp`) drives the display exactly this way. Since this
> project reimplements the whole libDaisy surface as a host shim rather than linking real libDaisy
> (there is no vendored font data anywhere in the tree), porting those tables is a nontrivial task
> of its own. Confirmed scope for M46 (2026-07-22): the shim implements pixel primitives only —
> `Fill()`, `DrawPixel()`, `Update()` and the framebuffer capture/IPC path — with no
> `WriteString`/`SetCursor`/font support. An effect using `WriteString` today will not compile
> against this shim; porting a font table (real or a minimal stand-in) is deferred to a follow-up
> task, not bundled into FR-DEV-14.

## Sprint Tasks

### [x] feat: add OLED display shim (FR-DEV-14)

`OledDisplay` (SSD1306) — the first device whose registry entry offers more than one candidate bus
(SPI1 or I2C1), and the first whose runtime data is a framebuffer rather than a scalar. Its
`Update()` is called from the effect's own `while(1)` loop, which runs on `effect_main()`'s thread
(`emulator/runtime/main.cpp`) — a different thread from the audio engine's RT callback that owns
today's single `ipc_queue`. Reusing that queue's single instance would turn it into a two-producer
queue and break its SPSC invariant, so the framebuffer gets its **own** `SpscIpcQueue` instance
(same lock-free, non-allocating type, second copy) drained alongside the existing one by
`run_audio_engine()`'s drain thread. This is the measurement the milestone note in
`02_assumptions-and-risks.md` calls for: confirming a ~1 KB frame ships over that mechanism without
perturbing the RT audio thread, not assuming it.

**Affected files:** `src/devices/registry.ts`, `src/devices/codegen/oled.ts`, `src/wiring/peripheral-state.ts`, `src/wiring/peripheral-config.ts`, `src/wiring/conflict-remedy.ts`, `emulator/shim/include/daisy/oled_display.h`, `emulator/shim/src/oled_display.cpp`, `emulator/runtime/emulator_state.h`, `emulator/runtime/audio_engine.cpp`, `emulator/CMakeLists.txt`, `docs/02_assumptions-and-risks.md`

**DoD:**
- `oled` registry entry declares `attachmentKind: 'bus'` with candidate buses `['SPI1', 'I2C1']` (extending the single-bus `bus?: string` field per its own forward-looking comment at `registry.ts:87-94`), resolving its footprint via the existing `resolveBusFootprint` for whichever bus is currently selected — no static pin list.
- The currently-selected bus persists across a VS Code reload, the same way M45's peripheral enabled state already does (FR-DEV-11 DoD).
- Generated code declares `OledDisplay` and emits an `Init()` matching the selected bus's real libDaisy driver (4-wire SPI vs I2C transport) exactly once when enabled, removed cleanly when disabled — mirrors `sdcard`'s at-most-once `PeripheralCodegenStrategy`, not a per-instance strategy.
- The shim's `Update()` captures the current 128×64×1bpp framebuffer (1024 bytes) with no heap allocation and no lock, and hands it to a dedicated `SpscIpcQueue` instance separate from the audio engine's — verified by a test that drives both queues concurrently and asserts neither blocks or drops due to the other's traffic.
- A synthetic-load test pushes frames at a sustained 60 fps for several seconds and asserts zero `oversize_drops`/queue contention and no allocation on the producer path — the outcome (pass, or the mitigation if it doesn't) is written back into `02_assumptions-and-risks.md`, replacing the ⚠️ ASSUMPTION with a ✅ CONFIRMED entry in the same style as M44's encoder entry.
- Unit tests (`tests/oled-shim/`, following the `encoder-shim`/`rgb-led-shim` plain-assert convention) cover: pixel set/clear round-trip, full-buffer capture on `Update()`, and the framebuffer size invariant (1024 bytes for 128×64×1bpp). TS-side tests cover the codegen strategy and the bus-selection persistence round-trip.

---

### [x] feat: add OLED viewer panel (FR-DEV-15)

A webview panel renders the captured framebuffer at native 128×64 (scaled up for visibility, as in
the mockup's 256×128 canvas), reporting live frame rate and the peripheral's currently-selected bus
— the first peripheral in the Peripherals section (M45, FR-DEV-11) with a live view to open, not
just an on/off toggle.

**Affected files:** `src/webview/oled-panel.ts`, `src/webview/oled-webview.ts`, `src/webview/messages.ts`, `src/extension.ts`, `src/wiring/wiring-panel.ts`, `src/webview/wiring-webview.ts`

**DoD:**
- New `OledHostMessage`/`OledWebviewMessage` pair in `messages.ts` carries an `oledFrame` message (base64-encoded 1024-byte payload) — the "separate message carrying an opaque pixel payload" the architecture doc already calls out as the one exception to "adding a device adds no message kinds."
- `OledPanel` mirrors `ScopePanel`'s structure (panel lifecycle, `webviewReady` handshake replaying the last frame on reveal) and is shown when the emulator session starts, the same trigger `scopePanel.show(...)` uses today.
- The webview canvas renders each incoming frame at 128×64, decoded client-side from the base64 payload, with no per-frame allocation growth in the extension host.
- The panel's footer reports live frame rate (measured from message arrival timestamps) and the peripheral's current bus label (e.g. "SSD1306 · 128×64 · SPI1"), matching the mockup's readout.
- The Peripherals section's OLED entry gains a "view" action that opens or reveals the panel, and the panel auto-opens on deploy when OLED is enabled (mirroring `scopePanel.show(...)`'s trigger, but conditional — unlike scope, popping an OLED viewer for an effect that never uses one would be noise).
- Unit tests cover the frame-rate calculation as a pure function and the base64 encode/decode round-trip; a manual/human-driven check (deploy an effect that draws to the OLED and watch it render live) is added to `tests/human-driven/showcase.js` if that file exists.

> Deferred, not bundled here: the bus-choice **selector** in M45's popover (switching an already-enabled
> OLED between SPI1 and I2C1 from the UI). The underlying capability is real and tested —
> `busChoices` on the registry entry, `currentBusOf`'s source-text readback, `insertPeripheralIntoSource`'s
> `bus` parameter, and `conflict-remedy.ts`'s generalized `candidateBusesFor` all support it — but the
> switch *action* itself (a new webview command, conflict re-check before applying, and the popover
> dropdown) is a distinct, self-contained follow-up, the same way M45 itself deferred this exact piece
> ("none does yet... deferred until a real multi-bus peripheral needs it"). Today OLED always enables at its
> default bus (SPI1, `busChoices[0]`) from the UI; picking I2C1 requires hand-editing the generated
> declaration line until the switch action ships.
