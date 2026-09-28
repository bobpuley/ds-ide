# M66 — Unified Device Model (Drag & Drop)

**Version:** 0.20.1
**Status:** in progress
**Source:** feature intake session, 2026-09-28 (design_plan.md §5.2, §5.6; mockup docs/mockups/v22-unified-device-model.html)

## Goal

Replace the four placement gestures with one: pick up any of the ten registry devices from a
single Wiring Editor palette, see on the schematic where it can and cannot go (conflicts
included, before the drop), and drop it. After this milestone, controls and peripherals are
placed, moved and replaced the same way on the same board. The click-a-free-pin popup and the
Peripherals footer are gone, and free pins are inert.

## Sprint Tasks

### [x] feat: compute drop targets as a pure function (FR-UDM-6a)

The highlighting and the host's allocation must agree exactly, so target computation lives in
one pure module both sides can call.

**Affected files:** `src/wiring/drop-targets.ts`, `src/test/unit/wiring/drop-targets.test.ts`

**DoD:**
- `computeDropTargets(deviceId, PIN_DEFS, occupancy, exclude?)` returns targets `{ kind: 'pin' | 'lane' | 'usb', pins, bus?, conflicts[] }`
- single-pin devices: every `isPinEligible` pin not inside an enabled peripheral's lane; multi-pin: every start pin where `allocateAdjacentPins` succeeds, with the full allocated footprint; bus: one lane per `candidateBusesFor` bus via `resolveBusFootprint`; connector INTERNAL → `usb`
- `conflicts` lists every occupant a drop would displace; `exclude` treats a moving device's own pins as free
- unit-tested for all ten registry devices, including occupied lanes and a multi-pin device with no room; `npm test` green

---

### [x] feat: device palette in the Wiring Editor (FR-UDM-5)

All ten devices in one palette, generated from the registry.

**Affected files:** `src/wiring/wiring-panel.ts`, `src/webview/wiring-webview.ts`, `src/test/unit/wiring/wiring-panel.test.ts`

**DoD:**
- palette generated from `REGISTRY`, grouped *Controls* / *Peripherals*, each chip in its accent colour with its requirement (e.g. "ADC pin", "3 pins (R·G·B)", "SPI1 / I2C1")
- collapsible to a rail of colour dots that remain draggable, with the device name on hover
- a placed peripheral's chip is marked as placed
- `npm test` green

---

### [x] feat: drag-time board highlighting and footprint preview (FR-UDM-6b)

**Affected files:** `src/webview/wiring-webview.ts`, `src/wiring/wiring-panel.ts`

**DoD:**
- pointer-event drag from a palette chip; on pick-up every target repaints: eligible·free pulses in the accent colour, eligible·occupied amber-hatched with ⚠, everything else dimmed and not droppable
- bus devices show one dashed drop lane per candidate bus; the micro-USB port is a target for INTERNAL
- hovering a target previews the exact footprint (multi-pin slots labelled R/G/B, A/B/SW; hovered lane emphasised)
- a label follows the cursor naming the target pins/bus, or "not a valid target here"
- release off-target or Esc cancels with no change
- manual check against the mockup for pot, button, rgbled, encoder, oled, midiUsb

---

### [ ] feat: drop opens the placement popover (FR-UDM-7)

**Affected files:** `src/webview/wiring-webview.ts`, `src/webview/messages.ts`, `src/sidebar/wiring-editor-panel.ts`, `src/extension.ts`, `src/test/unit/extension.test.ts`

**DoD:**
- dropping on a free target opens the popover with pins (slot names) or bus, and for controls an id pre-filled by `defaultId` and validated by `validateId`; actions **Add** / **Cancel**
- `setPeripheralEnabled` gains optional `bus`; the lane dropped on is passed to `insertPeripheralIntoSource` / `insertPeripheralInitIntoSource` (no bus dropdown)
- generated code is identical to today's click-a-pin / checkbox output for the same device, pins and bus (unit-tested)
- `npm test` green

---

### [ ] feat: replace an occupant on conflict drop (FR-UDM-8)

**Affected files:** `src/webview/wiring-webview.ts`, `src/webview/messages.ts`, `src/extension.ts`, `src/test/unit/extension.test.ts`, `src/test/unit/wiring/conflict-remedy.test.ts`

**DoD:**
- dropping on an eligible·occupied target opens the popover in conflict mode naming every device that would be removed; actions **Replace** / **Cancel**, no Relocate
- `wirePin` and `setPeripheralEnabled` gain optional `replace: string[]`; the host removes those occupants and adds the new device in **one** `WorkspaceEdit` (single undo step)
- the host still runs `checkConflict` after the removal and falls back to `formatRejection()` if the source changed underneath
- unit tests: control replaces control, peripheral replaces controls on its lane, stale-replace rejection; `npm test` green

---

### [ ] feat: move placed devices by dragging (FR-UDM-9)

**Affected files:** `src/webview/wiring-webview.ts`, `src/webview/messages.ts`, `src/extension.ts`, `src/test/unit/extension.test.ts`

**DoD:**
- dragging a placed control off one of its pins lifts it with the same highlighting (its own pins count as free); dropping re-places it with its id kept via new `{ command: 'moveControl'; id; pinNumber }`, applied in one edit
- dragging a placed peripheral from the palette offers its other candidate bus(es) and moves it
- cancelling a move (off-target release, Esc, popover Cancel) leaves the device exactly where it was
- `npm test` green

---

### [ ] refactor: retire the old placement surfaces (FR-UDM-10)

**Affected files:** `src/wiring/wiring-panel.ts`, `src/webview/wiring-webview.ts`, `src/test/unit/wiring/wiring-panel.test.ts`, `src/test/unit/wiring/pin-overlay-state.test.ts`

**DoD:**
- free pins render grey (ADC pins keep their A-labels) and are inert: no pointer cursor, no hover highlight, no click action
- `#popup-assign` and the `#peripherals` footer (checkbox list + View button) are removed
- existing projects with wired controls and enabled peripherals render identical bus brackets, pin tooltips and micro-USB indicator (FR-DEV-12 / FR-DEV-17)
- manual check: every device can be added, moved, replaced and removed using only the palette, drag and the FR-UDM-3 popover
