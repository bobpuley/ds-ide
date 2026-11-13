# 03 — Requirements (v25)

> **v23 complete** — all v23 requirements implemented; ACs green.
> Archived: [`docs/v23/03_requirements.md`](v23/03_requirements.md).
>
> **v24 complete** — all v24 requirements implemented; ACs green.
> Archived: [`docs/v24/03_requirements.md`](v24/03_requirements.md).

## First public preview — `FR-REL-*` (intake 2026-11-11)

Source: `01_input-ideas.md`, 2026-11-11; fresh-profile install test tracked in `docs/release_plan.md`. Milestone: **M85**.

**FR-REL-1 — Workspace trust.** `package.json` declares `capabilities.untrustedWorkspaces` explicitly (`supported: false` with a `description` that says Daisy IDE builds and runs the project's code and needs a trusted folder), so a first-time user who opens a folder in Restricted Mode is told why the extension is inactive instead of finding the Controls and Wiring icons silently missing. The README quick start tells the user to trust the folder when VS Code asks. `package-metadata.test.ts` asserts the declaration and a non-empty description.

**FR-REL-2 — CMake detection and a clear "not found" failure.** The emulator build resolves `cmake` the way `dfu-util` and the ARM toolchain are resolved: `which cmake`, then known install locations (`/opt/homebrew/bin/cmake`, `/usr/local/bin/cmake`); `PATH` always wins. When no CMake is found, or `spawn` fails before CMake runs (`ENOENT`), the build fails with a specific message — "CMake not found. Install it (`brew install cmake`) and try again." — shown by **Run Daisy Effect**, **Build & Deploy**, **Build for Emulator** and the Daisy view, and the cause is written to the build output channel. The generic "Build failed. Nothing was deployed." (and a **Show Problems** button that opens an empty list) is no longer the only signal for a failure that produced no diagnostics. A CMake that starts and then fails keeps the existing diagnostics path unchanged.

**FR-REL-3 — Activation on opening a Daisy project.** The extension activates as soon as a workspace folder that looks like a Daisy effect project is opened, so the editor-title Run / Debug / Build & Flash buttons and the Run, Debug and Stop commands in the Command Palette are available without first using another command or view. `package.json` declares `activationEvents` for the locations the effect-source detection searches — `workspaceContains:*.cpp`, `workspaceContains:src/*.cpp` and `workspaceContains:source/*.cpp` — and no wildcard (`*`) or `onStartupFinished` event. The events that VS Code infers from `contributes` (commands, views) stay in effect. A project whose effect source is elsewhere (set through `ds-ide.effectSource`) still activates on first use of a command or view, as before.

## First public preview — curated examples, `FR-EXM-*` (intake 2026-11-13)

Source: `01_input-ideas.md`, 2026-11-13. Milestone: **M86**.

**FR-EXM-1 — Bundled DaisySP fallback.** `detectDaisySP` resolves DaisySP in this order: the project's own `DaisySP/Source`, `DaisySP/src`, `daisysp/Source`, `daisysp/src` (unchanged), then the extension's bundled `vendor/DaisySP/Source`. A project that has its own copy never uses the bundled one. The result is the include directory the emulator build already receives (`BuildOptions.daisySpDir`), so no other build path changes. A bare-libDaisy project is unaffected, since the directory only adds an include path.

**FR-EXM-2 — Meaningfully named example set.** `examples/` contains only standalone, self-contained example projects with names that describe what they show; none refers to a milestone (`mNN`). Each has a `README.md` stating what the example demonstrates, how to open and run it (open the folder, trust it, Run Daisy Effect, which panel to use), what to try, and what the user should learn. The first one is `tremolo-filter` (existing; baseline DSP effect with pots, scope and spectrum, and breakpoint debugging), whose README is added by this requirement. The five milestone-named demos are removed, and their useful content is folded into the new examples.

**FR-EXM-3 — `controls-tour`.** A bare-libDaisy example that uses the basic controls the Controls and Wiring editors offer — pot, button, toggle, LED, RGB LED and encoder — each visibly affecting the audio or an indicator, with a `ds-ide:controls` block and `controllers.yaml`. Builds with no DaisySP.

**FR-EXM-4 — `midi-synth`.** A DaisySP oscillator played from the MIDI panel's on-screen keyboard (USB MIDI): Note On/Off set pitch and gate, a Control Change message selects the waveform. The README names the controller number and values.

**FR-EXM-5 — `midi-synth-oled`.** The `midi-synth` behaviour plus an OLED that draws the selected waveform as a pixel shape (the shim has no text or fonts; see `02`). The README says why the display shows a shape rather than a name.

**FR-EXM-6 — `controls-sd-logger`.** The `controls-tour` controls plus an SD card: each user action on a control is appended to a log file on the card. The README says where the file appears on the host and how to read it.

**FR-EXM-7 — Examples index and guard test.** `examples/README.md` lists the examples in a suggested learning order with one line each. A unit test over `examples/*` fails when an example lacks a `README.md`, a `CMakeLists.txt`, a `controllers.yaml` or a `ds-ide:controls` block, when a name matches `m\d+`, or when the directory listing differs from the index.

**FR-EXM-8 — The emulated SD card is `<project>/sdcard/`.** The emulator process is started with the project folder (the one the effect was built from) as its working directory, so the FatFs shim's `sdcard/` is `<project>/sdcard/` regardless of how VS Code was launched, and it is the folder the Controls Editor's SD viewer reads. The shim also provides `f_sync` (flush to the card without closing), so a line an effect writes is visible in the viewer at once. A project that never mounts the card gets no `sdcard/` folder.

**FR-EXM-9 — The SD viewer follows the card.** While an SD card peripheral is enabled and the Controls Editor is visible, the viewer re-reads the card's root listing about once a second and updates only when the listing changed. When the expanded file's size changes it re-reads that file's preview (the old text stays on screen until the new text arrives); the Refresh button always re-reads the expanded file. A file that is not expanded drops its cached preview when its size changes, so the next expand shows current content. A preview longer than its box scrolls inside the viewer, and a refresh does not reset its scroll position unless the content changed.
