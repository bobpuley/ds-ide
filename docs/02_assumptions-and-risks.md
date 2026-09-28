# 02 — Assumptions & Risks (v22)

> **All prior versions complete** — full bet/risk history in their respective archives.
> **v21 complete** — all v21 bets held; risks resolved or managed.
> Archived: [`docs/v21/02_assumptions-and-risks.md`](v21/02_assumptions-and-risks.md).

## Unified device interaction model (intake 2026-09-28)

### Bets

- **B1 — Everything the drag-time highlighting needs is already in the Wiring webview.**
  `PIN_DEFS` (data island), `REGISTRY` attachment shape, occupancy (`computePinOverlayStates`,
  `conflict-remedy.ts`), `allocateAdjacentPins`, `resolveBusFootprint`, and per-device colours
  already exist; the only missing input is a declarative pin requirement
  (`DeviceDescriptor.pinRequires`). If this holds, eligibility is computed generically for every
  registry device with no per-device branches.
- **B2 — Palette and board live in the same webview**, so the gesture is an in-page
  pointer-event drag, not HTML5 drag & drop across webview boundaries (which VS Code webviews
  do not support between views).
- **B3 — The peripheral's bus is still "source is the source of truth".** Dropping OLED on the
  SPI1 or I2C1 lane only selects which `declLine(bus)` variant is written — the existing
  `insertPeripheralIntoSource(source, id, bus)` path (FR-DEV-14) already takes a `bus`; today's
  checkbox just never passes one (always `busChoices[0]`). No new persisted state.

### Assumptions

> ⚠️ ASSUMPTION: The Wiring Editor's Activity Bar sidebar view is wide enough to host the device
> palette beside the 560×600 schematic. The collapsible palette (collapses to a colour-dot rail,
> still draggable) is the mitigation; to be verified during manual testing at typical sidebar
> widths.

> ⚠️ ASSUMPTION: Removing the Controls Editor's palette loses nothing users depend on — it is
> only rendered on the legacy YAML-mode canvas, and 3 of its 6 items are already a silent no-op
> (`palette-drag-drop.ts:24`). After removal, the Wiring Editor is the only place devices are
> added; the Controls Editor lays out already-wired controls only.

> ⚠️ ASSUMPTION: Pins on a bus's canonical lane (e.g. D7–D14) stay eligible for single-pin
> devices while no enabled peripheral owns that lane — unchanged from today's editor, where
> they are ordinary assignable GPIO.

> ⚠️ ASSUMPTION: Existing projects need no migration. Placed controls and enabled peripherals are
> read back from source exactly as today; only the gesture that writes them changes.

### Risks

- **R1 — Replace on conflict deletes the existing device's generated code.** It removes the
  occupant's marker-delimited declaration/init blocks. Mitigation: the conflict popover names
  exactly which device(s) will be removed; Cancel is always available; no automatic relocation
  (decided 2026-09-28 — nothing moves without the user doing it). The edit goes through
  `WorkspaceEdit`, so it stays in the editor's undo history.
- **R2 — "Reveal in code" depends on the generated marker ranges.** Hand-edited source can lose
  or corrupt a marker. The action must fail with a clear message rather than revealing the wrong
  range.
- ~~**R3 — "Show panel" needs open-state tracking that doesn't exist today.**~~ Resolved
  2026-09-28: the button has one fixed label, *Show panel*, and always reveals the panel (opening
  it if closed). No open-state tracking and no new `panelState` message are needed.
- **R4 — Regression of today's peripheral rendering.** The Peripherals footer (checkbox list +
  View button) is removed; bus brackets, pin tooltips and the micro-USB indicator (FR-DEV-12,
  FR-DEV-17) must keep rendering identically for projects that already have peripherals enabled.

## Transport actions on native VS Code surfaces (intake 2026-09-28, design_plan.md §5.5)

### Bets

- **B4 — Making Ctrl+F5 a real session gives the transport controls for free.** Once the `ds-ide`
  launch returns a live no-debug session instead of `undefined`, VS Code's floating debug toolbar
  provides ↻ Restart / ■ Stop, ⇧F5 / ⇧⌘F5 work, and "running" becomes a session state VS Code
  already tracks. No custom Run/Stop button has to be built.
- **B5 — Native surfaces cover the rest.** Editor-title ▶ with the Run/Debug dropdown
  (`editor/title/run` menu, supported by `engines.vscode ^1.85.0`), a view contributed to the
  Run and Debug container, `withProgress` for cancellable progress, and the existing Problems
  diagnostics for build errors. They match what C++ users already know and follow the VS Code
  theme without extra work.

### Assumptions

> ⚠️ ASSUMPTION: The `ds-ide` no-debug session can own the emulator's lifetime. Its inline
> adapter (today `DsIdeDebugAdapterDescriptorFactory`, which terminates immediately) stays alive
> while the emulator runs. A `disconnect`/`terminate` from ⇧F5 or the toolbar stops the emulator,
> and an emulator exit (normal or crash) ends the session.

> ⚠️ ASSUMPTION: Restart (↻ / ⇧⌘F5) re-runs the launch, including `resolveDebugConfiguration`'s
> build + deploy, so a restart always picks up saved source edits (decided: Restart = rebuild +
> redeploy). To be verified against VS Code's restart handling for a session whose adapter
> doesn't implement `restart`.

> ⚠️ ASSUMPTION: The status-bar colour during a no-debug run is whatever VS Code does for
> no-debug sessions (theme-controlled, not extension-controllable). Accepted as-is; observed and
> noted during implementation.

> ⚠️ ASSUMPTION: On-demand board detection (`dfu-util -l` when the Daisy view becomes visible,
> on its refresh action, and immediately before flashing) is fast enough (<1 s) not to make the
> view feel slow, and needs no background polling (decided 2026-09-28).

> ⚠️ ASSUMPTION: Build errors already reach the Problems panel through the existing diagnostics
> path (M4, `diagnostics` in `DeployCoordinator`), so the red "build failed" state only needs to
> point there, not re-implement parsing.

### Risks

- **R5 — Session/emulator lifecycle coupling.** Two lifetimes (VS Code session, emulator process)
  must end together in every order: user Stop, emulator crash, window reload, a second launch
  while one is running, and F5's existing hand-off to the separate `daisy-debug` attach session.
  An orphaned session or orphaned emulator is the failure mode. Mitigation: one owner
  (`EmulatorManager` events drive session termination), with tests for each ordering.
- **R6 — Visibility of the Daisy view.** It lives in the Run and Debug container (decided), so it
  is hidden whenever another sidebar is open. Mitigation: the status-bar state item and ⚡ Flash
  stay visible everywhere and link back to it; no status-bar Run button (decided).
- **R7 — Accidental flash.** ⚡ Flash sits in the always-visible status bar and overwrites the
  board's program. Mitigation: modal confirmation naming the project and target before building.
