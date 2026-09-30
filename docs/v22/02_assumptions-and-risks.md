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

## Extension views follow the IDE theme (intake 2026-09-29, M68)

### Bets

- **B6 — VS Code's own theme variables cover most of the work.** VS Code injects the active
  theme's colours into every webview as `--vscode-*` CSS variables and marks `<body>` with the
  theme kind (`vscode-light`, `vscode-dark`, `vscode-high-contrast`,
  `vscode-high-contrast-light`). Pointing the UI chrome of all five webviews at those variables
  makes it follow every theme, including user-installed ones, without a palette of our own.

### Assumptions

> ⚠️ ASSUMPTION: The `charts.*` colour tokens (`charts.blue`, `charts.red`, `charts.green`,
> `charts.yellow`, `charts.orange`, `charts.purple`, `charts.lines`, `charts.foreground`) have
> built-in defaults for every theme kind, so traces and grid stay visible even when a theme
> doesn't define them.

> ⚠️ ASSUMPTION: The hardware depictions (the Daisy board drawing, the illustrated device icons,
> the OLED glass) stay readable on light and high-contrast backgrounds once framed by a themed
> border. They are not re-coloured, because the real hardware looks the same in any theme
> (decided 2026-09-29).

> ⚠️ ASSUMPTION: Reading canvas colours from computed CSS once per theme change, not per frame,
> keeps the scope and spectrum at today's frame rate.

### Risks

- **R8 — Accent colours that lose contrast or become indistinguishable.** Ten device accents must
  each stay distinct from one another and readable on both light and dark editor backgrounds.
  Mitigation: every accent has a dark and a light variant in the registry, and a unit test checks
  each variant against the default Light+ / Dark+ editor background at WCAG 3:1. HC themes reuse
  the matching variant plus a contrast border.
- **R9 — Hardcoded colours creeping back.** With about 370 literals today, a new view or a quick
  fix can easily reintroduce one. Mitigation: a guard test fails on any hex / `rgb()` literal in
  webview code outside an explicit allow-list (accent palette, board art, device icons, OLED
  glass).
- **R10 — Stale canvases after a theme switch.** A stopped scope, or the Controls Editor canvas,
  doesn't redraw by itself, so it could keep the old theme's colours. Mitigation: every canvas
  view re-reads its colours and repaints when the body's theme class changes (decided
  2026-09-29: live update, no reopen).

## Controls Editor devices in the wiring-palette style (intake 2026-09-29, M69)

### Bets

- **B7 — One set of device art serves both editors.** The palette's illustrated icons can carry
  small class hooks on their moving parts (pot pointer, LED lens, button cap, toggle lever,
  encoder pointer, RGB segments) without changing how the palette looks, so the Controls Editor
  animates the same art instead of keeping a second, live copy.

### Assumptions

> ⚠️ ASSUMPTION: Scope is the six control kinds that have a card today: pot, button, LED,
> toggle, encoder, RGB LED. OLED, SD card, MIDI TRS and MIDI USB are excluded because they never
> get a Controls Editor card (decided 2026-09-29).

> ⚠️ ASSUMPTION: The illustrated art is drawn on a 48 × 48 grid; scaled up to a usable size
> (about 64 px) it stays sharp, and grabbing a knob or pressing a button on the art is as
> easy as on today's widgets.

> ⚠️ ASSUMPTION: Existing behaviour is unchanged: the drag handle, id label, pot drag and value
> readout, button press and release, toggle position cycling, encoder scroll, the running /
> stopped dimming, and the emulator IPC messages.

> ⚠️ ASSUMPTION: Live states use the art's own fixed colours (hardware depiction, FR-THM-4), and
> only the tile frame and accent underline follow the theme. The RGB LED shows the live colour
> from the emulator inside the art's lens.

### Risks

- **R11 — Two copies of the art drifting apart.** If the live widgets were separate SVGs, a
  palette icon edit would leave the Controls Editor stale. Mitigation: the palette and the
  Controls Editor read the same `DEVICE_ICONS` entries; a unit test checks that every control
  kind's art has the hooks its widget needs.
- **R12 — Regression of drag and press interactions.** The pot's `ns-resize` drag, the button's
  press-and-release and the toggle cycling are wired to today's elements. Mitigation: the
  interaction code keeps its handlers and only the elements they attach to change; a manual
  pass in all four themes covers each kind.
