# Changelog

All notable changes to ds-ide are documented here.
Versions follow [Semantic Versioning](https://semver.org/). Each entry maps to a sprint milestone.

## 0.24.6 — 2026-11-13

**README polish** *(FR-DOC-1 to FR-DOC-7, M87)*

- **FR-DOC-1** — The README opens with what Daisy IDE is, a visible preview notice and the platform scope (macOS, Apple Silicon only).
- **FR-DOC-2** — Real requirements, split into what the emulator needs (CMake 3.20 or later, Xcode Command Line Tools) and what only hardware needs (Arm toolchain, dfu-util, a board); installation shows the Marketplace pre-release route first. The README said CMake 3.19 while the build needs 3.20; a test now keeps them equal.
- **FR-DOC-3** — The quick start is built on the examples and **Run Daisy Effect**, with a second path through **Create New Effect Project**; the old Build, Deploy, Start Audio sequence is a note.
- **FR-DOC-4** — Features and editor sections describe what shipped: Scope and spectrum, input generators, record and replay, the full device set, MIDI, OLED and SD card panels, debugging with **Debug Daisy Effect**, hardware build and flash, and the three settings. A new Examples section links the five examples. The doc-command lint now accepts command titles containing `&`.
- **FR-DOC-5** — Known issues (the intermittent window close after opening a folder, with what to send; Deploy needing a build from the same session) and Limitations (Apple Silicon only, not cycle-accurate, hardware build needs a `Makefile`, OLED pixels only, encoder click).
- **FR-DOC-6** — A unit test fails when a README link or image points at a missing file, an image is not under `media/`, or an in-page anchor has no heading. The three README screenshots are refreshed.
- **FR-DOC-7** — Developer content moved to a new `CONTRIBUTING.md`; the README has a Feedback section pointing at the GitHub issues page and saying what to include.
- **Chore** — An example's emulated SD card (`examples/**/sdcard/`) is ignored by git and left out of the package.

## 0.24.5 — 2026-11-13

**Example curation** *(FR-EXM-1 to FR-EXM-9, M86)*

- **FR-EXM-1** — A project with no DaisySP of its own now builds against the extension's bundled `vendor/DaisySP`; a project's own copy still wins. A plain copy of a DaisySP example no longer fails with `'daisysp.h' file not found`.
- **FR-EXM-2** — The milestone-named demos are gone. `examples/` holds five meaningfully named, standalone examples, each with a README (what it shows, how to run it, what to try, what you learn): `tremolo-filter` (now also documents breakpoint debugging), `controls-tour`, `midi-synth`, `midi-synth-oled`, `controls-sd-logger`.
- **FR-EXM-3** — `controls-tour`: pot, button, toggle, LED, RGB LED and encoder in plain libDaisy, each wired to something you can hear or see.
- **FR-EXM-4 / FR-EXM-5** — `midi-synth` plays a DaisySP oscillator from the MIDI panel's keyboard with Control Change #1 selecting the waveform; `midi-synth-oled` adds an OLED that draws the selected waveform as a pixel shape.
- **FR-EXM-6** — `controls-sd-logger` logs every control action to `actions.txt` on the SD card, through a lock-free queue so the audio callback never touches the card. The FatFs host shim gains `f_sync`.
- **FR-EXM-7** — `examples/README.md` lists the examples in learning order, and a unit test fails when an example lacks a README, `CMakeLists.txt`, `controllers.yaml` or a `ds-ide:controls` block, has a milestone-style name, or is missing from the index.
- **FR-EXM-8** *(fix)* — The emulator now starts in the project folder, so its virtual SD card is `<project>/sdcard/` whichever way VS Code was launched. Before, the card landed in VS Code's working directory (or failed to mount when that was `/`), and the SD viewer, which reads `<project>/sdcard/`, never saw it.
- **FR-EXM-9** *(fix)* — The SD viewer follows the card: it refreshes about once a second while the card is enabled, re-reads an expanded file whose size changed, always re-reads on Refresh, and a long preview scrolls. Before, a preview was cached on first open and never updated.

## 0.24.4 — 2026-11-12

**First-run experience fixes** *(FR-REL-1 to FR-REL-3, M85)*

- **FR-REL-1** — The extension declares `capabilities.untrustedWorkspaces` (`supported: false`) with an explanation, so Restricted Mode shows why Daisy IDE is disabled instead of silently hiding the Controls/Wiring icons. The README quick start tells users to trust the folder.
- **FR-REL-2** — A missing CMake is detected (`which`, then `/opt/homebrew/bin` and `/usr/local/bin`) and reported as "CMake not found. Install it (brew install cmake) and try again." in the notification and the build output, instead of a bare "Build failed" with an empty Problems list.
- **FR-REL-3** — The extension activates when a folder containing a Daisy project (`*.cpp`, `src/*.cpp`, `source/*.cpp`) is opened, so Run Daisy Effect and the editor play button are available without first using another Daisy command.
- Packaging: `darwin-arm64` target, trimmed `.vscodeignore`, third-party notices for node-midi/RtMidi, repository and bugs URLs, Electron pin 43.7.3.

## 0.24.3 — 2026-10-03

**Input generators** *(FR-GEN-1 to FR-GEN-5, M76)*

- **FR-GEN-1** — The Scope's Input select is grouped: *Generators* (Sine, Noise, Log sweep, Impulse, Step, Silence, Two-tone) and *External* (Live mic, WAV). Sine stays the default; External entries behave as before.
- **FR-GEN-2** — Each generator has its own parameter row, shown only while it is selected, with a hint on Silence, Impulse, Step and Two-tone. Definitions, defaults (Amp 0.25) and clamping are a pure module (`scope-generators.ts`).
- **FR-GEN-3** — The emulator's `InputGenerator` renders every generator deterministically (fixed-seed noise, phase-continuous sweep, sample-exact Impulse/Step periods) with no allocation or lock on the audio thread, in simulated and real-time modes. Replay and WAV keep priority.
- **FR-GEN-4** — New `generator` IPC message, validated and range-clamped in the emulator; the host validates the new `audioSource` ids, remembers each generator's parameters for the session and re-sends them after a redeploy.
- **FR-GEN-5** — Selecting a generator leaves Time, Gain, Scale and Trigger as they are. Manual test cases added.
- **Fix** — `package.json` version is brought in line with the changelog (it was left at 0.24.1 by the 0.24.2 release).

## 0.24.2 — 2026-10-03

**Scope toolbar popovers** *(FR-SCI-15 to FR-SCI-17, M75)*

- **FR-SCI-15** — Gain, Scale, Trigger, frequency axis and level mode are one chip each showing only the current value, replacing the thirteen segmented buttons. Options, labels, defaults and the Trigger Edge/Source rule are a pure, unit-tested model (`scope-chips.ts`).
- **FR-SCI-16** — Clicking a chip opens an opaque popover (theme dropdown colours) that flips above when it would leave the viewport. Active entry shows ✓; Trigger has Edge and Source groups, Source disabled while Free, and stays open after an edge pick. Esc, click outside and pick close it; ↑/↓/Enter work; ARIA `menu` / `menuitemradio`. Manual test cases added.
- **FR-SCI-17** — A chip not at its default shows its value in the warning colour with a `●`, and its accessible name ends with "(changed from default)".

## 0.24.1 — 2026-10-02

**Editor polish** *(FR-WLG-1, FR-CEH-1 to FR-CEH-4, M74)*

- **FR-WLG-1** — The Wiring Editor has a collapsible legend under the hint line: free pin, free ADC input (with its A-label), one entry per wired device colour, bus peripheral pin, and power / non-assignable. Swatches reuse the pins' own classes, so they cannot drift from the board.
- **FR-CEH-1** — The play/stop marker is removed from the Controls Editor header; cards still dim while the emulator is stopped.
- **FR-CEH-2 / 3 / 4** — Three icon-only header buttons (tooltip and `aria-label` carry the name): *Align to grid* (20 px), *Auto-arrange* (rows in controls-block order, wrapping at the panel width, row pitch grown to the tallest card) and *Reset positions* (the default cascade, now shared with the first render). They save through auto-save and are disabled in the legacy yaml-only mode.
- **FR-SCI-7** — Scope toolbar: the cursor read-out is now an overlay on the plot, so hovering no longer wraps the toolbar onto a second row; text and icon buttons share one height and an 11 px font; unselected buttons get a more visible border (`--ds-control-border`), so they no longer look smaller than the selected one.
- **FR-SCI-4** — New 20 ms/div time base; the capture ring grows from 150 ms to 300 ms (the widest window plus 100 ms of trigger headroom). Slower bases are deferred: they need a larger circular ring and a roll mode.
- **chore** — `package.json`'s `version` is bumped to `0.24.1`.

## 0.24.0 — 2026-10-01

**Reachability** *(FR-RCH-1 to FR-RCH-5, M73)*

- **FR-RCH-1** — New commands `Show Scope`, `Show OLED Display`, `Show MIDI Panel`, `Focus Controls Editor` and `Focus Wiring Editor` reopen any surface without a build or deploy. Show Scope with no emulator running opens the idle panel.
- **FR-RCH-2** — The Daisy view is now visible in every workspace; outside a Daisy project it shows a *Create New Effect Project* button. The Controls Editor's empty canvas has an *Open Wiring Editor* button. (`viewsWelcome` only renders in tree views, so the Controls and Wiring webviews do not use it.)
- **FR-RCH-3** — A "Get started with Daisy Seed" walkthrough: create a project, wire a pin, run it, watch and tune.
- **FR-RCH-4** — `scripts/check-doc-commands.js` (run by `npm run lint`) fails when `README.md` or a walkthrough step names a command that is not in `package.json`. The README's stale "Open Wiring Editor" and click-a-pin text is corrected.
- **FR-RCH-5** — The Controls Editor saves its layout about 500 ms after a drag ends or a field is committed; the 💾 layout button is removed. A drag that starts while a save is pending cancels it, and a pending save is flushed when the view is hidden.
- **chore** — `package.json`'s `version` is bumped to `0.24.0` (it was left at 0.22.0 by the 0.23.0 release).

## 0.23.0 — 2026-09-30

**Scope instrument — emulator capture** *(FR-SCI-14, M72)*

- **FR-SCI-14a** — `ScopeCapture` (`emulator/runtime/scope_capture.h`): a full-rate ring (16384 frames per channel) with an edge-trigger scan on In or Out L, returning a 4096-frame window with the trigger at frame 1024. Unit-tested standalone under ASan/UBSan.
- **FR-SCI-14b** — The emulator's non-real-time drain thread feeds the ring and answers a `scopeCapture` arm/cancel request with one `scope_capture` message; the real-time callback is unchanged.
- **FR-SCI-14c** — The host validates and forwards `scope_capture` to the Scope webview, and validates the webview's arm/cancel request before sending it to the emulator.
- **FR-SCI-14d** — With a Rising / Falling trigger, 1× Single now captures the window at full rate and freezes on its trigger point, so short transients are caught; a time base too fine for the decimated stream draws full-rate windows (about 5 requests per second). Free-run single-shot stays best effort.
- Scope toolbar: the snapshot and CSV buttons are grouped, the 1× Single label no longer changes while armed, and Freeze / 1× Single are disabled — and reset — while audio is stopped.

## 0.22.0 — 2026-09-30

**Scope instrument — analysis** *(FR-SCI-9 to FR-SCI-13, M71)*

- **FR-SCI-9** — Edge trigger: Free / rising / falling on In or Out L, with a level marker on the amplitude axis that can be dragged. A periodic wave is drawn from the same phase every frame and stands still. The plot starts at the latest crossing that leaves a full window, so it shows current data. When nothing crosses the level it shows "no trigger — waiting…" and keeps the last triggered frame.
- **FR-SCI-10** — 1× Single arms the trigger and freezes the display on the next triggered capture; pressing it again resumes and re-arms, Freeze / Space cancels it. Best effort: a short transient between two scope snapshots can be missed until emulator-side capture (M72).
- **FR-SCI-11** — The spectrum has Lin / Log frequency and Relative / Absolute dBFS, with labelled Hz and dB axes (Log and Absolute by default). Absolute mode no longer renormalises to the running peak, and corrects the Hann window gain so a full-scale sine reads 0 dBFS.
- **FR-SCI-12** — Two icon buttons at the end of the toolbar: Snapshot saves a PNG of the scope and spectrum, and CSV saves the visible samples (time in ms, one column per visible channel), both through a save dialog. The host validates the payload (PNG signature, size limits).
- **FR-SCI-13** — The events strip is backed by a timestamped log of up to 200 events (CLIP, DENORMAL, xruns, other emulator events); repeats within a second fold into one entry with a count. Click "history" to expand it; it survives a stop.
- **Toolbar polish** (from manual testing) — Freeze / 1× Single use the same compact style as the segmented controls, and Freeze reads "Resume" while frozen. FROZEN is drawn on the plot next to the gain label instead of as a badge in the toolbar.

## 0.21.0 — 2026-09-30

**Scope instrument — display** *(FR-SCI-1 to FR-SCI-8, M70)*

- **FR-SCI-2** — The `scope` IPC message carries `out_r` (the right output channel, already emitted by the emulator but dropped by the extension) and `step` (the emulator's decimation factor). Both are optional, so an older emulator still works; a malformed value is dropped without rejecting the snapshot.
- **FR-SCI-3** — The Scope stitches consecutive snapshots into a capture ring of about 150 ms, so the usable window no longer depends on the block size (one snapshot is only about 2.75 ms at a 4-frame block). The ring clears on a stop, a sample-rate or block-size change, and a decimation change.
- **FR-SCI-4** — Labelled axes: time in ms and amplitude values, with a 0.5 / 1 / 2 / 5 / 10 ms-per-division selector. The effective sample rate is shown, and a time base with fewer than 20 points per division is flagged as low resolution.
- **FR-SCI-5** — Gain ×1 / ×2 / ×4 / Auto (Auto fits the visible peak, capped at ×64) and a Linear / dBFS amplitude scale. A quiet signal is no longer a flat line.
- **FR-SCI-6** — In, Out L and Out R are drawn with solid, dashed and dotted lines, so colour is not the only cue. The legend toggles each trace. New `--ds-trace-out-r` theme token.
- **FR-SCI-7** — Freeze / Resume (button or Space) holds the display while the capture keeps collecting. Hovering the scope shows a cursor with the time and each visible channel's value.
- **FR-SCI-8** — Meters column with peak, RMS, peak hold, a latching CLIP indicator per channel, headroom, and Reset peaks.
- **FR-SCI-1** — Layout confirmed in `docs/mockups/v22-scope-instrument.html`: spectrum below the scope, meters as a right-hand column, CSV-only export and the event history in the Scope panel for M71.
- `tests/runtime/test_bypass.py` now also checks `out_r` and `step` on every scope frame.

## 0.20.5 — 2026-09-30

**Emulator shutdown and record / replay fixes** *(FR-EMU-1, FR-EMU-11)*

- **FR-EMU-11** — Stopping the emulator no longer aborts with `libc++abi: terminating due to uncaught exception of type std::system_error: mutex lock failed: Invalid argument`. The shutdown watcher ended with `std::exit(0)`, whose static destructors destroyed the global emulator state's mutexes while the effect thread was still locking them (for example, an effect polling MIDI). It now flushes stdio and ends with `std::_Exit(0)` after the joins and telemetry flush. A regression test (`test_shutdown_flush.py`, fixture `shutdown_stress.cpp`) stops a busy effect 30 times with audio running.
- **FR-EMU-1** — Replay is no longer cancelled by a config change. With a real audio output device, the config a client sends just before `replayStart` restarted the simulated loop, which cancelled the replay and let the sine generator take over. Replay is now cancelled only when leaving simulated mode or shutting down.
- **FR-EMU-1** — `.dsrec` version 2: each `AUDIO_BLOCK` record carries its own frame count. Version 1 assumed every block was the header's block size, which is wrong whenever the audio device delivers a different or varying callback size, so replay decoded a misaligned stream. `SessionPlayer` now replays one continuous frame stream, independent of recorded and requested block sizes, with all-or-nothing pops so a slow reader can't insert silence. Version 1 files still play.
- `test_recording.py` (record, replay, compare levels) passes again on machines with an audio device: replay within 0.01% of live.

---

## 0.20.4 — 2026-09-29

**M69 — Controls Editor Devices in the Wiring-Palette Style** *(FR-CWS-1–FR-CWS-3 — DoD green)*

- **FR-CWS-1** — The palette's device art (`device-icons.ts`) exposes `data-part` hooks on the moving parts of the six control kinds (pot / encoder pointer, button cap, toggle lever, LED lens and glow, RGB LED lens). The palette looks identical: a test hashes the art with the hooks stripped against the shipped art. `deviceIconSvg(…, { live: true })` marks the art for card sizing.
- **FR-CWS-2** — Controls Editor cards render that same art as live widgets (`device-widget.ts`). State is applied as CSS variables on the widget root (pot angle, encoder detent, toggle position, RGB `color(srgb …)`), so the SVG is never rebuilt; the button cap presses and the LED glows through state attributes and classes. Existing handlers and IPC messages are unchanged. The M68 arc knob and its geometry (`knob-svg.ts`, `knob-math.ts`) are removed.
- **FR-CWS-3** — Cards use the palette tile frame: themed border and background, rounded corners, and an accent underline from `--ds-accent-<id>`, with a contrast border in high-contrast themes. The layout and state visuals were confirmed in `docs/mockups/v22-control-widgets.html`.
- Fix — `package.json` was left at 0.20.2 by the 0.20.3 release commit; it is now 0.20.4.

---

## 0.20.3 — 2026-09-29

**M68 — Extension Views Follow the IDE Theme** *(FR-THM-1–FR-THM-6 — DoD green)*

- **FR-THM-1** — All five webviews (Scope, OLED, MIDI, Controls Editor, Wiring Editor) take their chrome from one shared `--ds-*` layer (`src/webview/theme/theme-css.ts`) that aliases VS Code's `--vscode-*` tokens, so Light+, Dark+ and both high-contrast themes render correctly. Editor panels use the editor background, sidebar views the sidebar's; high-contrast kinds get a contrast border and visible focus. The token map and accent variants were confirmed in `docs/mockups/v22-themes.html`.
- **FR-THM-2** — Scope and spectrum traces, grid, axis labels, the running / stopped indicator and the MIDI monitor / keyboard highlights use VS Code chart and status tokens (`scope-colors.ts`).
- **FR-THM-3** — `DeviceDescriptor.accentColor` becomes `accent: { dark, light }` (type-checked); views read `var(--ds-accent-<id>)`. Every variant is unit-tested for WCAG 3:1 against `#ffffff` / `#1e1e1e`.
- **FR-THM-4** — The board drawing (`board-art.ts`), device icons (on a fixed plate) and OLED glass keep their colours inside themed frames.
- **FR-THM-5** — Live theme switching: `onThemeChange()` (`theme-runtime.ts`) repaints the scope and spectrum canvases, even when stopped; the Controls Editor knobs and encoder are CSS-variable SVG (`knob-svg.ts`) and follow automatically.
- **FR-THM-6** — `no-hardcoded-colours.test.ts` fails, naming file and line, on any hex / `rgb()` / `hsl()` literal in `src/webview`, `src/sidebar` or `src/wiring` outside the board art and device icons.
- Fix (manual test) — the virtual button, toggle and LED widgets in the Controls Editor were invisible on the card; they now have solid accent outlines.

---

## 0.20.2 — 2026-09-29

**M67 — Stateful Transport on Native Surfaces** *(FR-TRN-1–FR-TRN-7 — DoD green)*

- **FR-TRN-1** — Ctrl+F5 ("Run Without Debugging") is now a real `ds-ide` session. `resolveDebugConfiguration` builds, deploys and returns the config, and the new inline `RunSessionAdapter` (`src/debug/run-session-adapter.ts`) keeps the session alive while the emulator runs. VS Code's toolbar gives Restart / Stop, and ■ / ⇧F5 stop the emulator. Session and emulator are tied together by PID, so neither outlives the other on a user stop, a crash, a window reload or a second launch. `EmulatorManager` gains `stop()` and an `exit` event (`{ pid, crashed }`). This works without a `launch.json`: the default `ds-ide` config is filled in. All granular commands and keybindings are unchanged.
- **FR-TRN-2** — ↻ Restart / ⇧⌘F5 rebuilds and redeploys in the same mode. VS Code relaunches a session with its already-resolved config, so each resolved config carries a one-time `__dsIdeLaunchId`, and a relaunch with a consumed id makes the adapter rebuild + redeploy itself (a Stop mid-rebuild cancels it). F5 now keeps the `ds-ide` session live too and attaches `daisy-debug` as its child (`lifecycleManagedByParent`), so the debug toolbar's ↻ / ■ reach it. `DsIdeTerminatingAdapter` is removed. Stopping a debug session kills the emulator with SIGKILL, so lldb no longer pauses it in the shim. Decision recorded in the milestone file (user-approved 2026-09-29).
- **FR-TRN-3** — An editor-title ▶ on the project's effect source (`editor/title/run`): *Run Daisy Effect* (⌃F5), *Debug Daisy Effect* (F5), and *Build & Flash to Daisy Seed* in the dropdown. It is gated by the new `ds-ide.isEffectSource` context key. `buildForHardware` now reports success, so Build & Flash stops after a failed build.
- **FR-TRN-4** — A native **Daisy** `TreeView` in the Run and Debug container (`ds-ide.daisyView`) has Emulator (state + audio detail), Source changed (*restart to apply*) and Board rows, drawn with `ThemeIcon` / `ThemeColor` only. Its title actions switch with the `ds-ide.transportPhase` context key (Run / Debug, Stop, or Cancel), plus ⚡ Build & Flash, Refresh, Show Emulator Output, and Build for Hardware in the overflow menu. Build / deploy / hardware work shows progress on the view as well as in the notification. There is one pure `TransportState` reducer (`src/transport/transport-state.ts`), and `TransportController` (`src/transport/transport-controller.ts`) feeds it from deploy steps, debug sessions, lldb pause/resume, saves and emulator exits.
- **FR-TRN-5** — The status bar is two items rendered from the transport state (`src/transport/status-items.ts`). The first is `Daisy: <state>`: red with Problems on click after a failed build, amber with the Emulator output after a crash, otherwise it reveals the Daisy view, and it says *restart to apply* when the source is stale. The second is ⚡ Flash (*no board* when none is detected). Each has its own id and name, both are hidden outside Daisy projects, and all 7 direct `statusBar.text` writes in `extension.ts` are gone.
- **FR-TRN-6** — A failed build on the run, debug or restart path shows one notification, "Build failed with N problems. Nothing was deployed.", with *Show Problems*. The generic build toast is suppressed there, but the non-portable-symbol hint is kept. A crash (process exit or unexpected IPC disconnect) shows one notification with *Show Output* / *Debug*.
- **FR-TRN-7** — On-demand board detection (`src/hardware/board-detect.ts`) parses `dfu-util -l` and runs when the Daisy view becomes visible, on Refresh, and before flashing. There is no polling. *Build & Flash* asks for a modal confirmation naming the project and board, then builds and flashes with cancellable progress. With no board it shows a BOOT + RESET warning with *Retry*, and no hardware build starts.
- **chore** — `package.json`'s `version` is bumped to `0.20.2`. The vscode test mock gains tree-view / theme types, and `showErrorMessage` now returns a Thenable like the real API.

---

## 0.20.1 — 2026-09-28

**M66 — Unified Device Model (Drag & Drop)** *(FR-UDM-5–FR-UDM-10 — DoD green)*

- **FR-UDM-5** — The Wiring Editor has one device palette, generated from `REGISTRY` and grouped *Controls* / *Peripherals · one each*. Each device is an icon tile (illustrated icons from `docs/mockups/v22-palette_alt2.html`, new `src/wiring/device-icons.ts`, with an accent-dot fallback for devices without one) showing its name, its attachment requirement (e.g. "ADC pin", "3 pins (R·G·B)", "SPI1 / I2C1") and its registry accent colour. The palette collapses to a rail of small icons that can still be dragged and are named by the editor tooltip. The collapsed state is remembered. A placed peripheral is faded with a ✓.
- **FR-UDM-6** — New pure `computeDropTargets(deviceId, PIN_DEFS, occupancy, exclude?)` in `src/wiring/drop-targets.ts`: eligible pins for single-pin devices (excluding enabled peripheral lanes), allocatable start pins for multi-pin devices, one lane per candidate bus, and the micro-USB port for INTERNAL, each naming the occupants a drop would displace. Picking up a device repaints the board: free targets pulse in the device colour, occupied targets are amber-hatched with ⚠, and everything else dims. Bus devices get dashed drop lanes. Hovering a target previews its exact footprint with slot labels (R/G/B, A/B/SW). A label follows the cursor, and Esc or an off-target release cancels. The host now allocates multi-pin footprints through the same function, so the pins written always match the preview.
- **FR-UDM-7** — Dropping on a free target opens a placement popover: the pins (with slot names) or the dropped-on bus, an id field for controls (pre-filled by `defaultId`, validated by `validateId`), and **Add** / **Cancel**. `setPeripheralEnabled` gains an optional `bus`, so the lane dropped on is the bus choice (no dropdown). Generated code is identical to the old click-a-pin / checkbox paths (new pure `peripheralEditText`).
- **FR-UDM-8** — Dropping on an occupied target opens the popover in conflict mode, naming every device that would be removed, with **Replace** / **Cancel**. `wirePin` and `setPeripheralEnabled` gain an optional `replace: string[]`. The host removes those occupants (new pure `removeOccupantsFromSource`) and adds the new device in one `WorkspaceEdit` (a single undo step). It still runs `checkConflict` afterwards and falls back to `formatRejection()` if the source changed underneath.
- **FR-UDM-9** — Dragging a placed control off one of its pins moves it (its own pins count as free), via the new `moveControl { id, pinNumber, replace? }` message: the id and kind are kept and the change is one edit. Dragging a placed peripheral's tile moves it to another candidate bus. Cancelling a move leaves the device where it was. Architecture updated: `moveControl` gained the optional `replace` (decision 2026-09-28).
- **FR-UDM-10** — Free pins are grey and inert (no pointer cursor, hover highlight or click action; ADC pins keep their A-labels). The click-a-free-pin assign popup (`#popup-assign`) and the Peripherals footer (checkbox list + View button) are removed. Bus brackets, pin tooltips and the micro-USB indicator are unchanged.
- **chore** — `package.json`'s `version` field is bumped to `0.20.1` to match this entry. Milestone task IDs FR-UDM-6 were split into FR-UDM-6a / FR-UDM-6b. Added `docs/mockups/v22-unified-device-model_alt1.html` (the palette restyle's evaluation mockup).

---

## 0.20.0 — 2026-09-28

**M65 — Unified Device Model (Foundation)** *(FR-UDM-1–FR-UDM-4 — DoD green)*

- **FR-UDM-1** — `DeviceDescriptor` gains a declarative `pinRequires?: 'adc' | 'i2c' | 'uart' | 'spi' | 'sdmmc'` (pot declares `'adc'`), and a new pure `isPinEligible(pinDef, deviceId)` in `src/wiring/pin-eligibility.ts` derives pin suitability from it plus `PIN_DEFS`. The hardcoded `pot-warn` badge is gone; the Wiring Editor's assign popup shows a generic per-device requirement warning driven by `isPinEligible`.
- **FR-UDM-2** — Removed the Controls Editor palette (`paletteItemsHtml()`, `paletteCssRules()`, `#palette`, `palette-drag-drop.ts`, `addNewControl`), which silently ignored Toggle / RGB LED / Encoder drops. The empty-canvas hint now points to the Wiring Editor; control layout and position persistence are unchanged.
- **FR-UDM-3** — One `#device-popover` for every placed device (a control's pin, a peripheral's bracket or pin, or the micro-USB port for MIDI USB on INTERNAL), replacing `popup-assigned` and `#bus-popover`. It shows the accent dot, label, id, and the pins (with slot names, e.g. `R=D20 G=D21 B=D22`) or the bus and its resolved pins, plus **Show panel** (live-view devices only), **Reveal in code** and **Remove**. The popover content comes from a new pure `src/wiring/device-popover.ts`; the registry gains `pinSlots` (rgbled R/G/B, encoder A/B/SW).
- **FR-UDM-4** — New `revealInCode` Wiring webview message (validated host-side). The host opens the effect source and selects the device's declaration inside its marker block, for controls and bus/connector peripherals. If the markers are missing or corrupted, it shows a warning naming the device instead of revealing a wrong range.
- **chore** — `package.json`'s `version` field is bumped to `0.20.0` to match this entry.

---

## 0.19.2 — 2026-08-30

**M64 — Functional/E2E Test Layer (Foundation)** *(FR-TEST-2 — DoD green)*

- **FR-TEST-2** — Added a real-extension-host integration test layer alongside vitest's mocked-`vscode`-module unit suite, using the standard `@vscode/test-cli` + `@vscode/test-electron` harness (`tsconfig.e2e.json`, `.vscode-test.mjs`, new `npm run test:e2e` script — separate and opt-in, not wired into `test`/`lint`). Three specs: (1) a smoke test asserting the extension activates and every `package.json`-contributed command is registered; (2) `build-commands.test.ts`, invoking "Daisy IDE: Build for Emulator" and "Daisy IDE: Build for Hardware" through the real `vscode.commands` API against a fixture effect project, with `child_process.spawn` stubbed at the process boundary so no real toolchain/cmake ever runs; (3) `ipc-roundtrip.test.ts`, connecting a real `IpcClient` to a real Unix socket and asserting a `midiRx` message survives the real `parseIpcMessage()` narrower — verified to reproduce and catch the exact M62 regression when temporarily reverted.
- Documented the new test layer in `README.md`.
- **chore** — `package.json`'s `version` field is bumped to `0.19.2` to match this entry.

---

## 0.19.1 — 2026-08-30

**M63 — Manual Test Tracker** *(FR-TEST-1 — DoD green)*

- **FR-TEST-1** — Added `src/test/manual/manual-tests.html`, a standalone hand-edited page (no build step) listing 16 manual test cases covering ds-ide's hard-to-unit-test areas: emulator run loop timing, on-screen pot → ADC → scope, breakpoint time-freeze, NaN/clipping flagging, live audio I/O, hardware build parity, DFU flash, hardware variant prompt/persistence, memory-budget alerting, Controls/Wiring editor round-trips, MIDI, OLED, session recording, SD card viewer, and scope/spectrum tracking. Each entry has a title, description, steps, expected result, and a `pending`/`success`/`fail` status `<select>` that recolors the entry (badge + block, green/red) via one minimal inline script — visual-only, not persisted beyond whatever `selected` option is saved in the file. A page-top summary line tallies pending/success/fail counts live.
- Backported the original MIDI I/O surface requirement (FR-DEV-18) into `docs/03_requirements.md`, which v21 planning had left empty.
- **chore** — `package.json`'s `version` field is bumped to `0.19.1` to match this entry.

---

## 0.19.0 — 2026-08-30

**M62 — MIDI Monitor IPC Schema Fix** *(FR-DEV-18 — DoD green)*

- **FR-DEV-18** — The MIDI message monitor never showed any MIDI traffic: the emulator correctly emitted `midiRx`/`midiTx` IPC messages and the webview panel (`src/webview/midi-panel.ts`) already had working consumer code, but `src/ipc/narrow.ts`'s schema-validation whitelist (FR-IPC-2) had no narrower for either message type, so `IpcClient` silently dropped every one. Added `midiRx` and `midiTx` entries to `NARROWERS`, each requiring numeric `status`, `data1`, `data2`, `channel`, and `midiType` fields, matching the existing `led`/`rgbLed` narrower style. Sending MIDI events into a test effect (e.g. `tremolo-filter-midi`) no longer logs `dropped IPC message failing schema validation`, and events now appear live in the MIDI monitor panel.
- **chore** — `package.json`'s `version` field is bumped to `0.19.0` to match this entry.

---

## 0.18.1 — 2026-08-29

**M61 — Hardware Memory-Budget Alerting** *(FR-HW-5 — DoD green)*

- **FR-HW-5** — `buildForHardware()` already streamed the real arm-none-eabi linker's post-link memory-region table on every hardware build, but discarded it unparsed, and a genuine linker region-overflow failure was silently reduced to a generic "make exited with code N" since it didn't match the existing compiler-diagnostic regex. A new `src/diagnostics/memory-region-diagnostics.ts` parser turns that table into structured per-region usage, and extracts overflow errors (with a lower-confidence fallback when the precise `ld` wording doesn't match). A hardware build now: names the overflowing region and byte count on failure; prints the full usage table and warns when any region is ≥75% used on success; and hard-errors on any SDRAM usage when a new `ds-ide.hardwareVariant` setting (`'base' | '65mb-sdram'`, default `'base'`, resource-scoped) is `'base'`, since the linker's `SDRAM:` region size is a fixed 64 MB constant that can't reflect whether the connected board actually has that chip. The Effect Project Wizard prompts for hardware variant at project-creation time and writes it into the new project's `.vscode/settings.json`; `buildForHardware()` prompts once for any project where the setting has never been explicitly set, persisting the answer (declining defaults to `'base'` for that build only, without persisting, so it asks again next time). `APP_TYPE` auto-escalation (Makefile write, bootloader detection, DFU address rework) remains explicitly out of scope, deferred as a separate future idea.
- **chore** — `package.json`'s `version` field is bumped to `0.18.1` to match this entry.

---

## 0.18.0 — 2026-08-28

**M60 — Wizard-Time DaisySP Provisioning** *(FR-PKG-3 — DoD green)*

- **FR-PKG-3** — New effect projects failed to build until the user manually created a symlink to a DaisySP checkout elsewhere on disk, despite the Effect Project Wizard's own generated template already requiring `daisysp.h`. ds-ide now vendors a pinned DaisySP copy (tag `V1.0.0`) as a git submodule (`vendor/DaisySP/`), bundled into the packaged `.vsix` (`.vscodeignore`, `scripts/verify-vsix.sh`), and `createEffectProject()` copies — not symlinks — that vendored `Source/` into every new project at `DaisySP/Source`, so `Daisy IDE: Build for Emulator` just works with no manual setup. Only DaisySP's own MIT-licensed `Source/` and `LICENSE` are bundled; its separately-licensed (LGPL) `DaisySP-LGPL` companion submodule is never initialized or vendored. The generated `README.md` now notes that `DaisySP/` should be committed to the project's own version control so collaborators and CI build against the same pinned copy. `LICENSES.md` updated accordingly.
- **chore** — `package.json`'s `version` field is bumped to `0.18.0` to match this entry.

---

## 0.17.7 — 2026-08-27

**M59 — Stale Build-Cache Self-Heal** *(FR-PKG-2 — DoD green)*

- **FR-PKG-2** — Building a project after switching contexts (dev-host checkout to installed extension, or across an extension version upgrade touching `emulator/CMakeLists.txt`) failed outright with a raw CMake "source ... does not match the source ... used to generate cache" error, requiring the user to manually find and delete `<project>/.ds-ide/build/`. `EmulatorManager.build()` (`src/emulator/manager.ts`) now checks the existing `CMakeCache.txt`'s `CMAKE_HOME_DIRECTORY` against the current `emulatorSrc` before configuring, and automatically wipes and reconfigures the stale build directory on mismatch — no confirmation prompt, no manual cleanup. A cache that already matches the current source is left untouched, preserving incremental-build performance.
- **chore** — `package.json`'s `version` field is bumped to `0.17.7` to match this entry.

---

## 0.17.6 — 2026-08-26

**M58 — Debug-Attach Detach Noise Fix** *(FR-UX-7 — DoD green)*

- **FR-UX-7** — Stopping a `daisy-debug` attach session surfaced a spurious `Exception has occurred: signal SIGSTOP` in the Debug Console — a benign artifact of lldb-dap's own PID-attach/detach mechanics (confirmed via code inspection and upstream LLDB issue history), not a real fault, but easily mistaken for a crash. `DaisyDebugAdapterFactory` now returns a filtering inline adapter (`FilteringLldbDapAdapter`) instead of a direct `DebugAdapterExecutable` passthrough — it proxies lldb-dap's stdio directly and drops only the one `stopped`/`exception` event referencing `SIGSTOP`, relaying every other DAP message (including real exceptions and breakpoint stops) unchanged.
- **chore** — `package.json`'s `version` field is bumped to `0.17.6` to match this entry.

---

## 0.17.5 — 2026-08-25

**M57 — Extension API, Type & Maintainability Polish** *(FR-EXT-27 .. FR-EXT-39 — DoD green)*

- **FR-EXT-27** — Five webview-context files each redeclared the same `el<T>()` DOM-lookup helper, casting away `document.getElementById`'s `| null` return without checking it. A single shared `src/webview/dom-lookup.ts` now throws a descriptive error on a null lookup instead of silently returning `null` typed as non-null.
- **FR-EXT-28** — Data embedded into `<script type="application/json">` data islands (`controls-webview.ts`, `wiring-webview.ts`) was `JSON.parse`'d and cast with no runtime shape check, so malformed JSON crashed webview module init outright. A new `src/webview/data-island.ts` validates parsed content against a light shape check before casting, falling back with a visible in-page error banner instead of silently defaulting to `{}`/`[]`.
- **FR-EXT-29** — `controls-writer.ts`'s `removeFromSource` used optional chaining on a `REGISTRY[kind]` lookup while every other call site in the file used a non-null assertion. All call sites now consistently use `!`, backed by a documented invariant (every `DeviceType` has a `REGISTRY` entry, enforced by a new registry test).
- **FR-EXT-30** — `DeployCoordinator`'s constructor took 17 positional parameters, several of the same type adjacent to each other (three stores, three panels) — a transposition error at the call site would type-check silently. It now takes one grouped options object (`{ manager, statusBar, stores, panels, channels, ... }`).
- **FR-EXT-31** — Bad input reaching a codegen function was handled four different ways: `oled.ts` threw, `midi-usb.ts` silently fell back to a default mode, `pot.ts`/`toggle.ts` silently clamped. One documented contract now applies consistently: throw for structurally-impossible input (`pinToAdcChannel`, `midiUsbCodegen.initLines`), clamp only for values with a genuinely intended default (`clampTogglePosition`).
- **FR-EXT-32** — `controls-webview.ts` was a flat 767-line module owning six unrelated concerns (convention canvas, legacy YAML editor canvas, drag-and-drop, save serialization, SD-card viewer, OLED live-preview strip) via 13+ module-scoped mutable variables. Split into per-concern modules under `src/webview/controls/`, each owning its own state; the entry point is now a ~130-line orchestrator.
- **FR-EXT-33** — None of the five `onDidReceiveMessage`/`postMessage` handlers imported `messages.ts`'s discriminated-union types, each re-deriving per-field checks by hand with no compile-time reminder to add a branch for a new/renamed variant. All five now narrow via `hasKnownCommand<T>()` (upgraded to a real type predicate) and dispatch through an exhaustive `switch` with an `assertNever()` default branch.
- **FR-EXT-34 / FR-EXT-35** — `scope-webview.ts` redrew the scope/spectrum canvases synchronously on every incoming IPC message, and `midi-webview.ts`'s MIDI monitor rebuilt its full row list on every message — both now route through `raf-coalesce.ts` (already used for pot/encoder drag), capping redraws/rebuilds at one per animation frame.
- **FR-EXT-36** — The native `midi` dependency was declared with an unrestricted `^2.0.0` caret range despite being more prone to ABI/behavior breakage across minor bumps than a pure-JS package. Pinned to an exact `2.0.0`; a new smoke test verifies the installed package's `Input` class still satisfies the `MidiInputLike` shape `host-bridge.ts` depends on (tolerant of the expected Electron-vs-Node ABI mismatch outside the real Extension Host).
- **FR-EXT-37** — `sdcard.ts`, `midi-trs.ts`, `midi-usb.ts`, and `oled.ts` each redeclared the same handle-name/decl-regex/init-prefix/strategy-object shape, ~70% copy-pasted across files. A new `makeSimplePeripheralCodegen()` (`src/devices/codegen/shared.ts`) factors out the bus-invariant case; `midi-usb.ts`/`oled.ts` build on it and override their bus-variant half.
- **FR-EXT-38** — `truncId`/`TRUNC_MAX_LEN` were defined twice — once exported from `controls-editor-panel.ts` (host side), once re-declared unexported in the webview — because the two run under different tsconfigs. Both now import the one implementation in `src/webview/id-truncate.ts`.
- **FR-EXT-39** — Confirmed the regression test added alongside FR-EXT-6 already covers "an `EmulatorManager` `'error'` emission with zero listeners crashes the process" — verified by temporarily removing the production listener and confirming the test fails.
- **chore** — `package.json`'s `version` field is bumped to `0.17.5` to match this entry.

---

## 0.17.4 — 2026-08-25

**M56 — Extension Reliability & Validation Hardening** *(FR-EXT-12 .. FR-EXT-26 — DoD green)*

- **FR-EXT-12** — `hardware-build.ts` and `dfu-flash.ts` split each raw stdout/stderr `'data'` chunk on `'\n'` independently, so a diagnostic line or the dfu-util success string split across a chunk boundary was dropped or misreported. Both now route through a new shared `createLineSplitter()` (`src/hardware/line-buffer.ts`) that buffers a trailing incomplete segment across chunks (and flushes it on stream close), one instance per stream so stdout/stderr can't cross-contaminate each other's buffered state.
- **FR-EXT-13** — `EmulatorManager.killExisting()` sent SIGTERM only, unlike `killStalePid`'s SIGTERM → wait → SIGKILL escalation, so a live child that ignored SIGTERM (e.g. blocked in a native audio callback) was never force-terminated. Both now share one `escalateKill()` helper; `killExisting()` escalates to SIGKILL after `KILL_ESCALATION_MS` just like `killStalePid`.
- **FR-EXT-14 / FR-EXT-15** — `HostMidiBridge.start()` only try/caught the initial port-count probe; a throw from `openPort(i)` inside the per-port loop propagated out of `start()` and, unguarded, out of `activate()`. Each port-open now has its own try/catch so one bad port can't block the rest or crash activation. The probe `Input` used solely to read `getPortCount()` is also now explicitly `closePort()`'d instead of leaked.
- **FR-EXT-16** — None of `make`, `dfu-util`, cmake configure/build, or emulator deploy accepted a cancellation token, so a hung process left the triggering command's promise pending forever with no way to abort short of reloading the extension host window. `buildForHardware`/`flashToHardware`/`buildForEmulator`/`deployToEmulator`/`debugDeploy`/`DaisyRunConfigurationProvider` and `EmulatorManager.build()`/`deploy()`/`runProcess()` all now accept an optional `CancellationToken` wired to `proc.kill()`; the `ds-ide.build`/`buildHardware`/`flash`/`buildAndDeploy`/`deploy`/`debug` commands and the F5 launch-configuration path report progress via a `cancellable: true` `withProgress` notification.
- **FR-EXT-17** — `decodeOledFrame`'s `atob(base64)` call threw uncaught on malformed input directly inside a `'message'` event listener, breaking the OLED preview for the rest of the session on one corrupted IPC frame. It now returns `null` on decode failure instead of throwing; both call sites (`oled-webview.ts`, `controls-webview.ts`) show a "frame decode error" status instead of drawing garbage or crashing the listener.
- **FR-EXT-18** — `EmulatorManager.deploy()` assigned `this.childProcess` only after `spawn()` returned; a `dispose()` racing in between found `childProcess === null` and had nothing to kill, orphaning the child `spawn()` produced afterward. A `disposed` flag set by `dispose()` is now checked once `deploy()`'s close listener is wired, killing any child spawned in that race window.
- **FR-EXT-19** — `ButtonStore`/`ToggleStore`/`PotStore` discarded `workspaceState.update()`'s promise via bare `void`, so a storage rejection (disk full, etc.) became an unhandled promise rejection. Each now attaches a `.then(undefined, err => console.warn(...))` handler (`Memento.update()` returns a `Thenable`, not a full `Promise`, so `.catch()` isn't available).
- **FR-EXT-20** — The hand-rolled `controllers.yaml` writer/reader was strictly line-based; `yamlQuote()` never escaped embedded newlines, so a label containing one (freely typeable in the Controls Editor) split across physical lines and corrupted the file on the next load. `yamlQuote()`/`parseYamlScalar()` now share an escape/unescape pair covering `\n`/`\r`/`\t`/other control characters (and, as a natural side effect, actually unescape `\\`/`\"` on read for the first time — previously written but never reversed).
- **FR-EXT-21** — `gpio_pin` validation was capped at a hardcoded `31`, but the pin table's actual highest defined pin is `30` — a `gpio_pin: 31` entry passed validation but could never render or participate in conflict checks. The bound is now derived from `PIN_DEFS` (`MAX_GPIO_PIN`) instead of hardcoded.
- **FR-EXT-22** — Every webview's `window.addEventListener('message', ...)` handler trusted `e.data`'s declared type with no runtime check, so a drift between the host and webview sides of `messages.ts` failed silently on unchecked field access. A new `hasKnownCommand()` helper (`src/webview/message-guard.ts`) is now checked first in all five webview message handlers (`controls-webview.ts`, `scope-webview.ts`, `oled-webview.ts`, `midi-webview.ts`, `wiring-webview.ts`); an unrecognized command is ignored rather than acted on.
- **FR-EXT-23 / FR-EXT-24** — `create-effect-project.ts`'s existence check treated any `fs.stat` failure as "doesn't exist," so a permission-denied or unavailable-drive error proceeded to create the directory anyway; its final `vscode.openFolder` step was also the only step in the function not wrapped in try/catch. The stat catch now inspects the error code (`FileNotFound`/`ENOENT` vs. anything else) before proceeding, and `openFolder` failures now surface via `showErrorMessage` like every other step.
- **FR-EXT-25** — `EmulatorManager.connectIpc()` wired up `message`/`error`/`disconnect` listeners on `IpcClient` but never forwarded its `'warning'` event, so dropped/malformed IPC traffic was visible only via `console.warn` in the extension host's dev console. `EmulatorManager` now re-emits `'warning'`, surfaced through the existing `Daisy IDE Emulator` output channel.
- **FR-EXT-26** — The `</script>`-breakout-prevention `safeJson()` helper was copy-pasted identically in `controls-editor-panel.ts` and `wiring-panel.ts`. Both now import one implementation from `src/webview/html-safe.ts`.
- **chore** — `package.json`'s `version` field is bumped to `0.17.4` to match this entry.

---

## 0.17.3 — 2026-08-25

**M55 — Extension Critical Fixes** *(FR-EXT-6, FR-EXT-7, FR-EXT-8, FR-EXT-9, FR-EXT-10, FR-EXT-11 — DoD green)*

- **FR-EXT-6** — `activate()` never registered a `manager.on('error', ...)` listener; Node's `EventEmitter` throws in-process on an unhandled `'error'` emission, so any raw IPC socket error could crash the entire Extension Host for the window. `activate()` now registers an `'error'` listener that surfaces the error via `showErrorMessage` and the `Daisy IDE Emulator` output channel instead.
- **FR-EXT-7** — `EmulatorManager.connectIpc()`'s rejection path (connect timeout, malformed/version-mismatched handshake) only closed the socket, leaving the already-spawned `effect_emu` child orphaned until the next stale-PID reaper. The connect/handshake sequence is now wrapped so any failure explicitly kills the spawned child before the rejection propagates.
- **FR-EXT-8** — `WiringViewProvider`'s `async onDidReceiveMessage` callback awaited three file-I/O-performing handlers (wirePin/unwirePin/setPeripheralEnabled) with no surrounding try/catch, unlike the equivalent `controls-editor-panel.ts` handler — a thrown error (e.g. a permission error) would have produced an unhandled promise rejection. All three calls are now wrapped, surfacing failures via `showErrorMessage`.
- **FR-EXT-9** — `extension.ts`'s `activate()` was a single ~640-line function building every store, panel, provider, and command registration inline — the same file where the FR-EXT-6 and FR-EXT-10 gaps both lived, a direct consequence of the function being too large to review as a whole. View-provider construction (`createControlsProvider`, `createWiringProvider`), command registration (`registerCommands`), the save-listener (`createSaveListener`), and manager message/disconnect/error routing (`wireManagerEvents`) are now named factory functions that `activate()` merely composes; `activate()` itself is ~335 lines, down from ~648. No behavior change — all existing tests pass unmodified.
- **FR-EXT-10** — `build.ts` called `findEffectSource(projectRoot)` with a single argument, so the `ds-ide.effectSource` configured-path branch was always skipped, even though the build failure message told the user to set it. The resolution/error-handling wrapper previously duplicated inside `extension.ts` is now `resolveConfiguredEffectSource()`, exported from `find-effect-source.ts` and shared by both the build command and every `extension.ts` call site — eliminating the duplication that let the setting silently drift out of sync between them.
- **FR-EXT-11** — `validateId()` only checked for emptiness and duplication; a free-text wiring id like `x; SystemInit(); //` was interpolated unescaped into generated C++ declaration/init lines. `validateId()` now rejects any value that isn't a valid C++ identifier or that collides with a C++17 reserved keyword, closing this off before it ever reaches `controls-writer.ts`.
- **chore** — `package.json`'s `version` field is bumped to `0.17.3` to match this entry.

---

## 0.17.2 — 2026-08-25

**M54 — Emulator RT & Concurrency Safety** *(FR-EMU-9, FR-EMU-10, FR-EMU-11 — DoD green)*

- **FR-EMU-9** — `ipc_queue` and `midi_queue` were documented single-producer/single-consumer ring buffers, but LED/RGB-LED shim code and the audio RT thread both pushed into `ipc_queue`, and the IPC-dispatch thread and MIDI UART/USB handlers both pushed into `midi_queue` — an unsynchronized data race on a shared `std::string` under entirely ordinary use. LED/RGB-LED telemetry now has its own dedicated `led_queue` (effect-thread-owned); `midi_queue` splits into `midi_tx_queue` (effect-thread TX) and `midi_rx_queue` (IPC-thread RX telemetry). No two threads call `push()` on the same `SpscIpcQueue` instance anywhere in the tree, verified by code inspection of every call site.
- **FR-EMU-10** — `build_scope_json`/`build_spectrum_json`/`fft_radix2` (up to ~5,000 `snprintf` calls plus two FFTs per emission) ran synchronously inside the audio RT callback in both simulated and real-time mode. `processBlock`/`process_one_block` now only memcpy raw interleaved samples into a new RT-safe `ScopeBlockQueue` (mirroring `SessionRecorder`'s existing `enqueueBlock` ring-buffer pattern); all scope/spectrum JSON building and FFT work moved to the existing non-RT drain thread. Each queued block is tagged with the `config_generation` its producer was entered under, so a mid-session sample-rate change can't have its stale-rate backlog drained (and its stale `binHz` reported) ahead of freshly-produced blocks — a regression this fix's own testing surfaced and closed.
- **FR-EMU-11** — `main.cpp`'s detached `shutdown_watcher` called `std::_Exit(0)` almost immediately after shutdown was requested, racing the "normal" join/return-0 path (itself dead code, since `effect_main()` never returns under a signal-driven stop) and discarding not-yet-drained `ipc_queue`/`oled_queue`/`led_queue`/`midi_tx_queue`/`midi_rx_queue` telemetry on every shutdown. `shutdown_watcher` is now the single authoritative termination path in every case: it wakes `mode_cv`/`callback_cv` (nothing previously notified them, even though their wait predicates already checked the shutdown flag — audio_thread could otherwise block forever past a shutdown request, verified by manually reproducing the hang), joins `audio_thread` so its drain thread finishes flushing before the socket is torn down (`ipc_server.cpp`'s per-client read loop now waits on a new `telemetry_drained` flag instead of closing the connection the instant `shutdown` flips, which previously raced ahead of and cut off that flush), then exits cleanly.
- **chore** — `package.json`'s `version` field is bumped to match `CHANGELOG.md`'s latest entry; it was left at `0.17.0` during the prior M53 release, tripping `package-metadata.test.ts`'s version-parity check.

---

## 0.17.1 — 2026-08-25

**M53 — Multi-Root Debug-Attach Fix** *(FR-UX-6 — DoD green)*

- **FR-UX-6** — `src/commands/debug-deploy.ts` (`ds-ide.debug` PID-attach) and `src/debug/run-config-provider.ts` (F5 launch-configuration attach) both read `vscode.workspace.workspaceFolders?.[0]` directly instead of routing through `resolveActiveFolder()` (`src/workspace/active-folder.ts`, established in v11/v12's FR-UX-4). In a multi-root workspace with a non-first folder selected active, build/deploy targeted the correct folder but the `daisy-debug` attach session's folder association silently fell back to the first workspace folder. Both call sites now thread the resolved active folder into `vscode.debug.startDebugging(...)`, matching every other workspace-scoped command. Single-root workspace behavior is unchanged.
- **FR-UX-6** — Adds `scripts/check-active-folder-convention.sh`, wired into `npm run lint`, which greps `src/` (excluding `src/workspace/active-folder.ts` and `src/test/`) for direct indexed/optional-chained access to `workspace.workspaceFolders` and fails the build if any is found — closing the tooling gap that let this exact regression class land silently twice (FR-UX-4, then this fix) with no static guard against a third recurrence.

*Found during manual sprint-close testing: stopping a `daisy-debug` attach session surfaces `Exception has occurred: signal SIGSTOP` in the Debug Console. Confirmed pre-existing on `main` prior to this branch and unrelated to the active-folder fix — logged in `docs/01_input-ideas.md` for future triage, out of scope for FR-UX-6.*

---

## 0.17.0 — 2026-08-23

**M52 — MIDI Program Change Typed Support** *(FR-DEV-20 — DoD green)*

- **FR-DEV-20** — The emulator shim's `MidiEvent` model gains a first-class `MidiMessageType::ProgramChange` and matching `AsProgramChange()` accessor (`emulator/shim/include/daisy/midi_event.h`), mirroring real libDaisy's shape. `parse_midi_event` (`emulator/shim/src/midi_event.cpp`) now recognizes status byte `0xC0` and classifies it as `ProgramChange` instead of falling through to `Unknown` — previously a Program Change was forwarded correctly over IPC and visible in the MIDI monitor (send-only per M47/M48's `FR-MIDI-1` scope), but effect code could only recover the program number by reading `data[0]` off the `Unknown` fallback, an undocumented implementation detail rather than a supported API. Also fixes `MIDI_TYPE_NAMES` in `src/webview/midi-webview.ts`, which is positionally indexed to the C++ enum's order and would otherwise mislabel Program Change messages in the on-screen MIDI monitor after the new enum value was inserted. Surfaced during manual MIDI host-bridge testing; out of scope: PitchBend, ChannelPressure/PolyKeyPressure, SystemCommon/SystemRealTime remain unmodeled.

---

## 0.16.0 — 2026-07-25

**M51 — Host MIDI Bridge Native-Addon ABI Fix** *(FR-DEV-19 — DoD green)*

- **FR-DEV-19** — Fixes a bug where an ordinary VS Code update (bumping its bundled Electron/Node.js version) silently broke the host MIDI bridge with a `NODE_MODULE_VERSION` mismatch, since `midi`'s native addon (`node_modules/midi/build/Release/midi.node`) was compiled against whatever plain Node.js ran `npm install`, never against Electron's actual ABI. `midi` uses NAN, not N-API, so this can't be fixed by a dependency swap — it needs rebuilding per Electron ABI. Adds `@electron/rebuild` as a devDependency, a `postinstall` step (`scripts/rebuild-midi-native.sh`, macOS-only, never blocks `npm install` on failure) that rebuilds the addon against a pinned target Electron version (`scripts/electron-target-version.txt`, currently `42.0.0` — the version needed for the reported `NODE_MODULE_VERSION 146`), and the same rebuild wired into `npm run package` (hard-fails on a bad rebuild, unlike the lenient postinstall path). `scripts/verify-vsix.sh`'s packaged-addon check is upgraded from "loads under system Node" (a misleading pass — the addon can load fine under system Node while still being wrong for Electron) to `scripts/check-native-abi.js`, which parses the exact `NODE_MODULE_VERSION` a mismatched addon reports and asserts it matches the pinned target's expected ABI. **Known limitation, not fully fixed here:** there is no supported way to auto-detect VS Code's exact bundled Electron version at install time (confirmed via `microsoft/vscode-discussions#768`) — the pinned target version must be bumped manually whenever VS Code's bundled Electron major version changes; `host-bridge.ts`'s existing try/catch degradation (no crash, just "bridge unavailable") remains the fallback if a rebuild is ever skipped, fails, or the pin goes stale.

---

## 0.15.2 — 2026-07-25

**M50 — Persist Editor Positions for Encoder, Toggle, and RGB LED** *(FR-CE-3 — DoD green)*

- **FR-CE-3** — `controllers.yaml` gains three new position-only sections — `encoders:`, `toggles:`, `rgbleds:` — each entry carrying just `id` + an optional `editor_pos`, mirroring the `editor_pos` field/round-trip convention `ControllerDef`/`ButtonDef`/`LedDef` already use for pot/button/led (these three device kinds have no other YAML-configurable fields; their pin/behavior comes entirely from the code annotation convention). `buildControlsConfig()`'s `placements` array now includes all three kinds, and the webview's convention-mode Save handler gained parallel `updatedEncoders`/`updatedToggles`/`updatedRgbLeds` branches. Dragging an encoder, toggle, or RGB LED in the Controls Editor now sticks across saves and panel-visibility round-trips, closing the gap discovered during M48/FR-CE-1 manual testing.

---

## 0.15.1 — 2026-07-25

**M49 — Controls Editor as Preview Surface (OLED Embedding)** *(FR-CE-2 — DoD green)*

- **FR-CE-2** — The Controls Editor now docks the OLED live view directly above the layout canvas when the `oled` peripheral is enabled, rather than requiring the separate standalone OLED panel to be opened first — both stay visible at once (mockup Variant B, `docs/mockups/m49-oled-embed.html`), instead of a tabbed Layout/Preview split that would hide one behind the other. `EmulatorManager`'s `oledFrame` message is now dual-subscribed: `OledPanel`'s own listener is unchanged, and a second forward in `extension.ts`'s central dispatcher feeds `ControlsViewProvider`. A "↗ Pop out" action in the strip opens today's unchanged standalone `OledPanel` via a shared `showOledPanel()` helper, now also reused by the Wiring Editor's existing View button. Disabling `oled` collapses the strip back to today's exact full-height layout — no command IDs, contribution labels, or panel naming changed.

---

## 0.15.0 — 2026-07-25

**M48 — Controls Editor Fix & I/O Monitor UIs** *(FR-CE-1, FR-SD-1, FR-MIDI-1 — all DoD green)*

- **FR-CE-1** — Fixed the Controls Editor's layout-persistence bug: `onEditorSave` wrote `controllers.yaml` straight to disk via `fs.promises.writeFile`, bypassing VS Code's document model, so `ControlsViewProvider`'s cached `lastEditorCfg`/`lastControlsConfig` never refreshed — the next panel-visibility flush re-sent the stale pre-save snapshot and clobbered the just-saved positions. Manual testing surfaced two further, deeper issues past the original cache-sync fix: `editorLoad()` unconditionally re-rendered via the legacy YAML-editor path even in convention mode, momentarily (and, once the cache-sync fix started firing it right after every save, visibly) stomping the correctly-rendered canvas — canvas rendering now belongs solely to `applyControlsConfig()`, which knows the authoritative `missingBlock` state. And `buildControlsConfig()` was independently called and pushed from six separate, unsequenced triggers (activation, layout save, wirePin/unwirePin, any yaml/cpp save, deploy), so a slower-but-earlier-started refresh could resolve after a faster-but-later one and silently revert a just-saved layout — consolidated into one `computeControlsConfig()`/`refreshControlsView()` path guarded by a monotonic request id.
- **FR-SD-1** — Adds a read-only SD card content viewer to the Controls Editor: an inline-accordion section below the canvas (mirroring the Wiring Editor's Peripherals section) showing `./sdcard/`'s root-level entries (name, size) when the `sdcard` peripheral is enabled. Refreshes on webview focus and an explicit Refresh action; clicking a `.txt` row lazily requests a size-capped, host-read preview (non-UTF-8 or non-`.txt` files show "preview not available"). Host-side filesystem access stays in `extension.ts`, matching the existing convention that `ControlsViewProvider` only routes messages and never touches the filesystem itself.
- **FR-MIDI-1** — Adds `MidiUsbHandler::SendMessage()`/`MidiUartHandler::SendMessage()` to the emulator shim: an effect calling either now enqueues a `midiTx` message onto the existing `midi_queue` (M47) alongside inbound `midiRx` telemetry, rather than a second queue. Extends `MidiPanel` with a Program Change selector and Control Change sender alongside the existing virtual keyboard, and unifies the monitor into one bounded-history list showing both Rx and Tx traffic with a direction label/color.
- Discovered a gap during FR-CE-1's manual testing, deliberately deferred rather than folded in: encoder/toggle/rgbled canvas positions have no persistence mechanism at all (no `editor_pos`-equivalent field anywhere), so they always auto-layout fresh on every render independent of dragging or saving — pot/button/led positions round-trip correctly. Filed as M50.
- Fixed a pre-existing, unrelated gap surfaced while adding FR-MIDI-1's shim tests: `tests/emulator-safety/run_tests.sh` was missing `midi_event.cpp` from its link sources since M47, so the harness failed to build at all — now also compiles the MIDI shim sources.

---

## 0.14.4 — 2026-07-22

**M47 — MIDI: TRS & USB** *(FR-DEV-16, FR-DEV-17, FR-DEV-18 — all DoD green)*

- **FR-DEV-16** — `MidiUartHandler` (MIDI TRS) lands as the first peripheral whose runtime data is an *inbound* event stream rather than outbound telemetry — a note played on the virtual keyboard or a host controller must travel extension → emulator → effect. Fixed to USART1 (D13–D14). Introduces the shared MIDI plumbing: a byte-triplet `midiEvent` wire message, a shared `MidiEvent` parser (NoteOn/NoteOff/ControlChange), a mutex-guarded `midi_in_queue` FIFO, and a dedicated `midi_queue` emitting `midiRx` telemetry for the monitor. Also fixed a latent gap this surfaced: `daisy_seed.h` never included `switch3.h`/`rgb_led.h`/`encoder.h`/`fatfs_host.h`/`oled_display.h`, so a real generated project using any of those M44–M46 devices failed to compile despite each shim's own isolated unit tests passing — fixed for all five.
- **FR-DEV-17** — `MidiUsbHandler` (MIDI USB) lands with mode-dependent footprint resolution: `INTERNAL` (the micro USB connector, modeled as a zero-pin pseudo-bus) and `USB_HS_D` (D29–D30, a real bus — `canonicalBusSignal` extended to recognize the `USB_HS_D_-`/`USB_HS_D_+` schematic names, carefully excluding the unrelated `USB_HS_ID` signal on D0). Unlike OLED, the declared C++ type is mode-invariant; the mode selection lives in the init line instead, so `PeripheralCodegenStrategy.initLines` gained an optional bus/mode parameter.
- **FR-DEV-18** — A new `MidiPanel` combines an on-screen keyboard (sends notes into the emulator) and a message monitor (renders every `midiRx` event the shim confirms it parsed). `HostMidiBridge` forwards a real controller's messages into the same pipeline, macOS-only, with the native `midi` binding loaded lazily and defensively — a missing/broken addon degrades to inert rather than crashing activation. Generalized the OLED-only "View" button/auto-open trigger into a registry-driven `hasLiveView` flag now that three peripherals use it.
- Fixed a packaging gap FR-DEV-18's own dependency exposed: `midi` is a native addon esbuild can't inline, but the package script used `vsce package --no-dependencies` and `.vscodeignore` blanket-excluded `node_modules` — together these would have shipped a `.vsix` where the host bridge silently failed to load. Fixed by carving the specific runtime files `midi` needs back into `.vscodeignore` and extending `verify-vsix.sh` to actually `require()` the module from the packaged layout.
- Fixed two gaps found in manual testing: the Peripherals section rendered a blank pins column for `midiUsb`'s `INTERNAL` mode (zero pins is correct, but indistinguishable from "not connected"), and the board/schematic SVG showed nothing near the micro USB connector at all. Both fixed — the list row falls back to the bus/mode label, and the board's USB port graphic now highlights (with a hover tooltip) whenever a peripheral is enabled with `bus === 'INTERNAL'`.

---

## 0.14.3 — 2026-07-22

**M46 — OLED Display** *(FR-DEV-14, FR-DEV-15 — all DoD green)*

- **FR-DEV-14** — `OledDisplay` (SSD1306) lands as the first bus-attached peripheral with more than one candidate bus (SPI1 or I2C1) and the first whose runtime data is a framebuffer rather than a scalar. The registry's single-bus `bus?: string` field gains a `busChoices?: string[]` sibling; the currently-selected bus is read back from which `declLine()` variant is present in source, the same "source is the source of truth" convention every other peripheral uses. The shim implements pixel primitives only (`Fill`/`DrawPixel`/`Update`) — no `WriteString`/font support, a confirmed scope decision. `Update()` runs on the effect's own thread (not the audio engine's RT callback), so the framebuffer rides a second, dedicated `SpscIpcQueue` rather than the existing one — a 10,000-frame concurrent producer/consumer stress test (plain build + ThreadSanitizer) confirms this ships without perturbing the RT thread.
- **FR-DEV-15** — A new OLED viewer webview panel renders the captured framebuffer at native 128×64, reporting live frame rate and the peripheral's current bus. Auto-opens on deploy only when OLED is actually enabled (unlike the always-shown Scope panel). The Peripherals section gained a "View" action. Bus-choice *switching* from the UI is deliberately deferred to a follow-up — the underlying capability is built and tested, but the switch action itself is a distinct piece of work.
- Fixed a latent bug this surfaced: `resolveBusFootprint` scanned every alternate-function mux option a pin's CSV column lists, not just its canonical board-dedicated signal, so a bus's resolved footprint could silently include pins nothing has actually wired to it (I2C1 would have falsely included D13/D14, MIDI TRS's pins per M47).
- Fixed a gap found in manual testing: wiring a control (e.g. a button) onto a pin an enabled bus peripheral occupies silently succeeded with no warning — FR-DEV-13's reject-with-remedy check only ever ran on the "enable a peripheral" path. `onWirePin` now runs the same conflict check.

---

## 0.14.2 — 2026-07-22

**M45 — MicroSD & Bus-Peripheral UI** *(FR-DEV-10, FR-DEV-11, FR-DEV-12, FR-DEV-13 — all DoD green)*

- **FR-DEV-10** — `sdcard` lands as the first bus-attached, non-instanced device: a registry entry with a `peripheralCodegen` strategy (enabled/disabled, not N-instance like pot's shared array) and an emulator-side FatFS shim (`emulator/shim/src/fatfs_host.cpp`) mapping `f_mount`/`f_open`/`f_read`/`f_write`/`f_lseek`/`f_close` onto a workspace-relative host directory instead of real SD hardware, with path-escape rejection.
- **FR-DEV-11** — The Wiring Editor gained a dedicated Peripherals section: bus peripherals are enabled/disabled from a checkbox list rather than by clicking a pin. Enabled state persists the same way wired-control topology already does — presence of the peripheral's declaration in the effect source — via a new `peripheral-state.ts`/`peripheral-config.ts` pair living in their own `ds-ide:peripherals:*` marker block, independent of the existing controls block.
- **FR-DEV-12** — Enabled bus peripherals draw as one collapsed bracket spanning their resolved pins, via a new pure `bus-bracket.ts` reducer — never one label per pin. Hovering a bracket's pin shows a tooltip (pin · signal · owner); clicking the bracket opens a structured popover with the full pin map and a disable action.
- **FR-DEV-13** — Enabling a peripheral is now checked against every existing occupant (wired controls and other enabled peripherals) before any source edit is made — a colliding action is refused outright, never applied-and-flagged, naming every blocking pin/signal/owner. A colliding peripheral occupant gets a one-click "move to bus X" remedy when a collision-free alternative exists; a hand-wired control blocker never does.
- Fixed a regression (found in manual testing) where disabling a peripheral left its pins permanently marked as occupied — the DOM class-toggling logic only ever added the "connected" style and never restored the default, replaced with a pure `pin-overlay-state.ts` that recomputes each pin's full desired state from scratch on every update.

---

## 0.14.1 — 2026-07-21

**M44 — Cheap Trio: Toggle, RGB LED, Encoder** *(FR-DEV-7, FR-DEV-8, FR-DEV-9 — all DoD green)*

- **FR-DEV-7** — `Switch3` toggle switch: a single-pin, multi-position (0/1/2) digital input — the first device to exercise the registry's `multi-position` primitive. Reports position over the generalised `controlValue` (`tgl<pin>` ids); `ToggleStore` persists it across redeploys like `ButtonStore`.
- **FR-DEV-8** — `RgbLed`: three PWM channels addressed as one named instance — the first registry entry owning multiple pins. The annotation convention gained an optional `pins=p0,p1,p2` field alongside the always-present primary `pin=`; the Wiring Editor auto-claims the two additional free pins after the one clicked, refusing the action if not enough remain. Colour renders in the Controls Editor as a live colored-dot indicator via a new `rgbLed` IPC message.
- **FR-DEV-9** — `Encoder`: A/B quadrature pins plus a click pin (click reuses the existing virtual button state directly). Confirms the M43 assumption that delta semantics fit `controlValue {id, value}` without a new message kind — the wire carries an accumulated, wrapped position, and the shim derives each callback's delta by diffing, including across the wraparound boundary. The Controls Editor gained a rotary drag affordance with detents.
- Fixed a hardcoded `pot|button|led` device-kind whitelist in `wiring-editor-panel.ts` (predating the registry) that silently dropped every new device kind's wiring message; fixed a related bug where a multi-pin device's Wiring Editor display collapsed back to one highlighted pin immediately after being wired, by unifying three drifted inline pin-mapping copies in `extension.ts` into one shared `expandToWiredPins()`.

---

## 0.14.0 — 2026-07-21

**M43 — Device Registry & Protocol Foundation** *(FR-DEV-1, FR-DEV-2, FR-DEV-3, FR-DEV-4, FR-DEV-5, FR-DEV-6 — all DoD green)*

- **FR-DEV-3** — `src/devices/pin-table.gen.ts` is generated by `scripts/gen-pin-table.ts` from a tracked copy of the Rev4 pinout CSV (`resources/Daisy_Seed_Rev4_Pinout.csv`), replacing the hand-maintained `PIN_DEFS` literal in `wiring-panel.ts` that had drifted twice before. Pin number, ADC capability and I2C/UART/SPI/SDMMC signal names are all derived from the CSV.
- **FR-DEV-1** — `pot`/`potSnapshot`/`button`/`buttonSnapshot` collapse into `controlValue {id, value}` and `controlSnapshot {values}` on the emulator IPC wire; device identity now lives in the `id` field rather than the message kind, so a future device adds no new message kind. Outbound validation (`src/ipc/control-values.ts`) rejects an unknown id or non-finite value before anything is sent.
- **FR-DEV-6** — Extension and emulator exchange a protocol version as the emulator's very first message on connect; a mismatch (or a stale, pre-handshake emulator) rejects deploy with an explicit, actionable error naming both versions and the remedy, before any control message is exchanged.
- **FR-DEV-2** — `src/devices/registry.ts` is the single source of truth for pot/button/led, replacing three separately-declared `pot|button|led` unions (`controls-convention-parser.ts`, `controls-writer.ts`, `wiring-panel.ts`) and the hardcoded Wiring Editor/Controls Editor palette, popup buttons and per-device CSS, all now generated by enumerating the registry.
- **FR-DEV-3** — `src/devices/attachment.ts` models `pin`, `pins[]`, `bus` and `connector` attachment kinds; a bus attachment's footprint is derived from the generated pin table on every read rather than cached, and `findConflicts()` reports every pin (or connector) claimed by more than one device, naming each owner.
- **FR-DEV-4** — Pot's shared contiguous `AdcChannelConfig` array codegen (FR-CODEGEN-1) moves into `src/devices/codegen/pot.ts` as a registry-driven strategy object, preserved exactly; button/led's per-instance `Init()` call is now driven by registry data (`initArgs`) instead of a literal kind check.
- **FR-DEV-5** — `src/devices/board-bundle.ts` verifies the registry and attachment model can express a board as a named bundle of fixed-pin device instances plus a faceplate graphic — dormant, not exposed in any UI, proven only by its own test.

---

## 0.13.4 — 2026-07-05

**M42 — Extension/Tooling Polish** *(FR-QA-EXT-1 through FR-QA-EXT-9 — all DoD green)*

- **FR-QA-EXT-1** — `esbuild.js` splits into two build configs — extension (`platform: 'node'`, `format: 'cjs'`, `external: ['vscode']`) and webviews (`platform: 'browser'`, `format: 'iife'`) — so the first import added to a webview script no longer risks a Node-platform bundle misresolving it.
- **FR-QA-EXT-2** — `IpcClient` emits a counted `warning` event on dropped sends and malformed/schema-invalid lines instead of silently no-op'ing; receive-buffer overflow now resynchronizes to the next newline instead of discarding a trailing valid message.
- **FR-QA-EXT-3** — `runDfuUtil`'s non-zero-exit success path now only fires for dfu-util's known exit-74-after-`:leave` quirk, and only when the success string also confirms it — an arbitrary non-zero exit no longer masquerades as success.
- **FR-QA-EXT-4** — Unrecognized top-level YAML keys and other unparseable lines now produce a parse error instead of being silently skipped; the scaffolded `controllers.yaml` uses the `controllers:` key the parser actually reads (was `controls: []`).
- **FR-QA-EXT-5** — `@types/node` pinned to `^18` to match esbuild's `node18` target; `which`/`xcrun` detection switched from `cp.exec` to `cp.execFile`; the knob SVG size/center constants are shared between `knob-math.ts` and `controls-webview.ts` instead of duplicated as literals.
- **FR-QA-EXT-6** — `package.json` version synced to the CHANGELOG; a marketplace icon asset was added; the unused controls/wiring editor `-light.svg` icon variants (dead — `viewsContainers` only supports one themed icon) were deleted; `ds-ide.*` keybindings are gated behind a new `ds-ide.isDaisyProject` context key.
- **FR-QA-EXT-7** — `EmulatorManager.build()`/`deploy()` use `fs.promises.mkdir` instead of `mkdirSync`; `dfu-flash`'s `findHardwareBin()` uses `fs.promises.readdir`/`stat`; `ScopePanel.show()` on an already-open panel no longer reassigns `webview.html` (which wiped scope/spectrum trace history) — it reveals the panel and posts the last known status instead.
- **FR-QA-EXT-8** — `armToolchainPath` is now `"scope": "machine-overridable"` so Settings Sync can't carry one machine's toolchain path onto another; both `armToolchainPath` and `effectSource` gain a `markdownDescription`.
- **FR-QA-EXT-9** — `daisy-debug`'s label now reads as internal/attach-only; `resolveDebugConfiguration()`'s build+deploy step reports progress via `vscode.window.withProgress`; lldb-dap discovery extends to `which lldb-dap` and versioned Debian/Ubuntu binary names on PATH.

---

## 0.13.3 — 2026-07-05

**M41 — Emulator Code Quality & Hygiene** *(FR-QA-EMU-1 through FR-QA-EMU-8 — all DoD green)*

- **FR-QA-EMU-1** — `lastLatencyMs()`'s IPC field is renamed from `measuredMs` to `estimatedMs` (extension host, webview, and narrowing table updated to match) since the reported value is `budget_ms * 2.0`, a synthetic estimate rather than an actual measurement.
- **FR-QA-EMU-2** — `CoreAudioDevice::Impl` is now owned via `std::unique_ptr<Impl>` instead of a raw `Impl*`; copy constructor/assignment are explicitly deleted, closing a latent double-free-on-copy risk.
- **FR-QA-EMU-3** — Each `DaisySeed::StartAudio()` overload now nulls the other overload's callback pointer; both pointers are `std::atomic` and re-read once per audio block instead of latching a single overload for the process lifetime; a repeated `StartAudio()` call emits a `start_audio_repeated` warning event.
- **FR-QA-EMU-4** — `System::Delay(ms)` now computes an absolute deadline up front and sleeps to `min(deadline, now + 1ms)` per iteration, instead of a fixed 1ms-per-iteration loop whose per-call scheduler overshoot compounded once per iteration (measured ~25% drift over a 200ms delay on this machine).
- **FR-QA-EMU-5** — The `pot`/`potSnapshot` IPC handlers now clamp to `[0, 1]` and reject non-finite (`NaN`/`Inf`) values via a shared `clamp_pot_value()` helper, matching `outputVolume`'s existing clamp behavior.
- **FR-QA-EMU-6** — `json_get()`'s string-value scanner now translates the standard JSON escape set (`\n \t \r \b \f \" \\ \/`) and decodes `\uXXXX` to UTF-8 (rejecting a malformed escape), instead of dropping the backslash and keeping the literal character that followed it.
- **FR-QA-EMU-7** — `DaisySeed::PrintLine`'s declaration gains `__attribute__((format(printf, 2, 3)))` so a mismatched format/argument pair is caught at compile time; output now emits `\r\n` to match hardware's UART/USB-CDC logger.
- **FR-QA-EMU-8** — Shim + runtime sources moved into their own `runtime_shim_obj` CMake object library built at `-O2 -g` (the effect object stays at `-O0 -g` for fast iteration); `-Wextra -Wshadow` added to both targets, with no warnings surfacing across the example effect corpus.

---

## 0.13.2 — 2026-07-05

**M40 — Extension UX & Workspace Safety** *(FR-UX-1 through FR-UX-5 — all DoD green)*

- **FR-UX-1** — `flashToHardware` and `buildForHardware` now require an `OutputChannel` created once in `activate()` and registered in `context.subscriptions`, instead of `flashToHardware` creating a new `"Daisy IDE Flash"` channel (and never disposing it) on every invocation.
- **FR-UX-2** — `controllers.yaml` validation errors are aggregated into a single warning and deduplicated across saves with an unchanged error set, instead of one toast per error from six-plus call sites. `EmulatorManager.isConnected` (backed by a new `IpcClient.connected` getter that reflects the live socket, not just a retained reference) lets transport commands warn instead of showing a false "started"/"stopped" toast when no emulator is connected. Routine build/deploy success now relies on the status bar (`setStatusBarMessage` for build) instead of an additional toast.
- **FR-UX-3** — `findEffectSource` rejects a configured `ds-ide.effectSource` path that resolves outside the workspace folder (`EffectSourceOutsideWorkspaceError`), surfaced as an actionable error instead of silently redirecting wiring edits. `makeBlockEdit` now edits each marker pair independently — an already-established block's range is never touched just because a different block is missing — and appending marker blocks to a file that has none now requires a one-time modal confirmation instead of a silent full-file replace.
- **FR-UX-4** — Every workspace-dependent operation previously hardcoded `workspaceFolders[0]`; a new `src/workspace/active-folder.ts` centralizes project-root resolution (`resolveActiveFolder`, `promptSelectActiveFolder`), and a new `ds-ide.selectActiveFolder` command lets the user choose which folder ds-ide operates on in a multi-root workspace, persisted in `workspaceState`. The save-listener's "in workspace" check now uses `vscode.workspace.getWorkspaceFolder(doc.uri)` instead of a raw `startsWith`, so a sibling directory sharing a path prefix with the active folder no longer false-positives.
- **FR-UX-5** — Dragging a Controls-webview knob posted a `pot` message per mousemove (~60–120Hz), each one triggering a full `workspaceState` read-modify-write. `PotStore` now keeps a live in-memory cache (so `getSnapshot()` replay always sees the latest value) and debounces the persisted write to ~250ms after the last drag update. A new `src/webview/raf-coalesce.ts` helper coalesces the webview's mousemove handling to at most one DOM update + IPC send per animation frame.

---

## 0.13.1 — 2026-07-04

**M39 — IPC & Data Validation Hardening** *(FR-IPC-1 through FR-IPC-7 — all DoD green)*

- **FR-IPC-1** — `IpcClient.connect()` now carries its own 5s timeout via a guarded `setTimeout`/`clearTimeout`, so an emulator that announces its socket but never accepts the connection causes `deploy()` to reject within a bounded time instead of hanging forever and wedging the deploy lock for the rest of the session.
- **FR-IPC-2** — IPC messages are now validated against a per-type narrowing table (`src/ipc/narrow.ts`'s `parseIpcMessage`) at the point they're parsed off the socket; malformed or unrecognized messages are logged and dropped rather than forwarded. `scope-panel.ts` and `controls-editor-panel.ts` no longer spread the raw emulator message into webview `postMessage` calls — only whitelisted, type-checked fields are forwarded. The scope webview's status line is now built via DOM APIs (`textContent`/`createElement`) instead of `innerHTML`, and `.toUpperCase()` on an event `kind` is guarded with a `typeof` check.
- **FR-IPC-3** — `editorSave`'s webview payload is now processed inside a try/catch so a grossly malformed `cfg` (e.g. `{ pots: [{}] }`) surfaces a warning instead of throwing inside the extension host's message handler; serialized `id` fields for pots/buttons/LEDs now pass through `yamlQuote` (previously only labels were quoted), so an id containing `:` or `#` round-trips intact instead of corrupting the YAML.
- **FR-IPC-4** — `loadControllerConfig()` now distinguishes `ENOENT` (legitimately no config yet) from any other read error (`EACCES`, `EMFILE`, encoding failures): the latter surfaces a warning and marks the session `controllerConfigUnreadable`, and the Controls Editor's save path refuses to write while that flag is set — a transient read glitch can no longer result in silently overwriting the user's real `controllers.yaml` with an empty one.
- **FR-IPC-5** — The Wiring Editor's wire/unwire handlers now check `vscode.workspace.applyEdit`'s boolean result and surface a visible error without touching either view when it's `false`; a successful edit is followed by `doc.save()` so the Controls view's disk read reflects the same content the Wiring view already shows, instead of disagreeing until a manual save. `makeBlockEdit`'s marker search now treats a duplicated `begin`/`end` marker line as "not found" (falling back to a full-file replacement) instead of silently pairing the wrong range.
- **FR-IPC-6** — `@ts-nocheck` removed from all three webview scripts; they type-check under a new `tsconfig.webview.json` (`lib: ["ES2022", "DOM"]`) without leaking DOM globals into the Node-side extension host compilation. Knob geometry (`webview/knob-math.ts`), wiring id allocation/validation (`wiring/id-validation.ts`), and wired-pin display-state (`wiring/wired-pin-state.ts`) are now pure, unit-tested modules instead of inline webview logic. Added a shared discriminated-union message protocol (`webview/messages.ts`) imported by both the extension host and webview bundles. `tsc --noEmit` now covers `src/test` (previously excluded), and the ~95 pre-existing type errors that surfaced across unrelated test files were fixed.
- **FR-IPC-7** — Extracted a `DeployCoordinator` (owning `performDeploy`, `sendPostDeployState`, and status-bar transitions) and a `SessionState` object (owning `sineState`/`audioSourceState`/`activeRecordPath` persistence) out of `activate()`. `ds-ide.buildAndDeploy`, `ds-ide.deploy`, and `ds-ide.debug` now all call `performDeploy({ build, debug })` on the same coordinator instead of each re-implementing the post-deploy state replay sequence, closing the divergence risk between them.

---

## 0.13.0 — 2026-07-04

**M38 — Emulator Correctness & Robustness** *(FR-EMU-1 through FR-EMU-8 — all DoD green)*

- **FR-EMU-1** — `SessionPlayer::popBlock()` zero-fills the unread tail when a recorded block is shorter than the requested frame count, instead of leaving stale samples from a previous call in the buffer; `replayStart` now emits a `replay_rate_mismatch` event when the header's `sample_rate`/`block_size` diverge from the engine's current config. Replay of the same `.dsrec` is now bit-for-bit deterministic across runs.
- **FR-EMU-2** — The scope/spectrum sample budget (`ScopeState::SCOPE_SAMPLES_MAX`) is now derived from `SpscIpcQueue::MAX_MSG` instead of a fixed constant sized for one `rt_buffer_size`; the decimation step scales up with the hardware frame count so message size stays bounded regardless of buffer size. `SpscIpcQueue::push()` truncates (rather than reallocates) any message that still exceeds `MAX_MSG`, counting it via a new `oversize_drops` counter, with a debug assert catching any future regression at the source.
- **FR-EMU-3** — Every CoreAudio setup `OSStatus` (`EnableIO`, stream format, device selection, buffer-size set) is now checked, failing `start()`/`start_output_only()` cleanly instead of continuing with a half-configured `AudioUnit`. `AudioUnitRender` failures increment an atomic counter surfaced as a `render_error` IPC event alongside xrun reporting; the input hardware's queried sample rate is compared against the engine's configured rate, emitting `sample_rate_mismatch` on divergence.
- **FR-EMU-4** — `SessionRecorder` write failures (ENOSPC, EIO, ...) now set a `write_error_` flag, stop draining, and are reported via a `record_error` IPC event and `recordStop`'s `record_stopped` status reply, instead of silently producing a truncated `.dsrec` that looks complete.
- **FR-EMU-5** — `load_wav_file` validates the RIFF/WAVE magic from just the first 12 bytes and enforces a 256 MB size ceiling (via a checked `fstat`) before buffering the rest of the file, so a non-WAV multi-GB file fails immediately with bounded memory use instead of a multi-GB transient allocation.
- **FR-EMU-6** — `json_get()` now walks the JSON structure instead of substring-searching for `"key":`, so a key literal appearing inside an unrelated field's string value (e.g. a `path` containing `"type":`) can no longer be mistaken for the real key; a new `json_escape()` helper is applied to interpolated output (e.g. exception text) so quotes/backslashes in dynamic content never produce malformed outbound JSON.
- **FR-EMU-7** — `sample_rate`/`block_size` are now re-read from `g_state` at the top of each outer engine loop iteration; the `config` IPC handler bumps a `config_generation` counter and notifies `mode_cv` (matching `audioDevice`'s existing pattern) so the active mode loop restarts with fresh values — a mid-session `config` update now changes WAV playback rate and FFT bin labeling without requiring a mode toggle.
- **FR-EMU-8** — `SessionRecorder` gains a destructor that calls `stop()` (so a joinable `drain_thread_` is always joined, never `std::terminate()`s); `main.cpp` installs SIGTERM/SIGINT handlers (an async-signal-safe atomic store) and a dedicated shutdown-watcher thread that flushes/closes any active recording before exiting the process — since the effect's `while(1)` loop is not expected to ever return on its own, this is the only reliable point an IDE-initiated stop (SIGTERM, escalating to SIGKILL) has to finalize an in-progress recording with a clean `END` marker.

---

## 0.12.1 — 2026-07-03

**M37 — Extension/IPC Critical Reliability & Packaging** *(FR-EXT-1, FR-EXT-2, FR-PKG-1, FR-CODEGEN-1 — all DoD green)*

- **FR-EXT-1** — `EmulatorManager.deploy()`'s lock-cleanup promise rejection is now observed, so a failed deploy (missing build, emulator crash, socket timeout) never leaks an `unhandledRejection`; added a project-wide vitest `unhandledRejection` guard (`src/test/setup.ts`).
- **FR-EXT-2** — `killStalePid` verifies the target PID is actually an `effect_emu` process (via `ps -p <pid> -o comm=`) before signaling, and sends SIGTERM with a short escalation to SIGKILL instead of an immediate SIGKILL; sockets and the pid file live under a per-workspace directory (`os.tmpdir()/ds-ide-<hash>`, keyed by buildDir, with a randomized filename) instead of predictable global `/tmp`; activation cleanup is scoped to that directory only, never a global `/tmp` sweep.
- **FR-PKG-1** — `emulator/**` sources are now included in the packaged `.vsix` (only `emulator/**/build/**` output is excluded); removed the `images/icon.png` reference from `package.json` since no marketplace icon asset exists yet. Also fixed a packaging-hygiene bug found while verifying this milestone: `vsce` wasn't honoring `.gitignore`, so gitignored directories (`.ds-ide/` build cache, `.idea/`, `mockup/`, etc.) were being bundled into the `.vsix` — added the missing `.vscodeignore` exclusions and `scripts/verify-vsix.sh` as a repeatable packaging smoke test.
- **FR-CODEGEN-1** — The Wiring Editor now generates the canonical libDaisy pattern (`AdcChannelConfig ds_ide_adc_cfg[N]`, indexed `.InitSingle()` calls, `hardware.adc.Init(ds_ide_adc_cfg, N)`) instead of the non-portable variadic call shape; removed the emulator shim's variadic `Init(Args...)` overload that only existed to make the old generated code compile.

---

## 0.12.0 — 2026-07-03

**M36 — Emulator RT & Memory Safety Critical Fixes** *(FR-RTS-1 through FR-RTS-5 — all DoD green)*

- **FR-RTS-1** — `inputBufList` is now sized from the hardware's queried maximum deliverable frame count (`kAudioDevicePropertyBufferFrameSizeRange`), not the requested `bufferSize`; the render callback clamps writes to the allocated capacity as a defense-in-depth backstop.
- **FR-RTS-2** — RT-callback-visible buffers (`in_interleaved`, `out_interleaved`, `silentInput`, `workOut`) are sized before `AudioOutputUnitStart()` is called instead of being resized afterward while the render callback may already be running.
- **FR-RTS-3** — Replay audio moved off the RT thread: a dedicated reader thread performs all `.dsrec` file I/O and event parsing into a lock-free SPSC ring; the RT thread only pops pre-decoded blocks via `SessionPlayer::popBlock()` (no syscalls, no mutex, no allocation). WAV playback's `wav_mutex` + `shared_ptr` copy replaced with an atomic pointer swap (`wav_data_ptr` / `wav_data_in_use`), retired only after the engine confirms it has moved on.
- **FR-RTS-4** — `SessionRecorder::enqueueBlock()` now loads `active_` with `memory_order_acquire`, correctly pairing with `start()`'s release store; ring-buffer slots are pre-allocated once in the constructor instead of being resized in `start()`; an `in_flight_` counter closes the stop/start overlap window so no in-flight block can be silently dropped or misfiled at a session boundary.
- **FR-RTS-5** — `SessionRecorder::start()` rejects re-entrant calls while already active instead of crashing via a joinable-`std::thread` reassignment; the IPC `recordStart` handler now replies with a `record_error` event on rejection.

---

## 0.11.0 — 2026-06-30

**M35 — Activity Bar Split: Controls and Wiring as Independent Sidebar Views** *(FR-TWE-1 through FR-TWE-6, FR-ICON-1 through FR-ICON-2 — all DoD green)*

- Two dedicated Activity Bar icons replace the single DS-IDE launcher: knob SVG (`ds-ide-controls`) for the Controls Editor, DIP chip SVG (`ds-ide-wiring`) for the Wiring Editor.
- Both editors render as `WebviewView` panels in the Primary Sidebar; no editor-area tabs are created.
- `ControlsViewProvider` and `WiringViewProvider` implement `vscode.WebviewViewProvider`; registered via `registerWebviewViewProvider` with `retainContextWhenHidden: true`.
- Controls Editor auto-reveals on Build & Deploy via `executeCommand('workbench.view.extension.ds-ide-controls')`.
- `onDidChangeVisibility → true` flushes last-known state (pot config, wired pins) to the webview, preserving state across sidebar hide/show and window reload.
- Removed: `ds-ide-sidebar` view container, `ds-ide.launchView` welcome view, `ds-ide.openControlsEditor` and `ds-ide.openWiringEditor` commands.
- No mutual-exclusion logic; each editor has its own sidebar slot.

---

## 0.10.0 — 2026-06-29

**M34 — UI Polish: Independent Editors, Always-Visible Audio Settings, Panel Icons** *(FR-SCOPE-1, FR-TWE-1 through FR-TWE-6, FR-ICON-1 through FR-ICON-2 — all DoD green)*

- **FR-SCOPE-1** — Scope panel Audio Settings section is now always visible; removed collapsible toggle, arrow, and JS collapse logic.
- **FR-TWE-1/2** — Controls Editor and Wiring Editor promoted from sidebar `WebviewView` panels to independent `WebviewPanel` tool windows (`createWebviewPanel`); users can freely reposition, split, and close them.
- **FR-TWE-3** — Controls Editor auto-opens (or reveals) when deploying to the emulator (Play / Build & Deploy).
- **FR-TWE-4** — DS-IDE sidebar now shows a minimal welcome view with "Open Controls Editor" and "Open Wiring Editor" buttons (`ds-ide.openControlsEditor` / `ds-ide.openWiringEditor` commands).
- **FR-TWE-5** — Deleted `collapseSibling` mutual-exclusion hack, `onDidChangeVisibility` subscriptions, `registerWebviewViewProvider` calls, and `CONTROLS_VIEW_ID` / `WIRING_VIEW_ID` constants.
- **FR-TWE-6** — Panel state (pot positions, wired pins) is retained by the extension host and pushed to a freshly opened panel on reopen, without requiring a redeploy.
- **FR-ICON-1** — Controls Editor tab shows a circular knob SVG icon (dark + light variants).
- **FR-ICON-2** — Wiring Editor tab shows a DIP IC package SVG icon (dark + light variants).

---

## 0.9.2 — 2026-06-29

**M33 — Quality Polish** *(FR-QA-1 through FR-QA-20 — all DoD green)*

- **FR-RTS-2** — Pre-size RT working buffers to hardware-clamped frame count after `AudioOutputUnitStart`; first callback on USB devices with 512-frame minimum no longer produces xruns
- **FR-QA-1** — SPSC queue capacity raised from 32 to 64; `ipc_send` increments `g_state.ipc_queue_drops` on overflow
- **FR-QA-2** — Shared `src/ipc/narrow.ts` provides `getString`, `getBoolean`, `getNumber` guards; all `as T` casts on `IpcMessage` field accesses eliminated
- **FR-QA-3** — `sendPostDeployState()` helper consolidates duplicate post-deploy state blocks in `extension.ts`
- **FR-QA-4** — `SessionPlayer::countBlocks` checks `lseek` return values; corrupted `.dsrec` files produce partial block count with no crash
- **FR-QA-5** — IPC receive buffer capped at 1 MB; oversized clients are disconnected with a stderr diagnostic
- **FR-QA-6** — `ipc_server` validates socket path length before `strncpy`; paths ≥ 104 chars log and return early
- **FR-QA-7** — `decode_pcm32` uses `std::memcpy` for bit reinterpretation (defined behaviour in C++17)
- **FR-QA-8** — `truncId` injected via constant into the webview JS; no longer re-implemented as a duplicate string
- **FR-QA-9** — `detectNonPortableSymbol` returns all undefined symbols (was early-exit on first)
- **FR-QA-10** — Magic numbers replaced with named constants: `SOCKET_TIMEOUT_MS`, `IPC_MAX_BUFFER`, `DAP_TERMINATE_DELAY_MS`, CPU-count parallel jobs
- **FR-QA-11** — `DsIdeTerminatingAdapter.dispose()` clears the 50 ms terminate timer before disposing the emitter
- **FR-QA-12** — Pot channel/value, output volume, and audio-source enum validated before `manager.send*` calls
- **FR-QA-13** — `outputChannel` made required in `debugDeploy`; fallback `createOutputChannel` path removed
- **FR-QA-14** — Redundant `activationEvents` removed from `package.json`; VS Code ≥ 1.74 infers them from `contributes`
- **FR-QA-15** — CSP nonce regenerated on each `ScopePanel.show()` call instead of reusing the constructor value
- **FR-QA-16** — Wire/unwire `WorkspaceEdit` targets only the modified line ranges instead of replacing the entire file
- **FR-QA-17** — Info message shown once per session when operating on first folder of a multi-root workspace
- **FR-QA-18** — Single async `findEffectSource()` in `src/commands/find-effect-source.ts` replaces dual sync/async implementations
- **FR-QA-19** — `s_mach_ns_per_tick` stored in `Impl` struct and set before `AudioOutputUnitStart` (natural publication barrier)
- **FR-QA-20** — Webview JS extracted to typed TypeScript entry points (`controls-webview.ts`, `scope-webview.ts`, `wiring-webview.ts`); esbuild compiles them as separate bundles; extension injects URIs via `asWebviewUri`

---

## 0.9.1 — 2026-06-29

**M32 — Extension & Emulator Correctness** *(FR-PIN-1, FR-EXT-1/2/3/4/5, FR-PKG-1, FR-EMU-1/2/3 — all DoD green)*

- **FR-PIN-1** — Fixed `analogIndex` for D28: now correctly returns 11 (`daisy::seed::A11`); extracted `pinToAdcChannel()` as single source of truth in `controls-writer.ts` and the webview JS
- **FR-EXT-1** — Replaced all synchronous `fs.*Sync` / `cp.execSync` extension-host calls with `fs.promises.*` / promisified `cp.exec` equivalents across `toolchain.ts`, `debug-adapter.ts`, `build.ts`, `manager.ts`, and `extension.ts`
- **FR-EXT-2** — `deploy()` now returns the in-flight promise on concurrent calls instead of bare `undefined`, preventing false-success races on rapid redeploy
- **FR-EXT-3** — Added `contributes.configuration` to `package.json` so `ds-ide.effectSource` and `ds-ide.armToolchainPath` appear in the VS Code Settings UI
- **FR-EXT-4** — Webview `onDidReceiveMessage` and `onDidChangeVisibility` disposables are now stored and disposed in `onDidDispose` handlers in `ControlsViewProvider` and `WiringViewProvider`
- **FR-EXT-5** — Removed accumulating `mousemove`/`mouseup` document listeners in the controls webview; `clearDocListeners()` is called at the start of each render cycle
- **FR-PKG-1** — Added `@vscode/vsce` to `devDependencies`; `npm ci && npm run package` succeeds without a globally installed `vsce`
- **FR-EMU-1** — `parse_wav` validates `total_samples ≤ MAX_WAV_SAMPLES` before `resize`; a `try/catch` in `dispatch` converts unexpected exceptions to error IPC events instead of crashing the emulator
- **FR-EMU-2** — Removed the redundant `::close(client_fd)` from inside the `send_ipc` lambda; the cleanup block is now the single authoritative close site
- **FR-EMU-3** — `killStalePid` now polls `process.kill(pid, 0)` (up to 200 ms) after `SIGKILL` before spawning a replacement emulator, eliminating socket/audio-device acquisition races on rapid redeploy

---

## 0.9.0 — 2026-06-29

**M31 — Emulator RT-thread Safety** *(FR-RTS-1, FR-RTS-2, FR-RTS-3 — all DoD green)*

- **FR-RTS-1** — Session recorder writes moved off the CoreAudio RT thread. `enqueueBlock()` is a lock-free SPSC push; a dedicated drain thread handles all `::write()`, `flushPending()`, END-marker, and `::close()` calls. The RT callback no longer acquires `recorder_mutex`.
- **FR-RTS-2** — Heap allocation eliminated from the RT audio callback path. `SpscIpcQueue::MAX_MSG` raised from 16 kB to 81920 bytes (≥ maximum scope message size). `push(const char*)` overload avoids constructing temporary `std::string` for string-literal IPC sends. `build_scope_json` and `build_spectrum_json` write into pre-allocated `std::string&` buffers. FFT working buffers (`fft_work`, `mag_in_buf`, `mag_out_buf`) are pre-allocated in `FftState`; `magnitude_spectrum` is refactored to fill caller-owned buffers.
- **FR-RTS-3** — `emit_led_change` routes LED messages through `ipc_queue.push()` (SPSC, lock-free) instead of acquiring `send_mutex` and calling `send_ipc` directly, eliminating priority-inversion risk when `Led::Update` / `DaisySeed::SetLed` is called from the audio callback.
- 57 unit-test assertions across `emulator-safety` and `led-shim` suites, all green.

---

## 0.8.4 — 2026-06-21

**M30 — Extension Quality Polish** *(AC-70–AC-81 green)*

- **AC-70** — `safeJson` now escapes `&`, `<`, `>` in JSON-in-HTML data islands (XSS hardening)
- **AC-71** — Build diagnostics regex handles Windows `C:\...` drive-letter paths
- **AC-72** — `detectEffectSrc` falls back to `src/` and `source/` subdirectories
- **AC-73** — Removed dead `WiringPanel` class from `wiring-panel.ts`
- **AC-74/77** — Module-level singletons moved into `activate()`; `!` assertions eliminated; `deactivate()` is now a no-op (VS Code disposes subscriptions automatically)
- **AC-75** — Added `icon`, `repository`, `keywords`, `homepage`, and `"Debuggers"` category to `package.json`
- **AC-76** — Removed `retainContextWhenHidden: true` from both sidebar webview view providers
- **AC-78** — `extension.test.ts` uses dynamic imports for isolation; brittle `toBe(26)` subscription count replaced with targeted per-registration assertions
- **AC-79** — Confirmed `localResourceRoots: []` on all three webviews; covered by existing tests
- **AC-80** — Numeric HTML attributes (`freq`, `amplitude`, `bufferSize`, `wavLoop`) coerced before interpolation in `scope-panel.ts`; corrupted workspace state values fall back to defaults
- **AC-81** — Added prefix-collision test: `removeInitFromSource('vol')` does not delete `volume.Init(...)` line

---

## 0.8.3 — 2026-06-21

**M29 — Extension Runtime Reliability** *(AC-62–AC-69 green)*

- **IPC buffer overflow protection (FR-EQ-1)** — `IpcClient.onData` now caps `this.partial` at 1 MB; if exceeded, the buffer is cleared and an `'error'` event is emitted, preventing unbounded memory growth from a misbehaving emulator.
- **Deploy concurrency guard (FR-EQ-2)** — `EmulatorManager.deploy()` holds a `deployLock` promise; a second concurrent call returns early without spawning a second process.
- **Fail-fast deploy return value (FR-EQ-3)** — `deployToEmulator` returns `Promise<boolean>`; callers skip all post-deploy IPC calls and reset the status bar to "stopped" on failure.
- **Output channels created once (FR-EQ-4)** — Three named channels (`'Daisy IDE Build'`, `'Daisy IDE Emulator'`, `'Daisy IDE Hardware Build'`) are created during `activate()`, added to `context.subscriptions`, and passed to all command handlers — no more per-invocation channel creation.
- **Async activation path (FR-EQ-5)** — `findEffectSource`, `loadControllerConfig`, and `buildControlsConfig` now use `fs.promises.*`; `initViewsFromProject` is called fire-and-forget so `activate()` returns synchronously; `onDidSaveTextDocument` performs a synchronous path check before any I/O.
- **Debug session listener cleanup (FR-EQ-6)** — Disposables from `vscode.debug.onDidStartDebugSession` and `vscode.debug.onDidTerminateDebugSession` are now pushed to `context.subscriptions`.
- **ScopePanel listener leak fixed (FR-EQ-7)** — Manager `'message'` handler stored as `_onManagerMessage` private field; `dispose()` calls `manager.off('message', this._onManagerMessage)` to prevent listener accumulation.
- **Controls-writer edge-case tests (FR-EQ-8)** — Four new tests: init-block insertion position when decl block is present but init block absent; multi-control line preservation on remove; 3→2 pot adc.Init regeneration; duplicate-ID annotation cleanup.
- 22 new unit tests across ipc-client, manager, extension, scope-panel, and controls-writer.

---

## 0.8.2 — 2026-06-21

**M28 — Webview Security Hardening** *(AC-60, AC-61 green)*

- **CSP nonce on all three webviews (FR-ES-1)** — `ScopePanel`, `ControlsViewProvider`, and `WiringViewProvider`/`WiringPanel` now generate a per-instance `crypto.randomBytes(16)` nonce; each webview HTML carries a `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-{nonce}'; style-src 'unsafe-inline';">` tag and every `<script>` block bears a matching `nonce` attribute. `localResourceRoots: []` is set on all `WebviewPanel`/`WebviewView` options that load no file-system resources.
- **Host-side message validation (FR-ES-2)** — Incoming webview messages are validated before any side-effecting operation: `wirePin`/`unwirePin` check `pinNumber` (finite integer 0–31), `deviceType` (`'pot' | 'button' | 'led'`), and `id` (regex `^[a-zA-Z_][a-zA-Z0-9_]*$`); `editorSave` round-trips the received `cfg` through `serializeControllerConfig` → `parseControllerConfig` before calling `onEditorSave`; `audioSource` validates `sampleRate` ∈ `[8000, 22050, 44100, 48000]` and `bufferSize` ∈ `[64, 128, 256, 512]`. Invalid messages are dropped silently.
- 23 new unit tests (FR-ES-1 CSP/nonce/localResourceRoots assertions across all three providers; FR-ES-2 boundary and rejection scenarios)

---

## 0.8.1 — 2026-06-21

**Showcase + bug fixes**

- **Tremolo-filter showcase** (`examples/showcases/tremolo-filter/`): new end-to-end showcase effect — sine LFO tremolo + DaisySP `Svf` resonant filter, 4 pots (Rate/Depth/Cutoff/Resonance), toggle bypass button, beat LED that blinks in sync with the LFO; designed to demonstrate the full ds-ide workflow to evaluators
- **Fix: LED updates not reaching the Controls Editor** — `type: 'led'` IPC messages from the emulator were routed only to the Scope Panel webview; the Controls Editor webview had `applyLed()` wired up but no path to call it; added `postLed()` to `ControlsViewProvider` and wired it in `extension.ts`
- **Fix: Controls Editor stuck in design mode after stop + start** — `lastKnownRunning` in `EmulatorManager` was a closure-local variable; `sendTransport('stop')` never reset it, so the synthesised `running:true` event was suppressed on the next start; promoted to a class field and reset on `sendTransport('stop')`

---

## 0.8.0 — 2026-06-21

**M27 — Controls Editor UI Polish & View Exclusivity** *(AC-58 green; AC-59 best-effort)*

- **Compact convention-mode cards (AC-58/FR-CE-10):** `buildConventionCard()` redesigned — kind badge and pin label removed from handle; handle now shows `title` tooltip with `"Kind · pin N"`; IDs > 15 chars truncated with `…` (full ID in span title); `.ctrl-body` vertically centered; button body is a square raised pad with `box-shadow: 0 3px 0 #111` (pressed state collapses shadow + `translateY(3px)`); LED body reduced to dot only; toggle-mode buttons latch visually after mouseup; convention cards have `minWidth: 90px`
- **View exclusivity (FR-VW-1):** `onDidChangeVisibility` wired in both providers; when Controls Editor expands and Wiring Editor is open, a three-step command sequence (focus sibling → `workbench.action.collapseSection` → refocus self) attempts to collapse the sibling; symmetric for Wiring Editor; re-entry guard prevents infinite loops. **Known limitation:** VS Code exposes no public API to programmatically collapse a `WebviewView` section — the workaround is best-effort and may not fire reliably in all VS Code builds.

---

## 0.7.0 — 2026-06-21

**M26 — View State Initialization & Pinout Accuracy** *(AC-55–AC-57 green)*

- **Controls Editor init on project open (AC-55/FR-CE-9):** `activate()` now calls `initViewsFromProject()` immediately — parses `ds-ide:controls` block and `controllers.yaml`, pushes `controlsConfig` to the Controls Editor webview without requiring deployment
- **Wiring Editor init on project open (AC-56/FR-WE-11):** Same `initViewsFromProject()` call parses the `ds-ide:controls` block and pushes `wiredPins` to the Wiring Editor SVG on extension activation
- **File-save refresh (AC-55/AC-56):** `onDidSaveTextDocument` watcher registered at activation; saving the effect C++ source or `controllers.yaml` re-parses and pushes updated state to both views within ~1 second
- **Pinout accuracy (AC-57/FR-WE-12):** `PIN_DEFS` rebuilt to match `Seed_pinout.csv` exactly — left side rows 0–14 = D0→D14 (USB at top), rows 15–19 = NC audio/AGND; right side rows 0–19 = GND, VIN, 3V3D, D30, D29, A11/D28, D27, D26, A10/D25…A0/D15, +3V3A; D28 correctly carries A11/ADC, D26 is non-ADC; `adcChannelFromPin` updated (D15–D25 → ch0–10, D28 → ch11)

---

## 0.6.0 — 2026-06-21

**M25 — Emulator Runtime Safety & Code Quality** *(AC-38–AC-54 green)*

- **RT thread safety (AC-38/39/40):** `in_interleaved`/`out_interleaved` promoted to pre-allocated `Impl` members; all audio-engine IPC sends routed through a lock-free SPSC queue drained by a dedicated non-RT thread; `ScopeState::accumulate` hard-capped at 65536 samples to prevent RT heap reallocation
- **Allocation safety (AC-41):** `CoreAudioDevice::start()` checks each `malloc` return; on null calls `stop()` and returns false before any `AudioUnitRender`
- **WAV parsing (AC-42/52):** `parse_wav` rejects `bits == 0` before `total_samples` division; `rd_u16`, `decode_pcm24` cast bytes to `uint32_t` before shifting to eliminate integer-promotion UB
- **IPC reliability (AC-43/44/45):** `sampleRate` validated in `[100, 384000]`, `blockSize` in `[1, 65536]` with IPC error events on rejection; `json_get` adds nesting-depth limit (8) and escaped-quote handling; all `stof`/`stoi` calls wrapped in try/catch with stderr warnings; `::send()` return checked — client fd closed and flagged on error
- **Session correctness (AC-46/47):** `recorder_mutex` held across `active()` + `enqueuePot/enqueueButton` in `dispatch()` eliminating TOCTOU; `lseek` return checked in `nextBlock` and `open()`; `block_size > 65536` rejected in `open()`
- **GPIO aliasing (AC-48):** `canonical_gpio_index(port*32+pin)` replaces bare `pin.pin`; `Switch`/`Led` shims updated; `kNumGpioPins` expanded to 64 — A6–A11 no longer alias D0–D5
- **Build quality (AC-49):** `ASAN` and `TSAN` opt-in CMake options with mutual-exclusivity guard and `message(FATAL_ERROR)` on conflict
- **Low-severity quality (AC-50–54):** Redundant `delete impl_` removed from destructor; `AudioOutputUnitStop` drain guarantee documented; `mach_timebase_info` return checked with 1.0 fallback; `run_simulated` silent loop subtracts elapsed execution time from sleep
- **New:** `tests/emulator-safety/` — 50 unit assertions covering all testable ACs (all green)

---

## 0.5.1 — 2026-06-20

**M24 — Init Block Code Generation** *(AC-37 green)*

- Wiring Editor now writes and maintains a `// ds-ide:controls:init:begin` … `// ds-ide:controls:init:end` block alongside the declaration block in the effect source
- Adding a pot inserts `<varname>.InitSingle(daisy::seed::A<n>)` and regenerates the aggregate `hardware.adc.Init(<cfgs>, <count>)` call; pot configs are listed in insertion order to preserve ADC channel mapping
- Adding a button inserts `<varname>.Init(daisy::seed::D<pin>, hardware.AudioCallbackRate())`
- Adding an LED inserts `<varname>.Init(daisy::seed::D<pin>, false)`
- Removing any device deletes its init line; removing a pot regenerates `hardware.adc.Init()` or removes it when no pots remain
- Init block is created if absent (inserted after `// ds-ide:controls:end`); existing block is never duplicated
- All writes are VS Code `WorkspaceEdit` (fully undoable)
- Wiring Editor SVG updates live via `postMessage` after each pin assignment/removal (fix for sidebar `WebviewView` visibility timing)
- Emulator shim extended: `daisy::seed::D0`–`D30` pin constants added; `DaisySeed::AudioCallbackRate()` added; `AdcHandle::Init` variadic overload added for generated `hardware.adc.Init(cfg1, cfg2, n)` pattern

---

## 0.5.0 — 2026-06-20

**M23 — Effect Project Wizard** *(AC-36 green)*

- New command `ds-ide: Create New Effect Project` scaffolds a ready-to-use ds-ide effect project from scratch
- Prompts for a project name (validated as a valid C++ identifier) and a destination folder
- Writes four files: `<name>.cpp` (with `// ds-ide:controls:begin/end` block and `AudioCallback` skeleton), `CMakeLists.txt` (emulator build placeholder), `controllers.yaml` (empty controls list), and `README.md` (getting-started instructions)
- Opens the newly created folder in VS Code automatically
- Invalid names (empty, starting with a digit, containing spaces) are rejected inline before any files are written

---

## 0.4.3 — 2026-06-20

**M22 — Secondary Sidebar Panels** *(AC-34, AC-35 green)*

- Controls Editor moved from the floating Daisy Scope `WebviewPanel` into a persistent `WebviewView` in the new **DS-IDE** Activity Bar sidebar (always visible, no command needed)
- Wiring Editor converted from a floating `WebviewPanel` to a persistent `WebviewView` in the same sidebar; `ds-ide: Open Wiring Editor` now reveals/focuses the view rather than creating a new floating panel
- Both views use `retainContextWhenHidden: true` so state is preserved across sidebar hide/show cycles
- Fixed running-state inference: the manager now synthesises a `status:{running:true}` event from the first scope/spectrum message after `running:false`, so the Controls Editor bodies and Scope panel header correctly update to "▶ Running" (the emulator protocol sends audio data without an explicit acknowledgment)
- Fixed convention-mode save: "Save controllers.yaml" now synthesises yaml entries from the detected source-code controls when `controllers.yaml` is absent or empty, rather than writing empty arrays

---

## 0.4.2 — 2026-06-20

**M21 — VS Code Run Command Integration** *(AC-32, AC-33 green)*

- Pressing **F5** with a `ds-ide` launch configuration now triggers the full build→deploy→attach flow: the emulator is stopped (if running), the effect is built, deployed, and `lldb-dap` attaches — Debug toolbar appears
- Pressing **Ctrl+F5** (Start Without Debugging) triggers build→deploy without attaching lldb; emulator runs freely, no Debug toolbar
- Build failure surfaces in the Output panel and aborts deploy/attach (no broken session)
- Default `launch.json` snippet (`DS-IDE: Build, Deploy & Debug`) is offered automatically when adding a debug configuration for the `ds-ide` type
- Implemented via `DaisyRunConfigurationProvider` (new `src/debug/run-config-provider.ts`) + `DsIdeDebugAdapterDescriptorFactory` providing an inline terminating adapter so VS Code's descriptor pre-check passes
- Added explicit `onDebugResolve:ds-ide` activation event to ensure the extension is active before VS Code attempts the descriptor check on first F5 press

---

## 0.4.1 — 2026-06-20

**M20 — Controls Editor single-mode handle UX** *(AC-24, AC-25 green; AC-18 retired)*

- Controls Editor redesigned from two-mode (Design / Run toggle) to single-mode handle UX (D19): each control card has a **drag handle ⠿** always available for rearrangement, and a **live body** (pot knob, button, LED) gated on emulator audio state (AC-24)
- Control bodies are grayed-out (`opacity: 0.35`, `pointer-events: none`) when audio is stopped, and become fully interactive when audio is running — no explicit mode switch required
- CE body state activates optimistically on **Start Audio** click and deactivates on **Stop Audio** click (mirrors T19-2 button behaviour); corrected by emulator `status` message
- Pot controls rendered as **rotary SVG knobs** (52×52 px, 270° range, teal `#4ec9b0` arc + dot indicator) replacing the previous slider; **vertical drag** (up = increase, down = decrease) at 100 px per unit (AC-25)
- Knob L&F matches Wiring Editor palette (dark background, teal accent, monospace value readout)
- `switchTab('editor')` re-applies current emulator state when the Controls Editor tab is opened
- AC-18 (D18 two-mode panel) explicitly retired; replaced by AC-24

---

## 0.4.0 — 2026-06-20

**M19 — UX polish & command improvements** *(AC-26…AC-31 green)*

- New `ds-ide.buildAndDeploy` command executes build-for-emulator then deploy sequentially; deploy is skipped on build failure (AC-26)
- Scope view header now has **Start Audio ▶** and **Stop Audio ■** toolbar buttons; state reflects emulator running/stopped; buttons update optimistically on click (AC-27)
- Session recording button labels simplified to glyph-only `●` / `■` (removed "Record" / "Stop" text) (AC-28)
- Wiring Editor assigned-pin ID labels repositioned to the connector-zone midpoint (x=126 left, x=434 right, y=cy−7) — no longer overlapping the pin circle (AC-29)
- Micro USB port trapezoid indicator added to the top of the Daisy Seed SVG diagram for board-orientation reference (AC-30)
- Duplicate xrun-display elements removed from the Emulator section body; xruns counter shown only in the Scope header status line (AC-31)
- `buildForEmulator` now returns `Promise<boolean>` for correct chaining
- TypeScript: early-return paths in `build.ts` now return `false` instead of `undefined`

---

## 0.3.3 — 2026-06-19

**M18 — Wiring Editor: Daisy Seed pinout SVG with click-to-assign** *(AC-19, AC-23 green)*

- New `ds-ide.openWiringEditor` command opens a VS Code webview panel showing the full Daisy Seed 40-pin layout
- Click any unassigned pin to open a device-selection popup (Pot / Button / LED) with a non-ADC warning badge when appropriate
- Click an assigned pin to view its device type and id, with a Remove button
- Wiring writes / removes C++ declarations in the `// ds-ide:controls` block via undoable `WorkspaceEdit`
- Wiring Editor and Controls Editor stay in sync: assigning or removing a pin updates both panels
- New module `controls-writer.ts` (pure, no VS Code deps) — `insertIntoSource` / `removeFromSource`

---

## 0.3.2 — 2026-06-19

**M17 — Controls Editor v3: two-mode panel with ds-ide:controls convention** *(AC-18, AC-22 green)*

- **T17-1 — C9 convention parser** (`src/controllers/controls-convention-parser.ts`): pure TS function that locates the `// ds-ide:controls:begin … // ds-ide:controls:end` block in C++ source and extracts `{id, kind, pin}` annotations; returns `missingBlock: true` when absent. 14 unit tests.
- **T17-2 — Wire C9 into extension host:** on `deploy` and `openControllerEditor` the effect source is parsed and a `controlsConfig` message (controls + YAML placements + missingBlock flag) is sent to the Controls Editor webview. `webviewReady` handshake + `lastStatusMsg` replay ensure the message arrives after HTML regeneration.
- **T17-3 — Controls Editor two-mode panel:** renamed from "Controller Editor"; Design mode shows draggable convention-card canvas; Run mode shows interactive sliders, buttons, and LED indicators wired to existing IPC channels; amber banner when convention block is absent. Effect-section collapsible removed (superseded by Run mode).
- **`examples/m17-demo/`:** reference project demonstrating the full convention block workflow.
- **Known issue (deferred):** Controls Editor auto-switch to Run mode on audio start is unreliable; manual mode toggle works correctly. Logged in `docs/01_input-ideas.md` for a dedicated fix round.

---

## 0.3.1 — 2026-06-19

**M16b — Speaker output in simulated mode** *(AC-22, AC-23, AC-24 green)*

- **T16b-1 — Output-only CoreAudio device:** `CoreAudioDevice::start_output_only()` opens the AUHAL output bus without enabling the input bus, so no microphone permission is required.
- **T16b-2 — CoreAudio-driven simulated loop:** `run_simulated()` now opens an output-only CoreAudio device and processes audio from the render callback; sine and WAV modes are now audible from the system speakers. Silent fallback retained for headless/CI environments.
- **`examples/m16b-demo/`:** passthrough demo effect for verifying audio output end-to-end.
- `.gitignore`: tightened `examples/` rule to only ignore build dirs and screenshots.

---

## 0.3.0 — 2026-06-19

**M16 — v3 Polish & Bug Fixes** *(AC-20, AC-21 green — FR-VZ-4, FR-UI-1)*

- **T16-1 — Spectrum axis layout:** introduced LEFT (36 px), BOTTOM (16 px), and TOP (4 px) margins in `drawSpectrum`; dB labels now sit to the left of the plot area (right-aligned in the margin) and freq labels sit below an explicit x-axis baseline; the spectrum curve no longer extends past the baseline (AC-20).
- **T16-2 — Scope panel border:** added `border: 1px solid #3c3c3c` to the webview `body` so the Scope panel has a visible border on all sides without clipping scope content (AC-21).
- Added `mockup/scope.html` — standalone browser-renderable mockup for iterating visuals without the VS Code extension.

---

## 0.2.9 — 2026-06-19

**M15 — Scope UI refresh** *(AC-17 green — FR-AU-7, FR-AU-9, FR-AU-10)*

- **T15.1 — Input source dropdown:** replaced the three radio buttons with a `<select>` dropdown (Sine / Live (mic) / WAV); state preserved across source switches.
- **T15.2 — Collapsible footer sections:** footer split into *Effect controls* (expanded by default) and *Emulator* (collapsed by default); each header toggles its body and calls `resize()` so the canvas fills available space.
- **T15.3 — Context-sensitive emulator bar:** all emulator controls merged into a single inline `#emulator-bar`; sine/wav/live/buffer/latency/xrun groups shown only when relevant to the active source; recording controls always visible with a stronger visual divider.
- **T15.4 — Master output volume:** `Vol` slider in the scope header sends `outputVolume` IPC; emulator applies the scaling factor to `out_buf` in both `run_simulated()` and `run_realtime()` before the CoreAudio write.
- No regression to AC-1…AC-16. 257/257 tests green.

---

## 0.2.8 — 2026-06-19

**M12 — Hardware build & flash** *(AC-13 green — FR-HW-1…FR-HW-4)*

- **T12.4 validated on real hardware:** end-to-end build + DFU flash confirmed on macOS Apple Silicon with a physical Daisy Seed. `arm-none-eabi` toolchain detection, `make` invocation, and `dfu-util` flash all work as expected.
- **dfu-util exit code fix:** `dfu-util` exits with code 74 after a successful flash because the Daisy Seed resets before the post-leave `get_status` poll completes. `runDfuUtil` now treats any flash where `"File downloaded successfully"` was emitted as a success, regardless of exit code.
- No regression to AC-1…AC-15. 249/249 tests green.

---

## 0.2.7 — 2026-06-18

**M14 — Session recording** *(AC-16 green — FR-REC-1…FR-REC-3)*

- **Binary .dsrec format (T14.1):** 16-byte header (`DSREC\0` magic + version + sample rate + block size) followed by typed records: `AUDIO_BLOCK` (0x01), `POT_EVENT` (0x02), `BUTTON_EVENT` (0x03), `END` (0xFF). Only input is stored; output is re-generated on replay.
- **Record mode (T14.2):** `SessionRecorder` in `emulator/runtime/`. IPC thread enqueues pot/button events via `enqueuePot()`/`enqueueButton()`; audio engine flushes the queue before each block with `writeBlock()`. IPC commands: `recordStart` (with file path) / `recordStop`.
- **Replay mode (T14.3):** `SessionPlayer` pre-scans block count on open for progress reporting; `nextBlock()` feeds the stored audio buffer as input and fires stored pot/button events back into emulator state. Wired into `run_simulated` as the replay input source; emits `replayDone` when exhausted. IPC commands: `replayStart` / `replayStop`. Verified by `tests/runtime/test_recording.py`: 0.00% output difference live vs replay (AC-16 green).
- **Recording bar UI (T14.4):** a row of controls below the audio-source bar — **Record** (opens Save dialog, lights red when active), **Stop**, **Replay file…** (opens Open dialog). `notifyRecordingState()` + `replayDone` IPC message update button states. Extension wired via `showSaveDialog`/`showOpenDialog` → `EmulatorManager.sendRecord*/sendReplay*`.
- **Tests:** 6 new TS unit tests (recording bar elements; `recordStart/Stop/replayStart` callbacks; `replayDone` forwarding; `notifyRecordingState`). 249 total, all green. 1 new Python integration test (AC-16 passthrough passthrough fixture). No regression to AC-1…AC-15.

---

## 0.2.6 — 2026-06-18

**M13 — Spectrum & FFT** *(AC-14 green — FR-VZ-1)*

- **Inline radix-2 FFT (T13.1):** Cooley-Tukey radix-2 FFT implemented directly in `audio_engine.cpp` — no third-party dependency or CMake changes required.
- **FFT compute & IPC (T13.2):** a 1024-sample Hann-windowed magnitude spectrum is computed per audio block for both the input and output channels. Emitted as a `spectrum` IPC message (`in_fft[]`, `out_fft[]`, `binHz`). Sent from both simulated and real-time clock modes. Verified by `test_spectrum.py`: sine at 440 Hz produces a peak at the correct FFT bin with SNR ≈ 220×, confirming AC-14.
- **Spectrum view (T13.3):** a second canvas below the waveform scope draws the input (teal) and output (orange) magnitude spectra with a linear frequency axis up to 20 kHz, dB amplitude grid, and labeled frequency landmarks (1k, 2k, 5k, 10k, 20k Hz).
- **Tests:** 4 new TS unit tests (`spectrum` canvas present; `spectrum` IPC forwarded; no crash if panel closed; `drawSpectrum` / `lastSpecIn` present in HTML). 243 total, all green. 1 new Python integration test (AC-14 FFT spike). No regression to AC-1…AC-13.

**M12 — Hardware build & flash** *(T12.1–T12.3 — see 0.2.8 for full AC-13 closure)*

- **Hardware build (T12.1):** `HardwareBuildDriver` (C7) detects the `arm-none-eabi-g++` toolchain via user setting, `PATH`, and known Homebrew paths; spawns `make` in the project root; parses GCC diagnostics into VS Code Problems panel. `Daisy IDE: Build for Hardware` command registered.
- **Toolchain detection (T12.2):** ordered probe with a clear install-hint notification if no toolchain is found. Covers FR-HW-2 / R16.
- **DFU flash (T12.3):** `DfuFlashDriver` (C8) detects `dfu-util`; spawns `dfu-util -D <bin>` against a Daisy in bootloader mode; streams progress output to the terminal. `Daisy IDE: Flash to Hardware (DFU)` command registered. Covers FR-HW-3 / R17.

---

## 0.2.4 — 2026-06-18

**M11 — Full debug** *(AC-12 green — FR-DB-7…FR-DB-10)*

- **DAP stepping (T11.1):** step over, step into, and step out work natively in the VS Code debug toolbar via the existing lldb-dap attach session — no additional extension code required.
- **Variables / watch / call stack (T11.2):** VS Code Variables, Watch, and Call Stack panels populate automatically from lldb-dap responses when paused at a breakpoint.
- **Mute-on-breakpoint (T11.3, R15 mitigation):** `MuteOnBreakpointTracker` (a `DebugAdapterTracker`) intercepts DAP `stopped` events and sends `audioMode: simulated` to the emulator, preventing xruns while lldb holds the audio thread. Resumes `audioMode: realtime` on `continued`, `exited`, or `terminated` events. `DaisyDebugAdapterTrackerFactory` registered in the extension for `daisy-debug` sessions.
- **Tests:** 10 new unit tests for `MuteOnBreakpointTracker` and `DaisyDebugAdapterTrackerFactory`; extension subscription count and mock updated. 209/209 pass. AC-12 green; no regression to AC-1…AC-11.

---

## 0.2.3 — 2026-06-18

**M10b — Visual controller editor** *(AC-15 green — FR-VE-1…FR-VE-4)*

- **Tab bar (C2):** the Scope panel gains a `Scope | Controller Editor` tab bar; both tabs share the same VS Code webview panel — no second window needed.
- **Palette sidebar (FR-VE-4):** three draggable chips — Pot, Button, LED — dropped onto the canvas instantiate a new control with a default id, label, and first available pin.
- **Free-form canvas (FR-VE-1):** placed controls are absolutely-positioned, draggable cards. Drag by the card header; position updates live.
- **Pin wiring UI (FR-VE-2):** each card exposes inline editing for label, ID, and pin assignment (ADC channel 0–11 for pots; GPIO pin 0–31 for buttons/LEDs), plus taper and mode selectors where applicable. A delete button removes the control from the canvas.
- **YAML round-trip (FR-VE-3):** `editor_pos: [x, y]` added as an optional field to all three controller sections; the runtime parser ignores it (backward-compatible). `serializeControllerConfig()` writes a deterministic YAML including positions. Clicking **Save controllers.yaml** sends the canvas state to C1, which writes the file.
- **Command:** `Daisy IDE: Open Controller Editor` reads `controllers.yaml`, parses it, and loads the canvas — existing controls appear at their saved positions.
- **Tests:** 10 new unit tests for `editor_pos` parsing and round-trip serialization (including label quoting and fractional position rounding); extension subscription count updated. 199/199 pass. AC-15 green; no regression to AC-1…AC-11.

---

## 0.2.2 — 2026-06-18

**M10 — Virtual buttons, GPIO & LEDs** *(AC-11 green — FR-CT-7…FR-CT-14)*

- **YAML schema (C1):** `controllers.yaml` gains two new top-level sections: `buttons:` (fields `id`, `label`, `gpio_pin`, `mode` `momentary`|`toggle`, `active_level` `high`|`low`; defaults applied) and `leds:` (fields `id`, `label`, `gpio_pin`). The existing `controllers:` (pots) section is unchanged — v1 files load without modification (CR-6). YAML inline comments are now correctly stripped from unquoted scalar values.
- **Switch shim (C5/C4):** real `Switch::Init/Debounce/Pressed/RisingEdge/FallingEdge` backed by `EmulatorState::button_states[32]`. `Debounce()` samples the IPC-backed atomic button state at call time (no debounce thread); edge detection follows the effect's own call rate — matching the hardware contract.
- **Led shim (C5/C4):** `Led::Init/Set/Update` emits change-deduped `led{gpioPin,lit}` IPC on `Update()` (`lit = brightness>0 XOR invert`). `DaisySeed::SetLed(bool)` routes to the declared onboard LED (pin 23).
- **IPC protocol (C4):** inbound `button{gpioPin,pressed}` and `buttonSnapshot{array}` drive the button state table; outbound `led{gpioPin,lit}` reports LED state changes.
- **Scope panel (C2):** a `Buttons:` row renders one control per declared button — momentary (held) posts press/release on mousedown/mouseup; toggle latches on click. A `LEDs:` row shows a lit/unlit dot indicator per declared LED, driven by incoming `led` IPC.
- **ButtonStore (C1):** toggle button state persists across re-deploys via `workspaceState`; momentary buttons reset to released on re-deploy (FR-CT-11).
- **Extension wiring (C1):** `loadControllerConfig()` passes buttons + LEDs to `show()`; `buttonSnapshot` is sent after deploy and debug-attach alongside the existing `potSnapshot`.
- **Example:** `examples/m10-demo/` — `button_bypass.cpp` effect (toggle mute / boost) with matching `controllers.yaml`.
- **Tests:** C++ unit suites `tests/switch-shim/` and `tests/led-shim/`; Python runtime integration `tests/runtime/test_buttons.py` (AC-11a: button press flips muted→pass-through; AC-11b: `SetLed` drives `led{pin:23}` on/off; 6/6 pass). 189 TypeScript unit tests across 13 files; all pass. AC-1…AC-10 no regression.

---

## 0.2.1 — 2026-06-18

**M9 — WAV file input** *(AC-10 green — FR-AU-6, FR-AU-7)*

- **WAV reader (C4):** new self-contained `wav_reader.h/cpp` — a RIFF/WAVE parser decoding 8/16/24/32-bit integer PCM and 32-bit IEEE float, mono or multi-channel, normalized to float. No new dependency (per 04 §2.3 / CR-7).
- **WAV playback into the simulated clock (C4):** `wav_fill_stereo_block()` renders interleaved-stereo blocks from the loaded file — linear resampling to the engine rate, mono→stereo duplication, and loop / one-shot handling (silence past end). The simulated loop feeds WAV into the input buffer when WAV input is active, otherwise the sine generator (unchanged).
- **IPC `wavFile` message:** `{path, loop}` dispatch in `ipc_server` loads and activates WAV input; an empty path deactivates it (runtime reverts to sine); a load failure emits a `wav_error` event. `EmulatorManager.sendWavFile()` added on the extension side.
- **Scope panel (C2):** WAV input radio enabled; `Choose WAV…` button (native open dialog driven by the extension), chosen-file label, and a loop toggle. The selection persists across re-deploys; `wav_error` surfaces a clear message in the panel.
- **Audio source mode:** sine/WAV run in simulated-clock mode (scope/regression source — no host-speaker output by design; speakers remain the realtime/live-input path from M8).
- **Tests:** new `tests/wav-reader/` C++ unit suite (parser + playback: resampling, loop-wrap, one-shot silence, mono dup); `tests/runtime/test_wav.py` integration test (AC-10 — WAV → bypass → output scope matches, with stereo L/R mapping, then reverts to sine). 155 unit tests across 12 files (9 new); all pass. 5 Python runtime integration tests pass (AC-1…AC-9 no regression). AC-10 green.

---

## 0.2.0 — 2026-06-18

**M8 — Real-time audio I/O** *(AC-9 green — FR-AU-5, FR-AU-7, FR-AU-8, FR-AU-9, NFR-11, NFR-12)*

- **CoreAudio duplex I/O (C4, macOS):** new `core_audio_device.h/cpp` wraps a AUHAL AudioUnit with explicit default-input-device selection and hardware channel count query (handles mono microphones correctly). Output render callback pulls live mic input via `AudioUnitRender`, runs the effect, and writes to host speakers.
- **Two-mode audio clock (C4):** `run_audio_engine()` now dispatches to a simulated path (v1 sleep-paced loop, unchanged) or a realtime path (CoreAudio OS-callback driven) based on `g_state.audio_mode`. Mode switches atomically without stopping the engine thread. Simulated mode (sine/WAV) and all AC-1…AC-8 tests are unaffected.
- **Mute-on-breakpoint stub (C4):** `audioMode: simulated` IPC message switches the engine to simulated mode; `audioMode: realtime` resumes. M11 will wire the DAP `stopped` event to trigger this.
- **IPC additions:** `audioMode` (simulated|realtime) and `audioDevice` (sampleRate, bufferSize) inbound messages; `xrun` and `latency` outbound messages emitted by the realtime engine.
- **CMake:** CoreAudio and AudioToolbox frameworks linked on Apple platforms; `core_audio_device.cpp` added to `RUNTIME_SRC`.
- **Extension (C1):** `EmulatorManager.sendAudioMode()` and `sendAudioDevice()` added; audio source state (`audioSource`) persisted to `workspaceState` and sent after every deploy alongside sine and potSnapshot.
- **Scope panel (C2):** audio source selector row (sine / live / WAV-stub for M9); buffer size picker (64/128/256/512 samples); live xrun counter and round-trip latency display; canvas `resize()` now called on first show (fixes blank scope regression).
- 146 unit tests across 12 test files (14 new); all pass. 4 Python runtime integration tests pass (AC-1…AC-8 no regression). AC-9 green (live mic through effect to speaker, verified manually).

---

## 0.1.7 — 2026-06-17

**M7 — Block-form callback (v1.1)** *(AC-8 green — FR-RU-2 / FR-SH-2 complete)*

- Added `block_cb` field to `EmulatorState`; implemented `DaisySeed::StartAudio(AudioHandle::AudioCallback cb)` shim overload (C5) — previously a no-op stub. Covers FR-SH-2 (block part).
- Extended `audio_engine.cpp` (C4): detects which callback type was registered, deinterleaves the canonical input buffer into per-channel arrays, dispatches the block-form callback with `const float* const*` / `float* const*` views, then re-interleaves the output back into the canonical buffer. NaN/clip scan, scope tap, soft-paced clock, and sine generator are unchanged (validates the 04 §4.1 one-canonical-buffer assumption). Covers FR-RU-2 (block part).
- Scope IPC JSON extended with `out_r` (right-channel output) — additive, backward-compatible. Enables block-form effects that write to channel 1 (e.g. `inout`) to be verified via the IPC stream.
- Added `tests/runtime/test_inout.py`: builds `inout` (block-form example), verifies block callback dispatches, left-channel output is silent, right-channel output (`out_r`) tracks ADC0 (volume pot). AC-8 green.
- Updated `tests/runtime/build_and_test.sh`: adds inout to the test suite (4/4 pass including bypass, determinism, Osc). No regression to the interleaved corpus.

---

## 0.1.6 — 2026-06-17

**M6 — v1 polish & release** *(AC-1…AC-7 all green — v1.0 complete)*

- Added `LICENSES.md`: tracks libDaisy (MIT), DaisySP (MIT), and lldb-dap (Apache 2.0 with LLVM exceptions); notes that neither libDaisy/DaisySP nor lldb-dap are bundled in the extension. Covers NFR-10.
- Updated `src/webview/scope-panel.ts`: added sine frequency (20–20 000 Hz, default 440 Hz) and amplitude (0–1, default 0.50 ≈ −6 dBFS) controls to the scope panel; wired webview `sine` messages to `manager.sendSine()`; added `SineChangeHandler` callback; added "xruns: n/a" to the runtime status text; added a getting-started state (workflow steps shown before first deploy) and replaced the canvas with instructions until the first `status` IPC message arrives. Covers FR-AU-2, FR-RU-5, NFR-9.
- Updated `src/extension.ts`: loads and persists sine state (`ds-ide.sine`) via `workspaceState`; passes initial sine params to `scopePanel.show()` on deploy; sends `sendSine()` after every deploy (including debug deploy). Covers FR-AU-2, FR-CF-1.
- Updated `src/commands/debug-deploy.ts`: accepts an optional `sendSine` callback invoked after deploy, keeping sine replay consistent across Run and Debug modes.
- Updated `package.json`: added `keybindings` for build (⌘⇧⌥B), deploy (⌘⇧⌥D), start (⌘⇧⌥R), stop (⌘⇧⌥S). Covers NFR-9.
- 132 unit tests across 12 test files; all pass. Full v1.0 AC sweep (AC-1…AC-7) confirmed green.

---

## 0.1.5 — 2026-06-17

**M5 — Debug (breakpoints)**

- Added `src/debug/debug-adapter.ts`: `DaisyDebugAdapterFactory` — locates `lldb-dap` via `xcrun` first, then known Xcode/CLT candidate paths, and returns a `vscode.DebugAdapterExecutable` so VS Code can talk DAP directly to lldb. Covers C6 / FR-DB-6.
- Added `src/commands/debug-deploy.ts`: `debugDeploy()` — deploys the emulator (same flow as Run mode), replays pot snapshot, reads `childPid`, then calls `vscode.debug.startDebugging()` with a `daisy-debug / attach` config targeting the running process PID. Covers FR-DB-2.
- Updated `src/emulator/manager.ts`: added `childPid` getter exposing the running emulator's PID. Fixed a race condition where the old process's async `close` event was wiping out `this.childProcess` after a redeploy had already assigned a new child — guard now checks `this.childProcess === child` before nulling. Covers FR-DE-1/FR-DB integrity.
- Updated `src/extension.ts`: registers `DaisyDebugAdapterFactory` for the `daisy-debug` type; adds `ds-ide.debug` command (Deploy and Debug); listens to `onDidStartDebugSession` / `onDidTerminateDebugSession` to update the status bar. Covers FR-DB-1/3/4/5.
- Updated `package.json`: added `ds-ide.debug` command and `debuggers` contribution (`type: daisy-debug`, `languages: [c, cpp]`) so gutter breakpoints appear in C/C++ files. Covers FR-DB-1.
- 125 unit tests across 12 test files; all pass. AC-4 (breakpoint in callback hit; line shown; time frozen; continue/stop) closed.

---

## 0.1.4 — 2026-06-17

**M4 — Diagnostics & robustness**

- Added `src/diagnostics/build-diagnostics.ts`: `parseBuildLine()` and `applyDiagnostics()` — parse clang/gcc error/warning lines (`file:line:col: severity: message`) into `vscode.Diagnostic` entries and populate the VS Code Problems panel with clickable file:line links. Covers FR-ED-3.
- Added `src/diagnostics/non-portable.ts`: `detectNonPortableSymbol()` — scans build output for undefined-symbol linker errors (clang ld64 and GNU ld styles) and extracts the unresolved symbol name, enabling an actionable "symbol not emulated" message. Covers FR-BU-5.
- Updated `src/commands/build.ts`: `buildForEmulator()` now accepts a `DiagnosticCollection`, collects parsed diagnostics during build, applies them on success or failure, and shows the non-portable symbol message when a linker undefined-reference is detected.
- Updated `src/emulator/manager.ts`: `killExisting()` sets an `intentionalDisconnect` flag so IPC disconnect events during redeploy or dispose are suppressed; `connectIpc()` resets the flag so unexpected emulator crashes (flag is false) still propagate the `disconnect` event. Covers NFR-8 / FR-DE-2.
- Updated `src/extension.ts`: creates a `DiagnosticCollection` (passed to build) and a VS Code status bar item showing emulator state with the fidelity caveat in its tooltip; listens for `message{type:event,kind:nan|inf}` → VS Code warning notification; listens for `disconnect` → error notification without crashing the extension. Covers FR-RU-4, NFR-7, NFR-8.
- Updated `src/webview/scope-panel.ts`: audio-health events now accumulate in a `Set` and remain visible until transport stops (sticky); fidelity caveat notice ("ℹ Approx. Seed") added to the scope panel header. Covers FR-RU-4, NFR-7.
- Updated `src/__mocks__/vscode.ts`: added `DiagnosticSeverity`, `Range`, `Diagnostic`, `StatusBarAlignment`, `languages.createDiagnosticCollection`, and `window.createStatusBarItem` to the test mock.
- 107 unit tests across 10 test files; all pass. AC-5 (NaN/clip flagged), AC-6 (hardware build untouched), AC-7 (<30 s loop) closed.

---

## 0.1.3 — 2026-06-17

**M3 — Controllers (pots)**

- Added `src/controllers/controller-config.ts`: `parseControllerYaml()` — parses the project's `controllers.yaml` (id, label, adc_channel, range, taper, default); validates duplicate channels, out-of-range channel numbers, missing fields, and invalid taper values; returns valid `ControllerDef[]` plus collected error strings. Covers FR-CT-1/5.
- Added `src/controllers/pot-store.ts`: `PotStore` — persists pot channel values in `vscode.workspaceState`; `setDefaults()` seeds channels not yet stored; `getSnapshot()` returns a full channel→value map for IPC replay. Covers FR-CT-4, FR-CF.
- Updated `src/webview/scope-panel.ts`: `ScopePanel.show(defs, initialValues)` now renders a pot-slider row per `ControllerDef`; webview `pot` messages are forwarded to `manager.sendPot()` and an optional `onPotChange` callback; slider initial values come from `PotStore`. Covers FR-CT-2/3, NFR-3 ≤50 ms.
- Updated `src/emulator/manager.ts`: added `sendPotSnapshot(values)` — sends an IPC `potSnapshot` message to replay all pot values on (re-)deploy. Covers FR-DE-2.
- Updated `src/extension.ts`: `PotStore` created on activation; deploy command loads `controllers.yaml`, calls `potStore.setDefaults()`, passes defs + initial values to `scopePanel.show()`, and sends `potSnapshot` after IPC connect.
- 81 unit tests across 8 test files; all pass; TypeScript typecheck clean. AC-2 closed.

---

## 0.1.2 — 2026-06-17

**M2 — Extension run loop + scope**

- Added `src/emulator/ipc-client.ts`: `IpcClient` — EventEmitter wrapping a Node `net.Socket` UNIX-domain connection; sends JSON lines, buffers and parses incoming lines, emits typed `message`/`error`/`disconnect` events.
- Added `src/emulator/manager.ts`: `EmulatorManager` — orchestrates the full lifecycle: CMake configure + build (auto-detects effect `.cpp` and DaisySP at project root), child-process spawn/kill with socket-path parsing from stdout, IPC client connect, relay of IPC messages as EventEmitter events. Supports injectable factories for testability.
- Added `src/webview/scope-panel.ts`: `ScopePanel` — VS Code `WebviewPanel` with an inline HTML canvas that draws input (teal) and output (orange) waveforms in real time; relays `scope`, `status`, and `event` frames from the manager into the webview via `postMessage`.
- Updated `src/commands/build.ts`: `buildForEmulator` now invokes `EmulatorManager.build()` with auto-detected sources and streams output to a dedicated Output Channel.
- Updated `src/commands/deploy.ts`: `deployToEmulator` opens the scope panel and calls `EmulatorManager.deploy()`, which kills any running emulator, launches the new executable, and connects IPC.
- Updated `src/commands/transport.ts`: `startAudio`/`stopAudio` call `manager.sendTransport('start'/'stop')`.
- Updated `src/extension.ts`: creates `EmulatorManager` + `ScopePanel` on activation; wires all four commands; disposes cleanly on deactivate.
- 35 unit tests across 5 test files (ipc-client, manager, build helpers, transport commands, extension scaffold); all pass; TypeScript strict-mode typecheck clean.

---

## 0.1.1 — 2026-06-17

**M1 — Headless emulator runtime**

- Added `emulator/CMakeLists.txt`: host CMake build that compiles an effect `.cpp` + the host libDaisy shim + DaisySP + the runtime `main()` into a single native executable (`effect_emu`); `-O0 -g`; effect `main()` renamed via `-Dmain=effect_main` so the runtime controls startup; DaisySP sub-directory include paths handled automatically.
- Added shim implementations (`emulator/shim/src/`): `DaisySeed` Configure/Init/SetAudioBlockSize/AudioSampleRate/GetPin/StartAudio/PrintLine; `AdcHandle` GetFloat backed by atomic `pot_values[]` array; `System::Delay` with shutdown-flag check.
- Added emulator runtime (`emulator/runtime/`): shared `EmulatorState` (atomic pot values, transport flag, sine params, IPC send hook); audio engine thread (soft-paced interleaved block loop, sine generator, scope tap at ≈30 fps, NaN/Inf/denormal/clip scan); UNIX-domain-socket IPC server (line-delimited JSON: `config`/`transport`/`sine`/`pot`/`potSnapshot` in → `scope`/`status`/`event` out).
- Added integration tests (`tests/runtime/`): Python IPC client helper; `test_bypass` (verifies `out == in` across ≥3 scope frames); `test_osc` (verifies Osc oscillator produces non-silent output that changes with pot position); `test_determinism` (same inputs → bit-identical scope output, NFR-6). All 3 pass; M0 shim compile-tests unaffected.
- `bypass` builds, runs headless, and passes the out==in scope check. `Osc` with hardcoded pot value shows the oscillator tracking it. Determinism verified.

---

## 0.1.0 — 2026-06-17

**M0 — Foundations**

- Added VS Code extension scaffold: `package.json` manifest, TypeScript project, esbuild bundler, `activate()`/`deactivate()`, four command stubs (`ds-ide.build`, `ds-ide.deploy`, `ds-ide.start`, `ds-ide.stop`). Extension loads and commands appear in the Command Palette.
- Added host libDaisy shim API headers (`emulator/shim/include/`): `daisy_seed.h` umbrella, `AudioHandle` (interleaved v1.0 + block v1.1 callback typedefs), `DaisySeed`, `AdcChannelConfig`/`AdcHandle`, `System::Delay`, pin constants (`seed::A0`–`A11`), `Led`/`Switch` no-op stubs.
- Added compile-test script (`tests/shim-compile/run_compile_tests.sh`): verifies all four v1 examples (`bypass`, `Knob`, `Osc`, `inout`) compile cleanly against the shim headers with host clang. All 4 PASS.
- Added Milestone Registry to `docs/05_dev-plan.md` and `docs/milestones/M0.md`.
- Added `.vscode/launch.json` + `tasks.json` for F5 Extension Development Host.
- 4 vitest unit tests for extension activation pass; TypeScript strict-mode typecheck clean.
