# M87 — README Polish

**Version:** 0.24.6
**Status:** in progress
**Source:** intake session, 2026-11-13 (first public preview; `docs/release_plan.md`)

## Goal

The README is the Marketplace page and the first thing a visitor reads, and it still describes an early version of the extension: pots and buttons only, the old Build → Deploy → Start Audio flow, install from a `.vsix` only, no examples, no known issues, and developer-only sections mixed in. This milestone rewrites it for the first public preview: what it is and that it is a preview, real prerequisites, a quick start built on the examples and **Run Daisy Effect**, features that match what shipped, known issues and limits, and where to send feedback. A unit test keeps its links honest.

## Sprint Tasks

### [x] docs: preview notice and positioning at the top of the README (FR-DOC-1)

**Affected files:** `README.md`

**DoD:**
- the README opens with two or three sentences on what Daisy IDE is, a clearly visible preview notice (early access, rough edges expected, feedback welcome) and the platform scope (macOS, Apple Silicon only)
- the overview screenshot is kept

---

### [x] docs: real requirements and Marketplace-first installation (FR-DOC-2)

**Affected files:** `README.md`, `src/test/unit/build/readme-links.test.ts`

**DoD:**
- requirements list VS Code, macOS arm64, CMake, the Xcode Command Line Tools, and (hardware commands only) the Arm GNU toolchain, `dfu-util` and a physical Daisy Seed, each marked required or optional
- installation shows the Marketplace route (pre-release) first and the `.vsix` route second; the trust-the-folder line is kept
- the README's CMake minimum agrees with `emulator/CMakeLists.txt` (checked by `readme-links.test.ts`; it said 3.19 while the build needs 3.20)

---

### [x] docs: quick start built on the examples and Run Daisy Effect (FR-DOC-3)

**Affected files:** `README.md`

**DoD:**
- a first-time user can go from nothing to sound and scope output in a handful of steps: open `examples/tremolo-filter`, trust the folder, click the play button (or **Daisy IDE: Run Daisy Effect**), use the Scope and Controls Editor
- a second short path covers **Create New Effect Project**
- every command name used appears in `package.json` `contributes.commands`
- the old three-command flow appears at most as the step-by-step equivalent
- walked through by hand in a clean profile with the installed package

---

### [ ] docs: features and editor sections match the shipped extension (FR-DOC-4)

**Affected files:** `README.md`

**DoD:**
- the feature list covers the Scope and spectrum, input generators and WAV/mic input, session record and replay, the full device set (pot, button, toggle, LED, RGB LED, encoder, SD card, OLED, MIDI USB/TRS) with its panels and viewers, breakpoint debugging, hardware build and DFU flash
- the Wiring Editor, Controls Editor and Debugging sections say what they do today (no pots-and-buttons-only wording)
- an **Examples** section has one line per example and links to `examples/README.md`
- every command name used appears in `package.json` `contributes.commands`

---

### [ ] docs: known issues and limitations (FR-DOC-5)

**Affected files:** `README.md`

**DoD:**
- a **Known issues** section describes the intermittent extension-host crash as observed (symptom, when seen, what to do) without claiming more than is known
- a **Limitations** section lists: macOS arm64 only, hardware build and flash need a libDaisy-style `Makefile` project, no OLED text or fonts, the encoder's push-button cannot be pressed from the Controls Editor, and anything else found true while writing it

---

### [x] test: README links and images resolve to shipped files (FR-DOC-6)

**Affected files:** `src/test/unit/build/readme-links.test.ts`, `README.md`, this file

**DoD:**
- a unit test fails when a relative link or image in `README.md` points at a file that does not exist, or at an image the package does not ship (only `media/*.png` and similar files that `.vscodeignore` lets through)
- the README references only screenshots that exist in `media/`
- the screenshots still to be taken are listed below for the owner; each is added to the README when its file exists

**Screenshots still to take (owner), file names to use in `media/`:**
- `screenshot-midi-panel.png` — MIDI panel with the keyboard and the CC sender (from `midi-synth`)
- `screenshot-oled.png` — the OLED panel showing a waveform shape (from `midi-synth-oled`)
- `screenshot-sd-viewer.png` — the SD Card section listing `actions.txt` with its preview (from `controls-sd-logger`)
- `screenshot-run-button.png` — the editor's play button on an example (for the quick start)
- the three existing screenshots (`screenshot-overview.png`, `screenshot-controls-design.png`, `screenshot-wiring-editor.png`) should be checked against the current UI and retaken if they differ

---

### [ ] docs: move developer content out and add a feedback section (FR-DOC-7)

**Affected files:** `README.md`, `CONTRIBUTING.md`

**DoD:**
- building the `.vsix` and running the test suites move from the README to a new `CONTRIBUTING.md`, which the README links to
- the README has a **Feedback** section pointing at the GitHub issues URL from `package.json` `bugs`, and says what to include in a report
- the README no longer contains developer-only instructions
