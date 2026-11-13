# M86 — Example Curation

**Version:** 0.24.5
**Status:** in progress
**Source:** intake session, 2026-11-13 (first public preview; `docs/release_plan.md`)

## Goal

Everything under `examples/` ships in the `.vsix`, and today it is milestone-named demos, two of which predate the `ds-ide:controls` convention and cannot render in the Controls and Wiring editors, and a plain copy of one that includes `daisysp.h` fails to build. This milestone makes DaisySP resolvable for any project through the bundled copy, and replaces the demos with a small, meaningfully named set where each example shows one capability and explains itself in a README.

## Sprint Tasks

### [x] feat: fall back to the bundled DaisySP when the project has none (FR-EXM-1)

`detectDaisySP` only looks inside the project, so an example (or any hand-made project) that includes `daisysp.h` fails with `'daisysp.h' file not found` unless DaisySP was copied in by hand.

**Affected files:** `src/commands/build.ts`, `src/test/unit/commands/build.test.ts`

**DoD:**
- `detectDaisySP(projectRoot, extensionPath)` returns the project's own `DaisySP/Source|src` or `daisysp/Source|src` first, and `<extensionPath>/vendor/DaisySP/Source` only when none exists
- a project with its own copy never gets the bundled path
- callers (`build.ts`, any other) pass the extension path; unit tests cover project-wins, fallback, and neither present
- `tremolo-filter` built from a plain copy (no `DaisySP/` in it) succeeds in the emulator build

---

### [x] feat: replace the milestone demos and document tremolo-filter (FR-EXM-2)

**Affected files:** `examples/` (remove `m10-demo`, `m13-demo`, `m16-demo`, `m16b-demo`, `m17-demo`), `examples/showcases/tremolo-filter/` (moved to `examples/tremolo-filter/`, README added), `.vscodeignore`, references to the old paths

**DoD:**
- the five milestone-named folders are removed and nothing in the repo (docs, tests, scripts, `.vscodeignore`) still points at them or at `examples/showcases/`
- `examples/tremolo-filter/README.md` explains how to run it, what to try (pots, scope, spectrum) and how to set a breakpoint and debug
- the example still builds and renders in the Controls and Wiring editors

---

### [ ] feat: add the controls-tour example (FR-EXM-3)

**Affected files:** `examples/controls-tour/` (`controls_tour.cpp`, `CMakeLists.txt`, `controllers.yaml`, `README.md`)

**DoD:**
- pot, button, toggle, LED, RGB LED and encoder are declared in a `ds-ide:controls` block and each visibly changes the audio or an indicator
- builds with the emulator with no DaisySP
- the README lists each control, what it does and what to learn from it; verified by building and running it once by hand

---

### [ ] feat: add the midi-synth example (FR-EXM-4)

**Affected files:** `examples/midi-synth/` (`midi_synth.cpp`, `CMakeLists.txt`, `controllers.yaml`, `README.md`)

**DoD:**
- Note On/Off from the MIDI panel keyboard play a DaisySP `Oscillator`; a Control Change message selects the waveform
- the README names the controller number and values, and how to open the MIDI panel
- builds and plays in the emulator (verified by hand)

---

### [ ] feat: add the midi-synth-oled example (FR-EXM-5)

**Affected files:** `examples/midi-synth-oled/` (`midi_synth_oled.cpp`, `CMakeLists.txt`, `controllers.yaml`, `README.md`)

**DoD:**
- the OLED draws a pixel shape for the selected waveform, updated when the Control Change message changes it
- the README explains why a shape and not a name is drawn (no fonts in the shim) and how to open the OLED panel
- builds and runs in the emulator (verified by hand)

---

### [ ] feat: add the controls-sd-logger example (FR-EXM-6)

**Affected files:** `examples/controls-sd-logger/` (`controls_sd_logger.cpp`, `CMakeLists.txt`, `controllers.yaml`, `README.md`)

**DoD:**
- each control action is appended to a log file on the emulated SD card
- the README states where the file appears on the host and how to read it
- builds and runs in the emulator and the file is found there (verified by hand)

---

### [ ] feat: add the examples index and the guard test (FR-EXM-7)

**Affected files:** `examples/README.md`, `src/test/unit/build/examples.test.ts`

**DoD:**
- `examples/README.md` lists every example in learning order with one line each
- the test fails when an example lacks `README.md`, `CMakeLists.txt`, `controllers.yaml` or a `ds-ide:controls` block, when a name matches `m\d+`, or when the directory listing and the index differ
- `npm test` and `npm run verify:package` pass
