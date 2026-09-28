# 03 — Requirements (v22)

> **v21 complete** — all v21 requirements implemented; ACs green.
> Archived: [`docs/v21/03_requirements.md`](v21/03_requirements.md).

## Unified device interaction model — `FR-UDM-*` (intake 2026-09-28)

Source: `design_plan.md` §5.1–5.4, 5.6 (see `01_input-ideas.md`, 2026-09-28). Layout reference:
`docs/mockups/v22-unified-device-model.html`. Split across two milestones: **M65** (foundation:
declarative capability, one popover, retire the Controls palette) and **M66** (the drag model
itself). §5.5 (transport) is parked, not required.

**Decisions recorded 2026-09-28:** the Controls Editor palette is removed, not fixed; drag & drop
is the only placement gesture (no click-a-free-pin fallback, no keyboard path — today's editor has
none either, so this is not a regression); an occupied drop offers **Replace / Cancel** only, with no
automatic relocation; the panel button is always labelled **Show panel** (reveal-or-open, no
open-state tracking).

### M65 — Foundation

**FR-UDM-1 — Declarative pin requirement.** `DeviceDescriptor` gains an optional
`pinRequires?: 'adc' | 'i2c' | 'uart' | 'spi' | 'sdmmc'` (undefined = any assignable pin; bus
devices keep expressing theirs through `bus` / `busChoices`). Pot declares `pinRequires: 'adc'`.
- AC: a pure `isPinEligible(pinDef, deviceId)` (or equivalent) derives eligibility from
  `pinRequires` + `PIN_DEFS` for every pin-attached registry device, unit-tested for pot (ADC pins
  only) and for a device with no requirement (every assignable pin).
- AC: the hardcoded `pot-warn` badge (`wiring-panel.ts`'s `id === 'pot'` special case) is removed.
  No device id is special-cased for pin suitability anywhere in `src/wiring` or `src/webview`.

**FR-UDM-2 — Retire the Controls Editor palette.** The Controls Editor no longer adds devices. Its
palette (`paletteItemsHtml()` / `paletteCssRules()`) and `palette-drag-drop.ts` are removed; the
Controls Editor only lays out controls that are already wired.
- AC: no draggable palette item renders in the Controls Editor in any canvas mode; the silent
  no-op for toggle / RGB LED / encoder no longer exists because the gesture no longer exists.
- AC: the Controls Editor's empty-canvas hint points the user to the Wiring Editor for adding
  devices instead of "Drag a control from the palette".

**FR-UDM-3 — One popover for every placed device.** Clicking a placed control's pin, a
peripheral's bus bracket or one of its pins, or the micro-USB port when a connector-attached
peripheral is on INTERNAL, opens the same popover. It replaces today's assigned-pin popup
(`popup-assigned`) and bus popover (`#bus-popover`).
- AC: the header shows the device's accent dot, label and id (controls); the body shows its pins
  (with slot names for multi-pin devices, e.g. `R=D15 G=D16 B=D17`) or its bus and resolved pins.
- AC: action row: **Show panel** (rendered only when `REGISTRY[id].hasLiveView`), **Reveal in code**,
  **Remove**. Remove behaves exactly as today's Remove (controls) / Disable (peripherals).
- AC: **Show panel** reveals the device's live panel (OLED / MIDI), opening it if it is not open.
  Same label in both cases.

**FR-UDM-4 — Reveal in code.** The popover's *Reveal in code* opens the effect source and reveals
and selects the device's generated declaration via its tracked marker range.
- AC: works for pin-attached controls and for bus/connector peripherals.
- AC: if the marker range can't be found (hand-edited or corrupted markers), a clear warning names
  the device and no wrong range is revealed.

### M66 — Drag model

**FR-UDM-5 — One device palette in the Wiring Editor.** The Wiring Editor shows a palette holding
all ten registry devices, grouped *Controls* / *Peripherals*, each chip in the device's accent
colour with its attachment requirement (e.g. "ADC pin", "3 pins (R·G·B)", "SPI1 / I2C1").
- AC: the palette is generated from `REGISTRY`. A new registry device appears with no Wiring
  Editor edit.
- AC: the palette is collapsible to a rail of colour dots that are still draggable, with the
  device name on hover.
- AC: an already-placed peripheral is marked as placed. Dragging it again moves it (FR-UDM-9).

**FR-UDM-6 — The board answers while dragging.** Picking up a device repaints every target:
- eligible · free — pulses in the device's accent colour;
- eligible · occupied — amber hatch + ⚠, still droppable (FR-UDM-8);
- ineligible — dimmed, not a drop target.
Target shapes:
- single-pin devices: each eligible pin (per FR-UDM-1; pins inside an enabled peripheral's lane
  are ineligible);
- multi-pin devices: each start pin for which `allocateAdjacentPins` succeeds;
- bus devices: one dashed lane per candidate bus spanning its resolved footprint;
- the micro-USB port for a connector's INTERNAL mode.
- AC: hovering a target previews the exact footprint the drop would claim. Multi-pin slots are
  labelled (R/G/B, A/B/SW); a hovered lane is emphasised.
- AC: a label follows the cursor, naming the target pins/bus or "not a valid target here".
- AC: releasing off-target or pressing Esc cancels with no change.
- AC: target computation is a pure, unit-tested function of (device, `PIN_DEFS`, occupancy).

**FR-UDM-7 — Drop → placement popover.** Dropping on a free target opens a popover showing the
pins (with slot names) or the bus, and for controls an id field pre-filled by `defaultId` and
validated by `validateId`. Actions: **Add** / **Cancel**.
- AC: for a multi-bus peripheral, the lane dropped on *is* the bus choice: it is passed to
  `insertPeripheralIntoSource(source, id, bus)` / `insertPeripheralInitIntoSource`. There is no bus
  dropdown.
- AC: the generated code is identical to what today's click-a-pin / checkbox paths write for the
  same device, pins and bus.

**FR-UDM-8 — Occupied drop → Replace / Cancel.** Dropping on an eligible·occupied target opens the
popover in conflict mode, naming every device that would be removed.
- AC: **Replace** removes the named occupant(s) and adds the new device in one `WorkspaceEdit`.
  **Cancel** changes nothing. There is no Relocate action.
- AC: the conflict is known before the drop (FR-UDM-6), so `formatRejection()` is no longer
  reached from this path.

**FR-UDM-9 — Move by dragging.** Dragging a placed control off one of its pins lifts it: the same
highlighting applies (its own pins count as free), and dropping re-places it keeping its id.
Dragging a placed peripheral from the palette moves it to another candidate bus.
- AC: cancelling a move leaves the device exactly where it was.

**FR-UDM-10 — Retire the old placement surfaces.** Free pins render grey and are inert (no pointer
cursor, no hover highlight, no click action). The click-a-free-pin assign popup (`#popup-assign`)
and the Peripherals footer (checkbox list + View button) are removed.
- AC: existing projects with wired controls and enabled peripherals render the same bus
  brackets, pin tooltips and micro-USB indicator as before (FR-DEV-12 / FR-DEV-17 unchanged).
- AC: every device can still be added, moved and removed using only the palette, drag and the
  FR-UDM-3 popover.

## Transport actions on native VS Code surfaces — `FR-TRN-*` (intake 2026-09-28)

Source: `design_plan.md` §5.5 (see `01_input-ideas.md`, 2026-09-28). Layout reference:
`docs/mockups/v22-transport-actions.html` (native-surfaces variant). Milestone: **M67**,
independent of M65/M66.

**Decisions recorded 2026-09-28:** one launch configuration (`DS-IDE: Build, Deploy & Debug`) —
F5 debugs, Ctrl+F5 runs; Restart = rebuild + redeploy; the Daisy view is a native `TreeView` in
the Run and Debug container (no webview); no status-bar Run button; board detection is on-demand
only (no background polling).

### M67 — Stateful transport

**FR-TRN-1 — Ctrl+F5 is a real run session.** "Run Without Debugging" on the `ds-ide` launch
configuration builds, deploys and starts audio, then keeps a live no-debug session for as long as
the emulator runs (today `resolveDebugConfiguration` returns `undefined` for `noDebug`: no session,
no toolbar, no Stop).
- AC: during a run, VS Code's floating debug toolbar shows Restart / Stop; ■ Stop and ⇧F5 stop
  the emulator and end the session.
- AC: an emulator exit (normal or crash) ends the session; no session outlives its emulator and
  no emulator outlives its session (user stop, crash, window reload, a second launch while
  running).
- AC: F5 (debug) keeps today's behaviour: build, deploy, hand off to the `daisy-debug` attach
  session.
- AC: every existing granular command and keybinding (`ds-ide.build`, `deploy`, `start`, `stop`,
  `debug`, `buildAndDeploy`, `buildHardware`, `flash`) is unchanged.

**FR-TRN-2 — Restart rebuilds and redeploys.** ↻ Restart / ⇧⌘F5 in a run or a debug session
stops the emulator, rebuilds, redeploys and restarts in the same mode.
- AC: a source edit saved before Restart is running after Restart.
- AC: a build failure during Restart ends the session and surfaces as in FR-TRN-6.

**FR-TRN-3 — Editor-title ▶.** On the project's effect source, when `ds-ide.isDaisyProject`, the
editor title shows VS Code's run button with *Run Daisy Effect* (⌃F5) and *Debug Daisy Effect*
(F5), plus *Build & Flash to Daisy Seed* in its dropdown.
- AC: contributed through the `editor/title/run` menu, so VS Code handles the ▶ / dropdown and
  remembers the last-used action. Not shown on other files or in non-Daisy workspaces.

**FR-TRN-4 — Daisy view in Run and Debug.** A native `TreeView` contributed to the Run and Debug
container (`views.debug`), shown when `ds-ide.isDaisyProject`:
- **Emulator** row: state (stopped / building / deploying / running / debugging / paused /
  build failed / crashed) with a themed icon and a detail line (e.g. `48 kHz · block 48`).
- **Source changed** row, shown while a session runs a build older than a saved edit, with a
  *Restart to apply* action.
- **Board** row: `Daisy Seed · DFU 0483:df11` or `none detected` (FR-TRN-7).
- View title actions: Run, Debug, Stop (while busy/running: Stop or Cancel), ⚡ Build & Flash,
  Refresh, Show Emulator Output. The build-for-hardware-only action is available from the view.
- AC: build / deploy / hardware work shows native progress on the view (`withProgress` with the
  view's `viewId`) in addition to today's cancellable notification.
- AC: follows the active VS Code theme, since it uses no webview and no hardcoded colours.

**FR-TRN-5 — Status bar: state + Flash only.** Today's single `Daisy` item becomes a clickable
state item, plus one ⚡ Flash item. Both are hidden outside Daisy projects.
- AC: the state item reads `Daisy: <state>`. On a build failure it uses `statusBarItem.errorBackground`
  and clicking opens Problems. After a crash it uses `statusBarItem.warningBackground` and clicking
  opens the Emulator output. Otherwise clicking reveals the Daisy view. The fidelity-caveat
  tooltip stays. `statusBar.command` is assigned (today it never is).
- AC: while the source is stale (FR-TRN-4), the state item says *restart to apply*.
- AC: the ⚡ Flash item shows `no board` when detection found none. Each item has its own id and
  name so users can hide them individually.
- AC: there is no status-bar Run / Stop button.

**FR-TRN-6 — Failures surface where the user looks.**
- AC: a failed build (run, debug or restart) shows an error notification "Build failed with N
  problems. Nothing was deployed." with *Show Problems*; the Daisy view and the state item show
  *build failed*; the errors are in Problems through the existing diagnostics path.
- AC: an emulator crash shows an error notification with *Show Output* and *Debug*; the view and
  the state item show *crashed*.

**FR-TRN-7 — Build & Flash with on-demand board detection.**
- AC: board detection runs `dfu-util -l` when the Daisy view becomes visible, on its Refresh
  action, and immediately before flashing. There is no background polling.
- AC: *Build & Flash* (view, status bar, editor-title dropdown) asks for modal confirmation
  naming the project and the detected board, then builds for hardware and flashes through the
  existing `buildHardware` / `flash` paths, with cancellable progress.
- AC: with no board detected, Flash shows a warning with the BOOT + RESET instructions and a
  *Retry*, and does not start a hardware build.
