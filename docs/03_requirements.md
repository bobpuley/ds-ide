# 03 — Requirements (v14)

> **v13 complete** — all v13 requirements implemented; ACs green.
> Archived: [`docs/v13/03_requirements.md`](v13/03_requirements.md).

---

## v14 — Device support expansion

Source: intake 2026-07-21. UX settled against
[`docs/mockups/v14-peripheral-ux.html`](mockups/v14-peripheral-ux.html).

Requirements for **M45–M47 are provisional** — recorded so the roadmap is traceable, but their
acceptance criteria are finalised when each milestone is detailed, after the registry has been
proven by M44.

### M43 — Device registry & protocol foundation

**FR-DEV-1 — Generalised control IPC.** The per-device-type messages `pot`, `potSnapshot`,
`button`, `buttonSnapshot` are replaced by `controlValue {id, value}` and `controlSnapshot`.
Adding a device must not add message kinds.

**FR-DEV-2 — Device registry.** A single module is the sole source of truth for device types.
The three duplicated `pot|button|led` unions (`controls-convention-parser.ts:1`,
`controls-writer.ts:3`, `wiring-panel.ts:3`) and the hardcoded palette/CSS/popup entries are
replaced by enumeration of the registry. Adding a device touches one module plus its shim.

**FR-DEV-3 — Attachment model.** A device declares its attachment as `pin`, `pins[]`, or
`connector`. A bus-attached peripheral declares `bus → pins`, not a static pin set, so that
changing bus re-maps its footprint. Pin/signal data derives from `Daisy_Seed_Rev4_Pinout.csv`.

**FR-DEV-4 — Migration without behaviour change.** `pot`, `button` and `led` are expressed
through the registry. Existing generated code, `controllers.yaml` files and saved workspace state
continue to load and behave identically; the pot's shared `AdcChannelConfig` array codegen
(FR-CODEGEN-1) is preserved exactly.

**FR-DEV-5 — Board-bundle headroom.** The registry can express a board as a named bundle of
device instances at fixed pins plus a faceplate graphic, without that facility being implemented
or exposed in v14.

**FR-DEV-6 — Protocol version handshake.** Extension and emulator exchange a protocol version on
connect and surface an explicit, actionable error on mismatch rather than failing silently.

### M44 — Cheap trio

**FR-DEV-7 — Toggle switch.** `Switch3`, multi-position digital input, single pin.

**FR-DEV-8 — RGB LED.** `RgbLed`, three PWM output channels addressed as one named device.

**FR-DEV-9 — Rotary encoder.** `Encoder`, two pins plus optional click, reporting delta rather
than level, with a rotary drag affordance in the Controls Editor.

### M45 — MicroSD & bus-peripheral UI *(provisional)*

**FR-DEV-10 — FatFS host shim.** SD card access maps onto a workspace-relative host directory.

**FR-DEV-11 — Peripherals section.** Bus peripherals are enabled, disabled and configured from a
dedicated section of the Wiring Editor, and are drawn on the board at the pins they occupy.

**FR-DEV-12 — Collapsed bus labelling.** A bus group renders as one bracket with one label. Inline
per-pin text appears only for devices the user named; system-assigned pins stay bare. Detail is on
demand: hover a bus pin for a tooltip (pin · signal · owner), click a bracket for a structured
popover (pin map, bus selection, disable).

**FR-DEV-13 — Reject with remedy.** An action that would produce a pin conflict is refused, not
applied-and-flagged. The refusal names every blocking pin with its signal and owner, and offers
concrete remedies; a peripheral blocker gets a one-click fix, a control blocker gets guidance only
— the editor never relocates a hand-placed control automatically.

### M46 — OLED display *(provisional)*

**FR-DEV-14 — OLED shim.** `OledDisplay` (SSD1306) captures a framebuffer off the real-time path
and ships it over IPC.

**FR-DEV-15 — OLED viewer.** A webview panel renders the framebuffer at its native 128×64,
reporting frame rate and bus.

### M47 — MIDI *(provisional)*

**FR-DEV-16 — MIDI TRS.** `MidiUartHandler` over USART1 (D13–D14) or an alternative UART.

**FR-DEV-17 — MIDI USB.** `MidiUsbHandler` in both `INTERNAL` (micro USB connector) and
`EXTERNAL` (USB HS, D29–D30) modes.

**FR-DEV-18 — MIDI I/O surface.** An on-screen keyboard and message monitor, plus a host MIDI
bridge on macOS.
