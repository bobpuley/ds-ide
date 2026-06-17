# 03 — Requirements

Clear, testable requirements for **ds-ide v1**, derived from the decisions in
[01_input-ideas.md](01_input-ideas.md) and the bets/risks in
[02_assumptions-and-risks.md](02_assumptions-and-risks.md).

**Conventions**
- IDs: `FR-*` functional · `NFR-*` non-functional · `CR-*` constraint. Stable; referenced by tests.
- "**shall**" = a v1 commitment. Deferred items are listed in §6 (not given `shall`).
- `> ⚠️ ASSUMPTION:` marks a requirement resting on an unconfirmed decision (see §7).
- Each requirement has a **Verify** hook where useful, tracing to acceptance criteria (§8).

**v1 in one sentence:** open a bare-libDaisy/DaisySP effect → build it for the emulator → load it →
drive its audio input with a sine wave → move on-screen **potentiometers** mapped to its ADC reads →
watch **input-vs-output waveforms** → set breakpoints, run in debug, pause with simulated time
frozen, continue, stop. Native simulation (Option A), VS Code extension, macOS-first.

---

## 1. Foundational decisions (context, not re-litigated here)

| Ref | Decision |
|-----|----------|
| D1 | **Emulation = native host simulation (Option A).** Effect recompiled for the host CPU against a host libDaisy shim; no ISA emulation. |
| D2 | **ds-ide = VS Code extension.** Reuses editor, DAP debug UI, terminal, tasks. |
| D3 | **Target = bare libDaisy/DaisySP C++.** Arduino/DaisyDuino out of scope (CR-5). |
| D4 | **Primary OS = macOS / Apple Silicon**; cross-platform where practical, pragmatic v1 gaps. |
| D5 | **v1 controllers = potentiometers only** (ADC). Buttons/GPIO → v2. |
| D6 | **v1 feedback = waveform visualization**, no host-speaker output. Spectrum → v2. |
| D7 | **v1 audio input = internal sine generator** only. WAV/live → v2. |
| D8 | **v1 debug = breakpoints + run/pause/continue/stop**, time frozen on pause. Stepping/variables → v2. |
| D9 | **v1 is emulator-only.** No in-IDE hardware build and no hardware flashing (`dfu-util`); the user's existing external build+flash workflow is untouched. In-IDE hardware build/flash → v2. |

---

## 2. Functional requirements

### 2.1 Editor & project (`FR-ED`)
- **FR-ED-1** — ds-ide shall open an existing bare-libDaisy project (a folder with a `Makefile`,
  `*.cpp`, and `libDaisy`/`DaisySP` as submodules or referenced directories).
- **FR-ED-2** — ds-ide shall edit C/C++ with syntax highlighting and save files. *(VS Code native.)*
- **FR-ED-3** — ds-ide shall show build diagnostics (errors/warnings) parsed from compiler output,
  each navigable to its source line. **Verify:** a deliberate syntax error appears with a clickable
  file:line.

### 2.2 Build (`FR-BU`)
- **FR-BU-1** — ds-ide shall build the project for the **emulator target** (host compile against the
  host libDaisy shim) with a single action. **Verify:** AC-1.
- **FR-BU-2** — *(Deferred to v2, per D9.)* In-IDE **hardware-target** build (`arm-none-eabi-g++`
  via the project `Makefile`). In v1 the user keeps their existing external hardware build; ds-ide
  shall not interfere with it (NFR-5).
- **FR-BU-3** — ds-ide shall surface build success/failure and the full build log.
- **FR-BU-4** — The emulator debug build shall compile with `-O0 -g` (debug symbols) to support
  native breakpoints (FR-DB).
- **FR-BU-5** — When emulator-target source is **not host-portable** (hardware-only headers/
  intrinsics not provided by the shim), ds-ide shall report an actionable message identifying the
  unsupported symbol, rather than a raw linker error. *(Mitigates R2.)*
- **FR-BU-6** — The emulator build's only host dependencies are: a **system C++ compiler** (clang
  via Xcode Command Line Tools on macOS), the project's existing **libDaisy/DaisySP** sources
  (FR-ED-1), and the **host libDaisy shim** shipped with ds-ide. No ARM toolchain is required in v1.
  *(The `arm-none-eabi` bundle-vs-detect question returns with the v2 in-IDE hardware build.)*

### 2.3 Deploy (`FR-DE`)
- **FR-DE-1** — ds-ide shall launch the emulator executable produced by the emulator build ("deploy
  to emulator"); each redeploy kills the previous process and starts the new executable. **Verify:**
  AC-1. *(P1 model — 04 §1.3: standalone executable, not dlopen into a persistent runtime.)*
- **FR-DE-2** — ds-ide shall re-deploy on rebuild without restarting ds-ide, preserving controller
  positions across the re-deploy. **Verify:** move a pot, rebuild, pot value retained.
- **FR-DE-3** — On deploy, the emulator runtime shall reset its internal state (audio buffers, shim
  peripheral state) to a defined initial condition.
- **FR-DE-4** — *(Deferred to v2, per D9.)* Hardware DFU deploy (`dfu-util`, BOOT+RESET) inside
  ds-ide. v1 leaves hardware flashing to the user's existing external workflow.

### 2.4 Execute / run (`FR-RU`)
- **FR-RU-1** — ds-ide shall provide **Start** and **Stop** transport. Start drives the effect's
  `AudioCallback` at the configured sample rate/block size; Stop halts it. **Verify:** AC-1.
- **FR-RU-2** — The runtime shall invoke the effect's audio callback with libDaisy buffer semantics
  in **both** supported forms — interleaved (`InterleavingInput/OutputBuffer`, `out[i]/out[i+1]`)
  and non-interleaved (`Input/OutputBuffer`, `in[chan][i]`) — at the correct channel count, block
  size, and sample rate. *(Confirmed against `daisy-seed-knowledge/examples`; see 02 §3.1.)*
  **Delivery is phased (04 §4.1): interleaved in v1.0 (44 of the 70 bundled examples),
  non-interleaved/block in v1.1 (28 examples).** "Both forms" is the v1 end state, satisfied across
  v1.0 + v1.1; v1.0 on its own is a valid milestone but not feature-complete against this requirement.
- **FR-RU-3** — Default sample rate **48 kHz**, default block size **48** (libDaisy defaults); both
  shall be configurable.
- **FR-RU-4** — If the callback throws, produces NaN/Inf, or denormals/clips, the runtime shall stop
  cleanly and report it, rather than crashing ds-ide. ds-ide shall surface **NaN/Inf, denormal, and
  clipping** indicators. **Verify:** AC-5.
- **FR-RU-5** — ds-ide shall display runtime status: sample rate, block size, and an under-run
  (xrun) indicator.

### 2.5 Audio input & visualization (`FR-AU`)
- **FR-AU-1** — The v1 audio input source shall be an **internal sine generator** feeding the input
  buffer(s).
- **FR-AU-2** — The sine generator **frequency and amplitude shall be user-adjustable** in v1
  (default 440 Hz, ~−6 dBFS) via controls in the UI. The IPC `sine` message (04 §5) carries these
  values to the runtime.
- **FR-AU-3** — ds-ide shall display a live **input-vs-output waveform** (scope). This is the
  primary v1 feedback (no host-speaker output in v1). **Verify:** AC-2.
- **FR-AU-4** — Because v1 has no host-speaker output, the audio engine **need not** meet a hard
  real-time deadline; it may run faster- or slower-than-real-time. *(See NFR-2.)*

### 2.6 Controllers — potentiometers only (`FR-CT`)
- **FR-CT-1** — A **declarative controller configuration** (e.g. `controllers.yaml` in the project)
  shall declare each potentiometer: stable `id`, UI `label`, `adc_channel`, value `range`, `taper`
  (linear/log/antilog), and `default`. This config is the v1 source of truth.
- **FR-CT-2** — ds-ide shall render a slider/knob per declared potentiometer in a dedicated panel.
- **FR-CT-3** — Moving a UI potentiometer shall update the value returned by the corresponding
  `adc.GetFloat(channel)` in the running emulation, in real time (≥ within the latency of NFR-3).
  Reads shall work both from `loop()` and from within `AudioCallback`. **Verify:** AC-2.
- **FR-CT-4** — Controller values shall persist across re-deploys within a session (with FR-DE-2)
  and the panel layout shall persist across ds-ide restarts.
- **FR-CT-5** — ds-ide shall validate the config (duplicate channels, missing fields, channel out of
  range) and report clear errors.
- **FR-CT-6** — The number of potentiometers is **config-driven** (not fixed); ds-ide shall support
  at least the channels the bare Seed exposes. *(Resolves "default count" open item: declarative.)*

### 2.7 Host libDaisy shim (`FR-SH`)
Scope pinned to the **canonical libDaisy API** confirmed against `daisy-seed-knowledge/examples`
(02 §3.1); covers only that surface.
- **FR-SH-1** — Provide `DaisySeed` `Configure()`/`Init()`, `SetAudioBlockSize(n)`,
  `AudioSampleRate()`.
- **FR-SH-2** — Provide `StartAudio(callback)` with **both** callback overloads (interleaved and
  non-interleaved, FR-RU-2) and correct buffer marshalling/types. **Phased per FR-RU-2 / 04 §4.1:**
  the interleaved overload ships in v1.0, the non-interleaved/block overload in v1.1 (additive — the
  engine exposes one canonical buffer as either view).
- **FR-SH-3** — Provide `AdcChannelConfig`/`InitSingle(pin)`, `adc.Init(cfg,count)`, `adc.Start()`,
  and `adc.GetFloat(channel)` driven by the controller panel; pin refs (`seed::A0…`, `GetPin(n)`).
- **FR-SH-4** — Provide `System::Delay(ms)` and `hw.PrintLine(fmt,…)` (mapped to host sleep/logger).
- **FR-SH-5** — Provide no-op/warn **stubs** for v1-unsupported APIs (`Led`, `Switch`/GPIO, SD, MIDI,
  display) so code referencing them still links, with a clear "not emulated" notice.
- **FR-SH-6** — DaisySP shall be used **unchanged** (`Oscillator`, `AdEnv`, `MoogLadder`, `mtof`, …);
  the shim does not wrap it.
- **FR-SH-7** — The shim shall be validated against the official examples (`bypass`, `inout`,
  `Knob`, `Osc`).

### 2.8 Debug (`FR-DB`)
- **FR-DB-1** — ds-ide shall add/remove a breakpoint on a source line via the editor gutter.
- **FR-DB-2** — ds-ide shall run in debug mode (emulator debug build, FR-BU-4) with breakpoints
  active.
- **FR-DB-3** — When execution reaches a breakpoint, the emulation shall pause and ds-ide shall
  indicate the current line. Breakpoints inside `AudioCallback` shall be supported. **Verify:** AC-4.
- **FR-DB-4** — While paused, the runtime shall **freeze simulated audio time** (no callbacks
  advance, no xruns) so inspection can take unlimited time.
- **FR-DB-5** — ds-ide shall provide **Continue** and **Stop**. **Verify:** AC-4.
- **FR-DB-6** — *(Implementation)* The debugger shall drive a native debugger (lldb/gdb) behind a
  DAP-style interface, so v2 stepping/variables come cheaply. *(Not a v1 user-facing commitment.)*

### 2.9 Configuration & persistence (`FR-CF`)
- **FR-CF-1** — ds-ide shall persist: breakpoints, panel/window layout, controller layout & values,
  emulator settings (sample rate, block size), and build settings.

---

## 3. Non-functional requirements (`NFR`)

- **NFR-1 (Inner-loop latency)** — Edit → build (emulator) → running emulation shall typically
  complete in **single-digit seconds** for a small effect. The full edit→compile→deploy→run→debug→
  fix→recompile cycle shall be **< 30 s** for a small change. *(Core value.)* **Verify:** AC-7.
- **NFR-2 (Audio engine)** — With no host-speaker output in v1 (FR-AU-4), the engine has no hard
  real-time deadline; it shall keep the UI responsive while visualizing. *(Real-time monitoring
  constraint returns only when host-speaker output lands in v2.)*
- **NFR-3 (Control latency)** — A potentiometer change shall be reflected in the emulation within
  **≤ 50 ms**.
- **NFR-4 (Platform)** — ds-ide shall run on **macOS (Apple Silicon)** as the primary target.
  Windows/Linux are desirable; code shall favour portable APIs, but minor non-macOS gaps are
  acceptable in v1 and may be deferred.
- **NFR-5 (No regression to hardware path)** — Adding ds-ide to a project (its emulator build
  target, `controllers.yaml`, etc.) shall not change or break the user's existing **external**
  hardware build/flash workflow. **Verify:** AC-6.
- **NFR-6 (Determinism)** — Given the same sine input and the same controller values, a run shall be
  reproducible.
- **NFR-7 (Fidelity caveat, user-visible)** — ds-ide shall make visible that the emulator
  approximates the Seed (float/timing/denormal differences) and **does not validate the Seed's
  real-time CPU/RAM budget**; it shall not imply bit-exactness or that "runs in the emulator" means
  "fits on hardware." *(Mitigates R1/R4.)*
- **NFR-8 (Stability)** — Build failures shall not crash ds-ide; emulator/runtime crashes shall be
  isolated and reported (FR-RU-4).
- **NFR-9 (Usability)** — A user who can flash a Seed today shall be able to run their effect in the
  emulator without a manual.
- **NFR-10 (Licensing)** — libDaisy/DaisySP are MIT; bundling/wrapping is permitted; licenses of any
  bundled toolchain/emulator components shall be tracked.

---

## 4. Constraints (`CR`)

- **CR-1** — Targets are **C++ effects on libDaisy/DaisySP** (not Arduino, not gen~/Pd).
- **CR-2** — Target is the **bare Daisy Seed** with user-wired controls → the declarative controller
  config (FR-CT-1) is the source of truth; fixed-board control maps are out of scope.
- **CR-3** — Option A requires effect source to be **host-portable**; non-portable code is a known
  limitation surfaced via FR-BU-5 / FR-SH-5.
- **CR-4** — v1 emulates the **audio path + ADC potentiometers** only; GPIO/buttons and all other
  peripherals are out of scope.
- **CR-5** — Target is **bare libDaisy/DaisySP**, not Arduino/DaisyDuino. v1 test cases are the
  official examples (§5); porting the user's DaisyDuino effects is **optional later** work (R9).

---

## 5. v1 test cases

The official **bare-libDaisy examples** in `daisy-seed-knowledge/examples` are the primary v1 test
cases — already pots-only and needing **no port**. Tagged by callback form (04 §4.1), since v1.0 is
interleaved-only:
- **`bypass`** *(interleaved → v1.0)* — passthrough (audio in→out); smallest end-to-end check.
- **`Osc`** *(interleaved → v1.0)* — ADC0 knob → oscillator pitch; DaisySP `Oscillator`. Covers the
  AC-2 ADC-mapping proof in v1.0.
- **`Knob`** *(no audio → v1.0)* — ADC read loop; ADC-only sanity (callback-form-agnostic).
- **`inout`** *(non-interleaved/block → v1.1)* — ADC0 knob → output volume; a second AC-2 ADC-mapping
  check, and the first block-form example to run once v1.1 lands.

The user's `tremolo`/`equalizzatore` (DaisyDuino) may be **ported later** (optional, R9) as richer
test effects but are not required for v1.

---

## 6. Out of scope for v1 (deferred)

- **v2:** in-IDE hardware-target build + DFU flashing (D9, FR-BU-2/FR-DE-4); buttons / GPIO /
  `Switch` controllers; live host audio input (priority); WAV file input; host-speaker monitoring;
  spectrum view; full debug (step over/into/out, variables, watch, call stack); auto-derived
  controllers; built-in board control maps; parameter automation; session recording; MIDI.
- **v3:** optional high-fidelity mode (QEMU/Renode / hardware-in-the-loop); additional peripherals
  (MIDI, display); remote debugging on real hardware; Daisy Patch/Petal support; project templates.

---

## 7. Open items (assumptions to confirm)

| Ref | Open question | Current assumption |
|-----|---------------|--------------------|
| (arch) | Emulator in-process vs out-of-process | **RESOLVED in 04 §1: out-of-process.** |
| (v2) | ARM toolchain bundle vs detect | Deferred — only matters when in-IDE hardware build returns (D9) |

---

## 8. Acceptance criteria (v1)

- **AC-1** — A ported pots-only effect builds for the emulator (FR-BU-1), deploys (FR-DE-1), and runs
  on Start (FR-RU-1).
- **AC-2** — Moving an on-screen pot visibly changes the output on the scope (FR-CT-3, FR-AU-3),
  proving ADC mapping.
- **AC-4** — A breakpoint inside the audio callback is hit on run-in-debug; the UI shows the line;
  simulated time is frozen; Continue resumes; Stop ends (FR-DB-3/4/5).
- **AC-5** — Inducing a NaN/clipping bug is flagged (FR-RU-4).
- **AC-6** — After adding ds-ide to the project, the user's existing **external** hardware build
  still works unchanged (NFR-5).
- **AC-7** — The full edit→…→recompile loop is < 30 s for a small change (NFR-1).
- **AC-8** *(v1.1, not a v1.0 gate)* — A **non-interleaved/block-form** example (`inout`) builds, runs,
  and its pot visibly drives the output on the scope — proving the second `StartAudio` overload and
  block buffer marshalling, with no regression to the interleaved corpus (FR-RU-2 / FR-SH-2,
  block part; 04 §4.1). Closed at **M7**.

*(AC-3 — button/GPIO — removed: pots-only v1.)*
*(AC-8 is the only v1.1 criterion; AC-1…AC-7 fully define v1.0.)*
