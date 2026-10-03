# M76 — Input Generators

**Version:** 0.24.3
**Status:** planned
**Source:** intake session, 2026-10-03 (01_input-ideas.md; user request; mockup `docs/mockups/v23b-effect-testing-layered.html`; `docs/raw/test_framework/effect-testing-features.md` §3.1, §5.1)

## Goal

The Scope's Input offers only a fixed sine, the host microphone or a WAV file, so an effect's response can be seen at one frequency or with material that cannot be repeated. After this milestone the Input select has a Generators group — Sine, Noise, Log sweep, Impulse, Step, Silence, Two-tone — next to the External group, each generator with its own parameters, generated deterministically inside the emulator.

## Sprint Tasks

### [x] feat: generator definitions module (FR-GEN-2)

The ids, labels, parameters, defaults, ranges and hints of the seven generators are pure data, shared by the panel markup and the webview.

**Affected files:** `src/webview/scope/scope-generators.ts`, `src/test/unit/webview/scope-generators.test.ts`

**DoD:**
- a pure module lists the seven generators with their parameters, defaults (Amp 0.25; sweep 20 Hz → 20 kHz over 5 s; Period 500 ms) and ranges as in FR-GEN-2
- a `clampParams` helper clamps every parameter to its range and keeps sweep To above From
- unit tests cover every default, every clamp edge and the hint text of Silence, Impulse, Step and Two-tone

---

### [x] feat: emulator input generators (FR-GEN-2)

**Affected files:** `emulator/runtime/input_generators.h`, `emulator/runtime/input_generators.cpp`, `emulator/CMakeLists.txt`, `tests/input-generators/test_input_generators.cpp`, `tests/input-generators/run_tests.sh`

**DoD:**
- an `InputGenerator` class renders a block of each of the seven generators into a stereo buffer, with no allocation, lock or syscall in `render`
- Noise never exceeds ±Amp; Silence is exactly zero; Two-tone peaks at no more than Amp; Impulse and Step switch on the Period boundaries to the sample; the sweep is phase-continuous and restarts after Time
- the same settings produce identical samples after a reset, and different seeds are not used (fixed seed)
- the test program builds and passes via `run_tests.sh`

---

### [x] feat: wire generators into the audio engine and IPC (FR-GEN-3)

Implements FR-GEN-3 (engine input stage) and the emulator side of FR-GEN-4 (the `generator` message).

**Affected files:** `emulator/runtime/emulator_state.h`, `emulator/runtime/audio_engine.cpp`, `emulator/runtime/ipc_server.cpp`, `tests/runtime/test_generators.py`

**DoD:**
- `EmulatorState` holds the generator kind and parameters as atomics; `audio_engine.cpp` uses `InputGenerator` in place of the sine branch when a generator is active, in both simulated-clock and real-time modes; replay and WAV keep priority
- a `generator` message is parsed and range-clamped in `ipc_server.cpp`; an unknown kind or non-numeric field is ignored with a stderr note, never a crash
- selecting a generator resets its state; a parameter change while running applies from the next block
- the session recorder records the generator's output like any input
- a runtime test starts the emulator, selects a generator over IPC and checks the scope output for Silence (zeros), Impulse (period spacing) and determinism across two runs

---

### [x] feat: grouped Input select and generator parameter rows (FR-GEN-1)

Implements FR-GEN-1, FR-GEN-5 and the host/webview side of FR-GEN-4.

**Affected files:** `src/webview/scope-panel.ts`, `src/webview/scope-webview.ts`, `src/webview/messages.ts`, `src/emulator/manager.ts`, `src/extension.ts`, `src/test/unit/webview/scope-panel.test.ts`

**DoD:**
- the Input select has a Generators group and an External group; Sine is the default; Live (mic) and WAV keep their labels, fields and behaviour
- each generator shows only its own parameter row, with its hint where it has one; selecting one never changes Time, Gain, Scale or Trigger
- `audioSource` accepts the new input ids and the host validates them; `EmulatorManager.sendGenerator()` sends the `generator` message
- the panel remembers each generator's parameters for the session and re-sends the current ones when the emulator restarts
- the scope-panel unit test fails if a generator is missing from the select or its parameter group is not rendered

---

### [ ] chore: manual test cases for the generators (FR-GEN-5)

**Affected files:** `src/test/manual/manual-tests.html`

**DoD:**
- cases cover: each generator's waveform and spectrum on the Scope, Impulse and Step repeating at their Period, the sweep restarting, Silence reading −∞ on the meters, live host output at the default Amp, and switching between Generators and External entries
- each case has the standard status select and appears in the page-top summary
