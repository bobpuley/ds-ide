# M45 — MicroSD & Bus-Peripheral UI

**Version:** 0.14.2
**Status:** in progress
**Source:** intake 2026-07-21 — device support expansion

## Goal

Land the first *bus-attached* peripheral and, with it, the UI vocabulary every later peripheral
depends on: a peripherals section in the Wiring Editor, bus groups drawn on the board as one
collapsed bracket, detail on demand through tooltip and popover, and conflicting actions refused
with a concrete remedy rather than applied and flagged. MicroSD is chosen to go first because its
emulation is genuinely cheap — FatFS mapped onto a workspace-relative host directory — so the
milestone's real weight sits in the UI rather than the shim, and samplers and looper projects
become testable as a side effect.

## Sprint Tasks

### [x] feat: add FatFS host shim (FR-DEV-10)

`SdCard` — the first bus-attached, zero-instance-id device: a fixed SDMMC1 footprint, enabled or
disabled rather than placed by clicking a pin, and no runtime `controlValue` traffic at all (no
live level a user twiddles). Its Init/mount codegen emits once when enabled, like the pot's shared
array but for a boolean rather than a count. `f_mount`/`f_open`/`f_read`/`f_write`/`f_lseek`/`f_close`
map onto host `stdio` rooted at a workspace-relative `./sdcard/` directory, per the scope the
assumptions doc already bounds (`02_assumptions-and-risks.md`) — `f_findfirst`/`f_mkfs`/raw disk
I/O are out of scope until a real project needs them.

**Affected files:** `src/devices/registry.ts`, `src/devices/codegen/sdcard.ts`, `src/devices/attachment.ts`, `emulator/shim/src/fatfs_host.cpp`, `emulator/shim/include/daisy/fatfs_host.h`

**DoD:**
- `sdcard` registry entry declares `attachmentKind: 'bus'`, resolving to the SDMMC1 pin footprint via `resolveBusFootprint` — no static pin list.
- Generated code emits an `SdmmcHandler`/FatFS mount call exactly once when the peripheral is enabled, and removes it cleanly when disabled (no per-instance id, unlike every prior device).
- `f_mount` creates `./sdcard/` (workspace-relative) if absent rather than failing.
- `f_open`/`f_read`/`f_write`/`f_lseek`/`f_close` operate against real files under `./sdcard/`, returning FatFS-shaped result codes on success and on a missing-file error.
- A path that would resolve outside `./sdcard/` (e.g. via `..`) is refused rather than followed.
- Unit tests cover: mount creates the directory, read/write round trip, seek, missing-file error code, and path-escape rejection.

---

### [x] feat: add Peripherals section to Wiring Editor (FR-DEV-11)

Bus peripherals are a second device category (`04_architecture.md`'s "wired controls vs bus
peripherals") with no prior UI: enabled/disabled and configured from a dedicated list rather than
placed by clicking a pin, and drawn on the board at the pins their selected bus resolves to.

**Affected files:** `src/wiring/wiring-panel.ts`, `src/webview/wiring-webview.ts`, `src/webview/messages.ts`, `src/sidebar/wiring-editor-panel.ts`, `src/extension.ts`, `src/wiring/peripheral-state.ts`, `src/wiring/peripheral-config.ts`

**DoD:**
- The Wiring Editor renders a "Peripherals" section listing every registry entry with `attachmentKind` `bus`/`connector` (today: just `sdcard`), each with an on/off control and its current pin footprint.
- Toggling a peripheral on regenerates its codegen (mount emitted); toggling off removes it.
- Enabled peripherals' resolved pins are tracked as occupied on the board (bracket rendering is the next task; this task supplies the occupancy data it draws from).
- Peripheral enabled/bus-selection state persists across a VS Code reload.
- Unit tests cover enable/disable round trip and the codegen emission/removal it drives.

---

### [x] feat: collapsed bus bracket rendering with tooltip and popover (FR-DEV-12)

A bus group renders as one bracket with one label, never one label per pin. Detail is on demand:
hovering a bus pin shows an unstructured tooltip (pin · signal · owner); clicking the bracket opens
a structured popover (pin map, bus choice, disable). Inline per-pin text stays reserved for what the
user named — system-assigned bus pins stay bare, per the labelling rule the architecture doc
generalises for future board faceplates too.

**Affected files:** `src/webview/wiring-webview.ts`, `src/wiring/wiring-panel.ts`, `src/wiring/bus-bracket.ts`

**DoD:**
- Each enabled bus peripheral draws as one bracket spanning its resolved pins, with one label — no per-pin id text for system-assigned pins.
- Hovering a bracket's pin shows a tooltip reading pin, signal name, and owning peripheral.
- Clicking a bracket opens a popover showing the full pin map (pin → signal) and a disable action; a peripheral with more than one candidate bus additionally shows the bus choice (wired to the next task's conflict check).
- Existing wired-control rendering (inline id label for pot/button/etc.) is unaffected.
- Unit tests cover the pure bracket-grouping reducer (contiguous resolved pins → one bracket per peripheral) and the tooltip/popover data shape it feeds.

---

### [ ] feat: reject pin conflicts with a concrete remedy (FR-DEV-13)

An action that would create a pin conflict — enabling a peripheral, switching its bus — is refused
before any state changes, never applied-and-flagged. The refusal names every blocking pin with its
signal and current owner. A peripheral blocker gets a one-click fix when an alternative bus clears
the conflict; a control blocker (a hand-wired pot/button/etc.) gets guidance only, since the editor
never relocates a hand-placed control automatically.

**Affected files:** `src/devices/attachment.ts`, `src/wiring/conflict-remedy.ts`, `src/sidebar/wiring-editor-panel.ts`, `src/webview/wiring-webview.ts`, `src/webview/messages.ts`

**DoD:**
- Enabling a peripheral or switching its bus is checked against `findConflicts` before any state mutation; a colliding action is refused, not applied with a warning afterward.
- The refusal message names every blocking pin, its signal, and its owner (control id or peripheral name).
- When a colliding peripheral has another bus with no collision, the refusal offers a one-click "move X to bus Y" remedy that performs the move.
- When the only blocker is a hand-wired control, the refusal offers guidance text and no automatic-relocation action.
- Unit tests cover: refusal content for a pin conflict and for a connector conflict, remedy generation when an alternative exists, absence of any remedy when none exists, and that a control blocker never receives an auto-fix action.
