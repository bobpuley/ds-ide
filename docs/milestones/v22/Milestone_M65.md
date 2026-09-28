# M65 — Unified Device Model (Foundation)

**Version:** 0.20.0
**Status:** planned
**Source:** feature intake session, 2026-09-28 (design_plan.md §5.1–5.4; mockup docs/mockups/v22-unified-device-model.html)

## Goal

Lay the groundwork for one placement gesture without changing it yet. Pin suitability becomes a
declarative registry field instead of a pot-specific badge. The Controls Editor's half-working
palette (3 of 6 devices silently do nothing when dropped) is retired. Every placed device, control
or peripheral, gets the same popover with Show panel / Reveal in code / Remove. After this
milestone, devices are still added through today's click-a-pin popup and Peripherals footer, but
there is exactly one way to inspect and act on a placed device, and eligibility is data, ready
for M66's drag model.

## Sprint Tasks

### [x] feat: add declarative pinRequires to the device registry (FR-UDM-1)

Pot's ADC requirement is hardcoded as a warn badge (`wiring-panel.ts`'s `id === 'pot'` case)
rather than declared on its descriptor, so nothing else can reason about pin suitability.

**Affected files:** `src/devices/registry.ts`, `src/wiring/pin-eligibility.ts`, `src/wiring/wiring-panel.ts`, `src/webview/wiring-webview.ts`, `src/test/unit/devices/registry.test.ts`, `src/test/unit/wiring/pin-eligibility.test.ts`

**DoD:**
- `DeviceDescriptor.pinRequires?: 'adc' | 'i2c' | 'uart' | 'spi' | 'sdmmc'` exists and is documented; pot declares `'adc'`
- new pure `isPinEligible(pinDef, deviceId)` in `src/wiring/pin-eligibility.ts`, unit-tested: pot → ADC pins only; button/led/toggle → every assignable pin; power/special pins → never
- the `pot-warn` badge and every `id === 'pot'` pin-suitability special case are removed; the assign popup's warning is driven by `isPinEligible`
- `npm test` green

---

### [x] refactor: remove the Controls Editor palette (FR-UDM-2)

The Controls Editor palette advertises all six controls but its drop handler rejects everything
except pot/button/led, so dragging Toggle, RGB LED or Encoder silently does nothing. Placement
moves wholly to the Wiring Editor.

**Affected files:** `src/sidebar/controls-editor-panel.ts`, `src/webview/controls/palette-drag-drop.ts`, `src/webview/controls/yaml-editor-canvas.ts`, `src/test/unit/sidebar/controls-editor-panel.test.ts`

**DoD:**
- `paletteItemsHtml()`, `paletteCssRules()`, the `#palette` markup/CSS and `palette-drag-drop.ts` are removed; no `addNewControl` path remains reachable from a drag
- no draggable palette item renders in the Controls Editor in any canvas mode
- the empty-canvas hint tells the user to add devices in the Wiring Editor
- existing controls still render, move and persist positions exactly as before (FR-CE-3 layout persistence unchanged)
- `npm test` green

---

### [ ] feat: one popover for every placed device (FR-UDM-3)

Today a placed control opens `popup-assigned` (Remove/Cancel only) and a peripheral opens the
separate bus popover (pin map + Disable); the live-view "View" button lives only in the footer.

**Affected files:** `src/wiring/wiring-panel.ts`, `src/webview/wiring-webview.ts`, `src/test/unit/wiring/wiring-panel.test.ts`

**DoD:**
- clicking a placed control's pin, a peripheral's bus bracket or pin, or the micro-USB port (connector peripheral on INTERNAL) opens one `#device-popover`
- header: accent dot, device label, id (controls); body: pins with slot names for multi-pin devices (e.g. `R=D15 G=D16 B=D17`) or bus + resolved pins
- actions: **Show panel** (only when `REGISTRY[id].hasLiveView`, posts the existing `viewPeripheral`), **Reveal in code**, **Remove** (same effect as today's Remove / Disable)
- `popup-assigned` and `#bus-popover` are removed; the click-a-free-pin assign popup and Peripherals footer remain (removed in M66)
- `npm test` green; manual check: OLED / MIDI TRS / MIDI USB show *Show panel*, SD card and controls don't

---

### [ ] feat: reveal a placed device's generated code (FR-UDM-4)

Generated declarations are marker-delimited and `findMarkerRange` already locates them, but
nothing lets the user jump from the board to the code.

**Affected files:** `src/webview/messages.ts`, `src/sidebar/wiring-editor-panel.ts`, `src/extension.ts`, `src/webview/wiring-webview.ts`, `src/test/unit/sidebar/wiring-editor-panel.test.ts`, `src/test/unit/extension.test.ts`

**DoD:**
- new `WiringWebviewMessage` `{ command: 'revealInCode'; id: string }`, validated host-side via the existing `hasKnownCommand` + exhaustive `switch` convention
- host opens the effect source, reveals and selects the device's declaration for controls and for bus/connector peripherals
- missing/corrupted markers → a warning naming the device; no editor is scrolled to a wrong range
- unit tests cover found, not-found and unknown-id cases; `npm test` green
