# 01 — Input Ideas (v14)

> **v1 complete** — ds-ide 0.1.0–0.1.7 (M0–M7), all ACs green. Full v1 ideas archived in
> [`docs/v1/01_input-ideas.md`](v1/01_input-ideas.md).
>
> **v2 complete** — ds-ide 0.2.0–0.2.9 (M8–M15), all ACs green. Full v2 ideas archived in
> [`docs/v2/01_input-ideas.md`](v2/01_input-ideas.md).
>
> **v3 complete** — ds-ide 0.3.0–0.3.3 (M16–M18), all ACs green. Full v3 ideas archived in
> [`docs/v3/01_input-ideas.md`](v3/01_input-ideas.md).
>
> **v4 complete** — ds-ide 0.4.0–0.4.3 (M19–M22), all ACs green. Full v4 ideas archived in
> [`docs/v4/01_input-ideas.md`](v4/01_input-ideas.md).
>
> **v5 complete** — ds-ide 0.5.0–0.5.1 (M23–M24), all ACs green. Full v5 ideas archived in
> [`docs/v5/01_input-ideas.md`](v5/01_input-ideas.md).
>
> **v6 complete** — archived to `docs/v6/` on 2026-06-21. Full v6 ideas archived in
> [`docs/v6/01_input-ideas.md`](v6/01_input-ideas.md).
>
> **v7 complete** — archived to `docs/v7/` on 2026-06-21. Full v7 ideas archived in
> [`docs/v7/01_input-ideas.md`](v7/01_input-ideas.md).
>
> **v8 complete** — archived to `docs/v8/` on 2026-06-22. Full v8 ideas archived in
> [`docs/v8/01_input-ideas.md`](v8/01_input-ideas.md).
>
> **v9 complete** — archived to `docs/v9/` on 2026-06-29. Full v9 ideas archived in
> [`docs/v9/01_input-ideas.md`](v9/01_input-ideas.md).
>
> **v10 complete** — archived to `docs/v10/` on 2026-06-30. Full v10 ideas archived in
> [`docs/v10/01_input-ideas.md`](v10/01_input-ideas.md).
>
> **v11 complete** — archived to `docs/v11/` on 2026-07-04. Full v11 ideas archived in
> [`docs/v11/01_input-ideas.md`](v11/01_input-ideas.md).
>
> **v12 complete** — archived to `docs/v12/` on 2026-07-05. Full v12 ideas archived in
> [`docs/v12/01_input-ideas.md`](v12/01_input-ideas.md).
>
> **v13 complete** — archived to `docs/v13/` on 2026-07-05. Full v13 ideas archived in
> [`docs/v13/01_input-ideas.md`](v13/01_input-ideas.md).

---

## Device support expansion (intake 2026-07-21)

Source: design session driven from `devices-list.md`; UX settled against the interactive mockup
at [`docs/mockups/v14-peripheral-ux.html`](mockups/v14-peripheral-ux.html).

### The seed

- Only three device types are supported today (`pot`, `button`, `led`). The set is too small for
  the app to be broadly useful; `devices-list.md` lists ten common Daisy Seed peripherals.
- Adding a device today means editing ~12 hardcoded sites across TypeScript, C++ and the IPC
  protocol, with three separately-declared `pot|button|led` string unions that must agree
  (`controls-convention-parser.ts`, `controls-writer.ts`, `wiring-panel.ts`,
  `controls-editor-panel.ts`, the shim, and two IPC message kinds per device type).
- Devices should be *pluggable*: define behaviour, graphical representation and technical
  specification once, then have the emulator and the extension views load them.

### Devices wanted

- **Toggle switch** (`Switch3`), **RGB LED** (`RgbLed`), **rotary encoder** (`Encoder`) — cheap,
  reuse existing plumbing; encoder introduces delta rather than level semantics.
- **MicroSD** — FatFS over the host filesystem; unblocks samplers and loopers.
- **OLED display** (`OledDisplay`, SSD1306) — highest value; menu-driven firmware is currently
  undebuggable in ds-ide.
- **MIDI in/out** — TRS/UART and USB; unblocks synth projects.
- **CV / gate** — *not selected for v14*; only worth it if Eurorack becomes a target audience.
- **Board BSPs** (Pod, Patch, Petal, Field, Patch.Init) — *deferred to a later phase*, but the
  device model must leave room for a board to be expressed as a bundle of components at fixed
  pins plus a faceplate graphic.

### Decisions reached

- **Pluggability is a compiled-in registry, not a plugin system.** Specification and graphical
  representation are declarative; *behaviour* is not — the C++ shim must be compiled in, and pot
  codegen (shared contiguous `AdcChannelConfig` array with positional indices, FR-CODEGEN-1) is
  not expressible declaratively. Single source of truth, no third-party loading.
- **Generalise the IPC protocol first.** `pot`/`potSnapshot`/`button`/`buttonSnapshot` become
  `controlValue {id, value}` / `controlSnapshot`. Protocol is the expensive thing to change late.
- **An attachment point is a pin, a pin group, or a built-in connector.** Verified against
  `Daisy_Seed_Rev4_Pinout.csv`: SD→D1–D6 (SDMMC1), OLED→D7–D10 (SPI1) or D11–D12 (I2C1),
  MIDI TRS→D13–D14 (USART1), USB MIDI EXTERNAL→D29–D30, USB MIDI INTERNAL→the micro USB
  connector already drawn at `wiring-panel.ts:167`.
- **A peripheral's pin footprint is not fixed** — it is a function of its bus config, so the
  registry must model `bus → pins`, not a static pin set.
- **Bus groups collapse to one bracket label** on the pinout; detail on demand via tooltip
  (unstructured: which signal is this pin) and popover (structured: pin map, bus choice, disable).
  Inline labels only for devices the user named; system-assigned pins stay bare.
- **Conflicting actions are rejected, not accepted-and-flagged.** The refusal names every
  blocking pin and offers a concrete remedy; peripheral blockers get a one-click fix, control
  blockers get guidance only (never silently relocate something placed by hand).

### Captured, not scheduled

- **Wiring conflicts as editor diagnostics.** Rejection prevents the *UI* creating conflicts, but
  `controllers.yaml` and the C++ remain hand-editable, so a conflicting state can always arrive
  from outside. It should surface like any other defect — squiggles in the editor plus Problems
  panel entries. Smaller than it sounds: `extension.ts:363` already creates the `ds-ide`
  `DiagnosticCollection` and `diagnostics/build-diagnostics.ts` already maps problems to
  `vscode.Diagnostic` with severities; today the only producer is compiler output
  (`commands/build.ts:62`). This adds a second producer that walks the wiring model and anchors to
  the `// ds-ide: id=…, kind=…, pin=…` annotation lines, whose ranges the Wiring Editor already
  computes. Own questions to answer in its own intake: when analysis runs (save / build / live),
  whether a conflict blocks deploy or only warns, whether quick-fixes re-pin, what severity, and
  how it reconciles with the Wiring Editor's rejection so the two never disagree.
  **Deliberately unscheduled — needs its own deep dive.**

- **OLED font/text rendering.** M46's shim implements `OledDisplay` pixel primitives only
  (`Fill`/`DrawPixel`/`Update`) — confirmed scope, 2026-07-22 (`02_assumptions-and-risks.md`).
  Real libDaisy's `WriteString`/`SetCursor` depend on font bitmap tables (`Font_6x8`, `Font_11x18`,
  etc.) this project has no vendored copy of; porting them (or a minimal stand-in face) is its own
  task, not bundled into FR-DEV-14. An effect using `WriteString` today will not compile against
  the M46 shim until this lands. **Deliberately unscheduled.**

- **OLED bus-choice selector in the Peripherals popover.** M45's popover already anticipated this
  ("a peripheral with more than one candidate bus would also show a bus choice... deferred until a
  real multi-bus peripheral needs it") and M46 built the underlying capability (`busChoices` on the
  registry entry, `currentBusOf`'s source-text readback, `insertPeripheralIntoSource`'s `bus`
  parameter, `conflict-remedy.ts`'s generalized `candidateBusesFor`) — but the switch *action*
  itself (a new webview command, conflict re-check before applying, the popover dropdown) is a
  distinct follow-up, not bundled into FR-DEV-15. Today OLED always enables at SPI1 (`busChoices[0]`)
  from the UI. **Deliberately unscheduled.**

- **SD Card file navigator/preview in the Controls Editor.** Raised during M46 manual testing:
  wiring SD Card and OLED, the Controls Editor shows nothing for either — expected, since a bus
  peripheral has no runtime value and is deliberately excluded from the Controls Editor, configured
  only from the Wiring Editor's Peripherals section instead (M45, FR-DEV-11). A simple file
  navigator over the FatFS host shim's `./sdcard/` directory, with a preview for `.txt` files,
  would give SD Card the same kind of live observability OLED's viewer panel gives the display —
  but it's a genuinely new feature (file I/O UI, text-preview rendering), not something either
  M45 or M46 scoped. **Deliberately unscheduled — needs its own intake** (UI location, what file
  types preview vs. just list, read-only or read/write, refresh trigger).
