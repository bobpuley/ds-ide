# 04 — Architecture (v22)

> **v21 complete** — full v21 architecture in
> [`docs/v21/04_architecture.md`](v21/04_architecture.md).

## Unified device interaction model (`FR-UDM-*`, M65–M66)

No new process, dependency or storage. All changes stay inside the Wiring Editor webview, its host
handler (`extension.ts` wiring handlers / `WiringViewProvider`), the device registry, and the
Controls Editor (removal only). Source code stays the single source of truth for what is placed
where (unchanged convention: `currentBusOf`, `buildOccupants`, marker blocks).

### Principle: the webview previews, the host decides

The webview computes drop targets and footprint previews for display only. The host still
allocates pins (`allocateAdjacentPins`) and checks conflicts (`checkConflict`) on every mutation,
as it does today. Both sides call the **same pure functions** from `src/wiring/` (the webview
bundle already imports `src/wiring/*` and `src/devices/registry`), so a preview always matches
the result. If the host rejects anyway (e.g. source changed underneath), it keeps today's
`formatRejection()` error path.

### Components

| Component | Change | Milestone |
|---|---|---|
| `src/devices/registry.ts` | `DeviceDescriptor.pinRequires?: 'adc' \| 'i2c' \| 'uart' \| 'spi' \| 'sdmmc'`; pot = `'adc'`. `pinSlots?: string[]` (Init() argument order): rgbled `R/G/B`, encoder `A/B/SW` — labels multi-pin pins in the popover (M65) and drag previews (M66) | M65 |
| `src/wiring/device-popover.ts` *(new, pure)* | `describePlacedDevice(target, wiredPins, peripherals)` → popover model (label, accent, id, pins/bus row, `showPanel`, remove message); `peripheralOwningPin()` | M65 |
| `src/wiring/pin-eligibility.ts` *(new, pure)* | `isPinEligible(pinDef, deviceId)` from `pinRequires` + `PIN_DEFS` | M65 |
| `src/wiring/wiring-panel.ts` | remove `pot-warn` special case; one `#device-popover` replaces `popup-assigned` + `#bus-popover` (M65); add palette markup, remove `#popup-assign` + `#peripherals` footer (M66) | M65 / M66 |
| `src/webview/wiring-webview.ts` | unified popover (M65); pointer-event drag, target repaint, lane/USB drop zones, cursor label, move-by-drag (M66) | M65 / M66 |
| `src/wiring/drop-targets.ts` *(new, pure)* | `computeDropTargets(deviceId, PIN_DEFS, occupancy, exclude?)` → targets `{ kind: 'pin' \| 'lane' \| 'usb', pins, bus?, conflicts[] }` built from `isPinEligible`, `allocateAdjacentPins`, `resolveBusFootprint`, `candidateBusesFor` | M66 |
| `src/sidebar/controls-editor-panel.ts`, `src/webview/controls/palette-drag-drop.ts` | palette + drag-drop removed; `palette-drag-drop.ts` deleted | M65 |
| `src/extension.ts` (wiring handlers) | `revealInCode` handler (M65); `bus` / `replace` / move handling (M66) | M65 / M66 |

### Message contract (`src/webview/messages.ts`, `WiringWebviewMessage`)

| Message | Change | Milestone |
|---|---|---|
| `{ command: 'revealInCode'; id: string }` | **new**: host opens the effect source, finds the device's marker range (`findMarkerRange`), then `revealRange` + selection; warns if not found | M65 |
| `viewPeripheral` | unchanged, now sent by the popover's *Show panel* (already reveal-or-open) | M65 |
| `setPeripheralEnabled` | gains optional `bus?: string` → passed to `insertPeripheralIntoSource` / `insertPeripheralInitIntoSource` (already `bus`-aware since FR-DEV-14) | M66 |
| `wirePin` | gains optional `replace?: string[]`: occupant ids removed **in the same `WorkspaceEdit`** as the add (FR-UDM-8, atomic, single undo step) | M66 |
| `{ command: 'moveControl'; id: string; pinNumber: number }` | **new**: host re-allocates from `pinNumber` excluding the control's own pins, rewrites its pins keeping its id, in one edit | M66 |
| `setPeripheralEnabled` with `replace?: string[]` | same atomic replace for peripheral drops | M66 |

Every new or extended message goes through the existing host-side validation (`hasKnownCommand`
+ exhaustive `switch` / `assertNever`, FR-IPC / M57 convention).

### Data flow — drop (M66)

```
palette pointerdown ─► computeDropTargets(dev) ─► repaint pins / lanes / USB
      pointermove    ─► hover target ─► footprint preview + cursor label
      pointerup on target ─► placement popover (id / bus from lane / conflict names)
             Add / Replace ─► postMessage wirePin | setPeripheralEnabled {bus, replace}
                              └► host: allocate + checkConflict + one WorkspaceEdit
                                 └► source changes ─► wiredPins / peripherals ─► webview re-render
```

### Unchanged

Bus-bracket rendering (FR-DEV-12), pin tooltips, micro-USB indicator (FR-DEV-17), codegen output,
`controllers.yaml` layout persistence, the OLED / MIDI panels themselves.

## Transport actions on native surfaces (`FR-TRN-*`, M67)

No new process or dependency. The change moves "is the effect running" from ad-hoc status-bar
text into two places VS Code already models: a **debug session** (for run as well as debug) and a
**TreeView**. One pure state model drives every surface.

### Components

| Component | Change |
|---|---|
| `src/debug/run-config-provider.ts` | `resolveDebugConfiguration`: for `noDebug`, build + deploy + start audio, then **return** the config (today: `undefined`) so a real `ds-ide` session starts. Debug path unchanged (hand-off to `daisy-debug` attach). |
| `src/debug/run-session-adapter.ts` *(new; replaces `DsIdeTerminatingAdapter` for `noDebug`)* | Inline DAP adapter that stays alive for a run. `disconnect`/`terminate` → stop the emulator. An emulator exit event → sends `terminated`. Declares no `supportsRestartRequest`, so VS Code's Restart = terminate + relaunch → `resolveDebugConfiguration` → rebuild + redeploy (FR-TRN-2). The terminating adapter stays as the safety net for the non-`noDebug` wrapper. |
| `src/transport/transport-state.ts` *(new, pure)* | `TransportState` = `{ phase: stopped \| building \| deploying \| running \| debugging \| paused \| buildFailed \| crashed, mode, problems?, stale, board? }` + a reducer over events (deploy started/failed/succeeded, session started/ended, emulator exited/crashed, source saved, board detected). Unit-tested, no `vscode` import. |
| `src/transport/transport-controller.ts` *(new)* | Subscribes to `DeployCoordinator`, `EmulatorManager`, `vscode.debug` session events and `onDidSaveTextDocument`, feeds the reducer, and re-renders the status items, the Daisy view and the context keys. **Replaces the 7 scattered `statusBar.text = …` writes in `extension.ts`.** |
| `src/views/daisy-view.ts` *(new)* | `TreeDataProvider` for `ds-ide.daisyView`: Emulator / Source changed / Board rows from `TransportState`; `ThemeIcon` + `ThemeColor` only (no webview). |
| `src/hardware/board-detect.ts` *(new)* | `parseDfuList(stdout)` (pure) + `detectBoard()` that runs `dfu-util -l` via the existing toolchain resolution (`src/hardware/toolchain.ts`). Called on view visibility, Refresh, and before flashing. No polling. |
| `src/extension.ts` | Second status item (⚡ Flash); state item gets `command`; new commands registered; status-bar writes delegated to `transport-controller`. |
| `package.json` | contributions below |

### Contributions (`package.json`)

- **Commands (new):** `ds-ide.runEffect` (→ `vscode.debug.startDebugging(folder, dsIdeConfig, { noDebug: true })`),
  `ds-ide.debugEffect` (→ same, debug), `ds-ide.buildAndFlash`, `ds-ide.refreshBoard`,
  `ds-ide.showEmulatorOutput`, `ds-ide.revealDaisyView`. Existing commands and keybindings unchanged.
- **`views.debug`:** `{ id: "ds-ide.daisyView", name: "Daisy", when: "ds-ide.isDaisyProject" }`.
- **`menus`** (none today):
  - `editor/title/run`: `runEffect`, `debugEffect`, `buildAndFlash`, `when` = `ds-ide.isDaisyProject && resourcePath == <effect source>` (exposed as a `ds-ide.isEffectSource` context key).
  - `view/title` for `ds-ide.daisyView`: Run / Debug / Stop / Flash / Refresh / Output, with visibility driven by a `ds-ide.transportPhase` context key.
- **Context keys (new):** `ds-ide.transportPhase`, `ds-ide.isEffectSource`.

### Data flow

```
⌃F5 / ▶ / view Run ─► startDebugging(noDebug) ─► resolveDebugConfiguration
     └► withProgress(notification + daisyView) ─► performDeploy(build) ─► start audio
          ├ fail ─► reducer: buildFailed ─► notification "Show Problems" · red state item
          └ ok   ─► return config ─► run-session-adapter (live) ─► toolbar Restart / Stop
emulator exit/crash ─► adapter sends terminated ─► reducer: stopped | crashed
save while running  ─► reducer: stale ─► "restart to apply" (view row + state item)
```

### Unchanged

The F5 debug hand-off (`daisy-debug` attach, `FilteringLldbDapAdapter`), `DeployCoordinator`,
`EmulatorManager`, the build diagnostics path into Problems, the `buildHardware` / `flash`
command implementations, and all existing keybindings.
