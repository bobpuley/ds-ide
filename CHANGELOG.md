# Changelog

All notable changes to ds-ide are documented here.
Versions follow [Semantic Versioning](https://semver.org/). Each entry maps to a sprint milestone.

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
