# M44 — Cheap Trio: Toggle, RGB LED, Encoder

**Version:** 0.15.0
**Status:** planned
**Source:** intake 2026-07-21 — device support expansion

## Goal

Add the three devices that are cheap to build and fill the most obvious gaps in the pin-attached
device model, while deliberately stressing the M43 registry in three different directions:
multi-position input, multi-channel output, and delta rather than level semantics. This milestone
is the registry's proof — it lands before OLED and MIDI precisely so that a structural weakness
surfaces while the fix is still cheap. After it, adding a pin-attached device should be a registry
entry, a codegen strategy and a shim class, with no edits to any view.

## Sprint Tasks

### [ ] feat: add toggle switch device (FR-DEV-7)

`Switch3` — a multi-position digital input. Exercises the registry's `multi-position` interaction
primitive, which nothing uses today.

**Affected files:** `src/devices/registry.ts`, `src/devices/codegen/toggle.ts`, `emulator/shim/src/switch3.cpp`, `emulator/shim/include/daisy/switch3.h`

**DoD:**
- A toggle can be placed from both the Wiring Editor and the Controls Editor palette with no view-layer code changes beyond registry data.
- Generated code declares `Switch3` and emits a correct `Init()` for the assigned pin.
- Position changes propagate to the running emulator over `controlValue` and are read correctly by `Switch3::Read()` in the shim.
- Position survives deploy via `controlSnapshot` replay and persists in `workspaceState`.
- Unit tests cover codegen insert/remove and position round-trip.

---

### [ ] feat: add RGB LED device (FR-DEV-8)

`RgbLed` — three output channels addressed as one named device. Exercises a single registry entry
owning multiple pins on the *output* side.

**Affected files:** `src/devices/registry.ts`, `src/devices/codegen/rgb-led.ts`, `emulator/shim/src/rgb_led.cpp`, `emulator/shim/include/daisy/rgb_led.h`

**DoD:**
- One RGB LED occupies three pins under a single user-supplied id; removing it releases all three.
- Generated code declares `RgbLed` and emits a correct three-pin `Init()`.
- Colour set from the running program renders in the Controls Editor via the `indicator` primitive.
- Conflict checking treats all three pins as owned, refusing any action that would claim one.
- Unit tests cover three-pin allocation, release, and partial-collision refusal.

---

### [ ] feat: add rotary encoder device (FR-DEV-9)

`Encoder` — two pins plus optional click, reporting *delta* rather than level. The first device
whose value semantics differ from everything shipped so far, and the main structural test of the
generalised `controlValue` protocol.

**Affected files:** `src/devices/registry.ts`, `src/devices/codegen/encoder.ts`, `src/webview/controls-webview.ts`, `emulator/shim/src/encoder.cpp`, `emulator/shim/include/daisy/encoder.h`

**DoD:**
- An encoder occupies two pins plus an optional third for its click, under one id.
- Generated code declares `Encoder` and emits a correct `Init()` including the click pin when present.
- The Controls Editor offers a rotary drag affordance with detents, using the `delta` primitive.
- `Encoder::Increment()` returns correct per-callback deltas in the shim, and `RisingEdge()` reports the click.
- Delta semantics ride the existing `controlValue {id, value}` message with no new message kind — confirming or refuting the M43 assumption recorded in `02_assumptions-and-risks.md`. If a new message kind proves necessary, the assumption is struck from `02` and the protocol change is made here rather than deferred.
- Unit tests cover accumulated-position-to-delta derivation across callback boundaries, including wraparound.
