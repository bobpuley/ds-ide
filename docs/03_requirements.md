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

## First public preview — README polish, `FR-DOC-*` (intake 2026-11-13)

Source: `01_input-ideas.md`, 2026-11-13. Milestone: **M87**.

**FR-DOC-1 — Preview notice and positioning.** The README opens with what Daisy IDE is in two or three sentences, a visible notice that this is a **preview** (early access: rough edges and UI changes are expected, feedback is the point), and the platform scope (macOS on Apple Silicon only). The existing overview screenshot stays.

**FR-DOC-2 — Requirements and installation.** Requirements list the real prerequisites: VS Code, macOS arm64, CMake, the Xcode Command Line Tools (for the `lldb-dap` debugger), and, only for the hardware commands, the Arm GNU toolchain, `dfu-util` and a physical Daisy Seed. Installation gives the Marketplace route first (installing the pre-release) and the `.vsix` route second; the line about trusting the folder stays.

**FR-DOC-3 — Quick start.** The quick start gets a first-time user from nothing to audible, visible output in a few steps using the current flow: open one of the `examples/` (starting with `tremolo-filter`), trust the folder, click the editor's play button (**Daisy IDE: Run Daisy Effect**), and use the Scope and Controls Editor. A second short path covers starting from scratch with **Create New Effect Project**. The old Build → Deploy → Start Audio sequence is described only as the step-by-step equivalent, if at all.

**FR-DOC-4 — Features and sections match the shipped extension.** The feature list and the Wiring Editor, Controls Editor and Debugging sections cover what the extension does today: the Scope and spectrum, input generators and WAV/mic input, session record and replay, the full device set (pot, button, toggle, LED, RGB LED, encoder, SD card, OLED, MIDI USB/TRS) with its panels and viewers, breakpoint debugging, hardware build and DFU flash, and the `examples/` folder (one line per example, linking to `examples/README.md`). Command names are copied from `package.json`.

**FR-DOC-5 — Known issues and limitations.** A **Known issues** section describes the intermittent extension-host crash (symptom, when it was seen, what to do: reload the window or relaunch, open the folder before starting a debug session) in the words fixed by the assumption in `02`. A **Limitations** section lists the real ones: macOS arm64 only, hardware build and flash need a libDaisy-style `Makefile` project, no text or fonts on the OLED, the encoder's push-button cannot be pressed from the Controls Editor, and anything else found true while writing it.

**FR-DOC-6 — Screenshots and a link guard.** The README references only screenshots that exist in `media/`. The screenshots still to be taken are listed, with the file name the README will use, in the milestone file for the owner to add; until a file exists the README does not reference it. A unit test fails when a relative link or image in the README points at a missing file or at an image the package does not ship.

**FR-DOC-7 — A user-facing README only.** Developer content (building the `.vsix`, running the test suites) moves to a `CONTRIBUTING.md` that the README links to. A **Feedback** section says where to report problems (the GitHub issues URL from `package.json` `bugs`) and what to include; issue templates are a separate item.

## First public preview — licensing, `FR-LIC-*` (intake 2026-11-13)

Source: `01_input-ideas.md`, 2026-11-13. Milestone: **M88**.

**FR-LIC-1 — The project is licensed under PolyForm Shield 1.0.0.** `LICENSE` is the official PolyForm Shield 1.0.0 text, unmodified, followed by the `Required Notice:` line naming the copyright holder (confirmed by the owner when the task is done). `package.json` `license` is the SPDX identifier `PolyForm-Shield-1.0.0`. `LICENSES.md`'s opening section states the same licence for ds-ide and keeps every third-party notice. The GPL-3.0 text and the MIT claims are gone.

**FR-LIC-2 — The licence statements cannot drift.** A unit test fails when `LICENSE` is not the Shield text with a Required Notice, when `package.json` `license` is not `PolyForm-Shield-1.0.0`, when `LICENSES.md` names a different licence for ds-ide, or when the README's licence section names one.

**FR-LIC-3 — The README explains the licence in plain words.** The License section says, in a few sentences: you may use Daisy IDE for anything, including developing and selling your own effects and products; what you build with it, your source and your binaries, belongs to you; you may not use it to provide a product that competes with it, and doing so needs a commercial agreement; the bundled third-party components keep their licences (link to `LICENSES.md`). It links to `LICENSE`, says the text there governs, and says how to ask about a commercial agreement. It does not give legal advice.

**FR-LIC-4 — A route for commercial agreements.** The README points to the GitHub issues page for commercial enquiries, through a dedicated issue template ("Commercial licence enquiry") that tells people not to post confidential details and asks how to reach them. The route is written in the README and the template, not in `LICENSE`, so it can change without touching the licence.

**FR-LIC-5 — Terms for contributions.** `CONTRIBUTING.md` says that a contribution is licensed under the project's licence and that the contributor also grants the maintainer the right to license it under other terms, including commercial ones, so the owner can keep offering commercial agreements. It names the licence and links to `LICENSE`.

**FR-LIC-6 — The outside contribution is resolved.** PR #1 (`kefflash`, `a397e28`, test-only Windows fixes) is either covered by the contributor's written consent to relicensing (the link recorded in `LICENSES.md`), or its lines are rewritten by the owner so none remain. Making the repository public waits on this.
