# 01 — Input Ideas

Synthesis of all raw contributions in `docs/raw/` (`contribution_1`…`contribution_5`).
This document extracts the concrete decisions, constraints, feature ideas, and insights
present in the source material, grouped by theme. Nothing has been invented or inferred.
Contradictions between sources are **not** resolved here — they are listed in
[Open Conflicts](#open-conflicts) at the end.

---

## 1. Vision & Goals

- **Core value is shortening the feedback loop**, not emulating the Daisy Seed CPU. The value is a
  desktop environment where Daisy effects can be compiled, run, inspected, and interacted with
  as if deployed to hardware. *(contribution_1, contribution_5)*
- Replace the slow loop `edit → compile → flash hardware → test on instrument → reason → fix`
  with `edit → compile → deploy to emulator → execute → debug → fix`. *(all)*
- The emulator **does not replace** physical hardware; it provides a controlled, reproducible
  environment for early-stage development, logic/DSP iteration, and debugging. Final validation —
  especially CPU/RAM headroom — still happens on the Seed. *(contribution_2, contribution_5)*
- Target domain: audio effects / DSP (e.g. guitar pedals) for the Electro-Smith Daisy Seed
  (STM32H750, Cortex-M7), written in C++ on `libDaisy` + `DaisySP`. *(all)*

### Stated goals (contribution_5)
- **G1** — Collapse the inner loop (build → run → observe) to seconds, no hardware in the path.
- **G2** — Interact with the running effect via on-screen controllers (pots, buttons) mapped to
  the same ADC/GPIO code the firmware reads.
- **G3** — See what the audio path is doing (at minimum input vs output waveform).
- **G4** — Stop time and inspect: set breakpoints, run, pause, continue/stop.
- **G5** — Reuse the standard Daisy toolchain; do not reinvent compilation/flashing.

---

## 2. Emulation Strategy

Two fundamental approaches appear across the sources:

- **Native host simulation / HAL mock (Option A):** recompile the user's effect *for the host CPU*,
  replacing libDaisy's hardware layer with a software shim that routes audio I/O to synthetic
  signals / host audio and ADC/GPIO reads to UI controls. DaisySP and user DSP are portable C++.
  - Pros: fast inner loop, trivial native debugging (lldb/gdb, real breakpoints), low effort,
    easy to "freeze time."
  - Cons: does not catch hardware-specific bugs; requires host-portable source; needs a shim
    covering the used API surface.
  - *Recommended/decided by contribution_1, contribution_3, contribution_4 (leaning), contribution_5 (decided for v1).*
- **Instruction-set / ISA emulation (Option B):** build the real ARM binary and run it under QEMU
  (or Renode, or a custom Cortex-M7 Thumb-2 interpreter) with an STM32H7 machine model, intercepting
  memory accesses to peripheral registers (ADC/GPIO) and routing them to virtual controls.
  - Pros: runs the exact flashed artifact; highest fidelity.
  - Cons: STM32H7 peripheral support (SAI/I²S codec, SDRAM, QSPI) is incomplete in QEMU; hard to
    keep real-time audio fluid; large effort; breakpoints require gdb-remote.
  - *Treated as a real baseline option by contribution_2; deferred/likely-never by contribution_5.*

- **Phased hybrid (Option C):** ship Option A first, optionally add Option B / hardware-in-the-loop
  high-fidelity mode later. *(contribution_5; echoed as phasing by contribution_1)*

> **Known blind spot of native simulation:** it runs on the desktop CPU, so it verifies
> *correctness*, not the Seed's real-time CPU/RAM budget. An effect can be glitch-free in the
> emulator and still overrun or exhaust memory on the M7. *(contribution_5)*

---

## 3. IDE / Technology Stack

- **VS Code extension** is the recommended/decided foundation: reuses editor, DAP-based debug UI,
  terminal, tasks, and the official Daisy C++ workflow (build tasks + `marus25` Cortex-Debug);
  the emulator becomes a webview panel plus a custom debug adapter and build tasks.
  *(contribution_1 recommends; contribution_5 decides)*
- Alternatives raised: standalone desktop app (Electron, Tauri, Qt, JUCE, C# WPF), or a JetBrains
  plugin. *(contribution_1, contribution_3, contribution_4)*
- Cross-platform UI framework not prescribed by contribution_2; it requires only that the emulator
  expose a clean C/C++ or IPC API for the IDE to control it.
- The stack decision affects 30–40% of the architecture. *(contribution_1)*

---

## 4. Build & Toolchain Integration

- Integrate the **standard Daisy toolchain** (`arm-none-eabi-gcc`/`g++`, `make`/`cmake`, newlib,
  `libDaisy`, `DaisySP`); do not reinvent the build. *(all)*
- One-click / single-action **Build** command. *(all)*
- Parse and display compiler output (errors/warnings) in a dedicated panel with **clickable
  file/line references**. *(all)*
- Support standard Daisy project structures (`Makefile`/`CMakeLists.txt`, `src/`, `Debug/`,
  libDaisy/DaisySP as submodules or referenced dirs). *(contribution_3, contribution_4, contribution_5)*
- Build configurations: Debug includes debug symbols; debug emulator build uses `-O0 -g`.
  *(contribution_2, contribution_5)*
- Compilation produces an ELF (or `.bin`/`.hex`) artifact. *(contribution_2, contribution_3)*
- **Two build targets** (under native approach): an *emulator target* (host compile against the
  host libDaisy shim) and a *hardware target* (standard ARM toolchain, unchanged). *(contribution_5)*
- Detect and report non-host-portable source (hardware-only headers/intrinsics) with an actionable
  message instead of a raw linker error. *(contribution_5)*
- Code navigation: go-to-definition / find-references for libDaisy/DaisySP headers. *(contribution_3)*

---

## 5. Deployment

- **"Deploy to Emulator"** loads the compiled binary into the emulator runtime instead of flashing
  hardware. *(all)*
- Emulator **resets internal state** (memory, peripherals, audio buffers) on each deployment.
  *(contribution_2)*
- Provide visual feedback / status on deployment success or failure (e.g. invalid ELF, missing
  symbols). *(contribution_1, contribution_2, contribution_3)*
- **Reload/redeploy on rebuild** without restarting the IDE; ideally without losing controller
  positions. *(contribution_1 FR-DP-002, contribution_5 FR-DE-2)*
- Retain hardware DFU deploy (`dfu-util`, BOOT+RESET) inside the IDE as the periodic reality check.
  *(contribution_5; v1 inclusion is an open question, §13 Q4)*

---

## 6. Execution & Audio

- **Transport controls:** Start / Stop (and Pause / Reset / Restart). *(all)*
- Continuously process audio blocks at a configurable sample rate. **Default 48 kHz.**
  *(contribution_2, contribution_5)*
- **Audio input — v1: internal sine-wave generator** feeding the audio input buffer.
  Configurable frequency (default 440 Hz) and amplitude. *(all)*
- Run the user's `AudioCallback` with correct buffer shape (channel count, block size, sample rate)
  matching libDaisy semantics. *(contribution_5)*
- **Audio output to host audio device** (CoreAudio / WASAPI/ASIO / ALSA/JACK) for real-time
  monitoring. *(contribution_1, contribution_2, contribution_4; optional/TBD in contribution_5)*
- **Output visualization:** waveform/oscilloscope of input vs output. *(contribution_3, contribution_5
  in v1; contribution_1 places scope in Phase 2; contribution_2 leaves as open question)*
- Output level meter. *(contribution_1)*
- Robustness: if the callback throws / produces NaN / blows the deadline, stop cleanly and report
  rather than crashing the IDE; surface NaN/Inf/denormal and clipping indicators. *(contribution_5)*
- Runtime status display: sample rate, buffer/block size, CPU load estimate; report audio
  underruns (xruns). *(contribution_1, contribution_5)*

### Audio block size
- Candidate sizes: 64 / 128 / 256 samples, or user-configurable. *(contribution_2)*
- Default block size 48 (libDaisy default), configurable. *(contribution_5)*

---

## 7. Virtual Controls / Hardware Interface

> **DECISION (v1 scope): potentiometers only.** v1 ships **virtual potentiometers (ADC)** and
> **no buttons/switches** — the user's real effects (`tremolo`, `equalizzatore`) are pots-only, and
> this keeps v1 minimal. **Buttons / GPIO / `Switch` move to v2.** The button-related items below
> are retained as raw input but are **deferred** for v1.

- The user creates/configures **virtual potentiometers** and **virtual buttons/switches**,
  manipulable in real time. *(all)* — *v1: potentiometers only; buttons/switches → v2.*
- **Potentiometers** output a normalized float (0.0–1.0) to mapped ADC channels; support name,
  min/max/range, current value, and (contribution_5) taper (linear/log/antilog) and default.
  *(contribution_1, contribution_3, contribution_4, contribution_5)*
- **Buttons/switches** drive GPIO pin state (high/low); support press, release, toggle/momentary,
  active level, and debounce. *(contribution_1, contribution_3, contribution_5)*
- **Configurable mapping** between virtual controls and Daisy pins (ADC channel / GPIO pin); a
  default mapping is provided. *(contribution_2, contribution_3, contribution_4, contribution_5)*
- Mapping mechanisms proposed: JSON config file, YAML config (`controllers.yaml`), a visual
  designer, drag-and-drop "patch bay" UI, or automatic source parsing/auto-derivation.
  - Phasing proposed (contribution_1): Phase 1 → JSON, Phase 2 → visual designer, Phase 3 → auto-discovery.
  - contribution_5: declarative config (YAML) is the v1 source of truth; auto-derive from
    `AdcChannelConfig` / pin init is v2.
- Real-time interaction: moving a UI pot updates `adc.GetFloat(channel)`; pressing a button updates
  the GPIO/`Switch` state, including while paused in debug. *(contribution_2, contribution_3,
  contribution_4, contribution_5)*
- Controller state persists across re-deploys within a session. *(contribution_5)*
- Validate config (duplicate channels, missing fields) with clear errors. *(contribution_5)*
- Default control counts proposed: 4 pots + 2 buttons / 8 pots + 4 buttons / user-customizable
  (Daisy Seed has up to 8 ADC channels). *(contribution_2)*
- Controls displayed in a dedicated panel; layout persisted. *(contribution_1)*
- **Target is the bare Daisy Seed with user-wired controls** (decided, contribution_5 Q2);
  fixed-board control maps (Pod/Patch/Petal/Field/Terrarium) are out of v1 scope.

---

## 8. Daisy API / Host Shim Scope

The host libDaisy shim (native approach) only needs to cover the API surface the effects touch.
*(contribution_5; API mapping also in contribution_1)*

- `DaisySeed` init/config; `System` timing helpers. *(contribution_1, contribution_5)*
- Audio: `AudioHandle` config (sample rate, block size, channels), `StartAudio(callback)`, buffer
  marshalling matching libDaisy interleaving/types; `AudioCallback` runs on desktop audio buffers.
  *(contribution_1, contribution_5)*
- ADC: `AdcHandle` init + `GetFloat(channel)` driven by the controller panel
  (`hw.adc.GetFloat(...)` reads virtual control values). *(contribution_1, contribution_5)*
- GPIO / `Switch`: `switch.Debounce()`, `switch.Pressed()` operate on virtual buttons, with
  debounce semantics. *(contribution_1, contribution_5)* — **DEFERRED to v2** (pots-only v1).
- System utilities: Delay, timing APIs, logging (covers the effects' `Serial`/`delay` usage).
  *(contribution_1)*
- Stubs that no-op or warn for unsupported peripherals (SD, MIDI, display) so code still links,
  with a clear "not emulated" notice. *(contribution_5)*
- **Shim surface pinned to actual source** (`mydaisyseed` review, see 02 §3): init/sample-rate,
  interleaved→non-interleaved audio callback, `AdcHandle.GetFloat`, plus `Serial`/`delay` stubs.
  DaisySP `MoogLadder` runs unchanged. *(resolved — was open action Q5)*

---

## 9. Debugging

- **Add/remove breakpoints** via the editor gutter (Debug builds only). *(all)*
- Execution **pauses/halts at breakpoints** (including inside the audio callback); current line is
  highlighted. *(all)*
- **Continue / Resume** and **Stop / Detach**. *(all)*
- **Freeze simulated audio time while paused** so inspection can take unlimited time without xruns —
  an advantage over hardware debugging. *(contribution_5)*
- The debugger should not require manual GDB-server setup; a lightweight built-in debug stub is
  acceptable, or drive native lldb/gdb behind a DAP-style interface. *(contribution_2, contribution_5)*
- No code changes (e.g. `#ifdef DEBUG`) required to switch from Run to Debug. *(contribution_3)*

### Stepping, variables, call stack — scope varies (see Open Conflicts)
- contribution_1: Step over / into / out, local + global variables, call stack — all required.
- contribution_2: Step-over + variables required; step-into and call stack are open questions.
- contribution_3: Continue, Step Over, Step Into, variables.
- contribution_4: Step Over / Into / Out, Continue, variable inspection.
- contribution_5: v1 = breakpoints + run/pause/continue/stop only; stepping, variables, watch, and
  call stack deferred to v2.

---

## 10. Persistence & Configuration

- Persist: breakpoints, window/UI layout, control layout (including virtual hardware setups),
  emulator settings, build settings. *(contribution_1, contribution_4)*
- Controller configuration file in the project root (JSON or YAML). *(contribution_1, contribution_5)*
- Runtime reconfiguration: controls may be added/removed without rebuilding. *(contribution_1)*

---

## 11. UI Layout

Proposed main layout *(contribution_1)*:

```
+--------------------------------------------------+
| Menu                                             |
+------------+----------------------+--------------+
| Explorer   | Editor               | Controls     |
| (project   | (effect.cpp)         | (Drive Pot,  |
|  files)    |                      |  Tone Pot,   |
|            |                      |  Bypass Btn) |
+------------+----------------------+--------------+
| Build / Debug Console                            |
+--------------------------------------------------+
| Audio Monitor                                    |
+--------------------------------------------------+
```

Panels referenced across sources: file explorer, source editor, controller panel, build/problems
console, debug variables/watch panel, audio monitor / scope.

---

## 12. Non-Functional Requirements

- **Performance / real-time:** process audio in real-time (or near/faster than real-time) on a
  standard modern developer laptop (Intel i5 / Ryzen 5, 8 GB RAM). Block processing should not
  exceed ~80% of block duration to avoid underruns. *(contribution_2, contribution_3, contribution_4)*
- **Inner-loop latency:** edit → build → running emulation in single-digit seconds for a small
  effect; full edit→compile→deploy→run→debug→fix→recompile cycle < 30 s for a small change.
  *(contribution_2, contribution_5)*
- **Control responsiveness:** UI control latency under 20 ms (contribution_1) / under 50 ms
  (contribution_2).
- **Performance budgets:** build launch < 2 s overhead; emulator startup < 1 s. *(contribution_1)*
- **Platform:** **macOS / Apple Silicon is the primary dev/test target** (the user's machine), but
  this is a *priority*, not an OS-locked design. Keep code cross-platform where practical (VS Code +
  the chosen audio/host APIs make this largely free); accept minor platform gaps in v1 and defer
  them rather than letting cross-platform purity slow the first version. Windows secondary, Linux
  desirable. *(synthesized from contribution_2/4/5 + user direction)*
- **Stability/isolation:** do not crash on invalid ELF; report meaningful errors. Build failures
  must not crash the IDE; emulator crashes isolated; runtime exceptions reported. *(contribution_1,
  contribution_2)*
- **Fidelity caveat (must be visible to the user):** the emulator approximates the Seed; floating-
  point, timing, denormals, and peripheral behaviour may differ; it does NOT validate the Seed's
  real-time CPU/RAM budget. Must not imply bit-exactness. *(contribution_5)*
- **No regression to hardware path:** using the IDE must not change/break the standard hardware
  build/flash. *(contribution_5)*
- **Determinism:** same input signal + controller values → reproducible run. *(contribution_5)*
- **Maintainability/modularity:** separate peripheral emulation, audio I/O, and debug interface
  (contribution_2 also lists CPU emulation as a module). *(contribution_2)*
- **Compatibility:** compile and run unmodified `libDaisy`/`DaisySP` C++ code. *(contribution_3)*
- **Licensing:** libDaisy and DaisySP are MIT; bundling/wrapping is fine; track licenses of any
  bundled toolchain/emulator components. *(contribution_5)*
- **Usability:** a user who can flash a Seed today should run their effect in the emulator without
  a manual. *(contribution_5)*

---

## 13. Scope Boundaries (Non-Goals / Out of Scope for v1)

- Cycle-accurate / bit-exact / instruction-level STM32 emulation; registers, DMA, interrupt
  controllers; functional emulation is sufficient. *(contribution_1, contribution_2, contribution_5)*
- DSP performance profiling. *(contribution_1)*
- Non-audio peripherals: MIDI, USB, SD card, OLED/Pod displays, SPI/I²C devices, CV/Gate.
  *(contribution_1, contribution_2, contribution_5)*
- Multi-board support; Daisy Patch / Petal / fixed-board support. *(contribution_1, contribution_5)*
- Visual/patch (Max gen~, Pd) authoring layer — target is C++ source. *(contribution_5)*
- **Arduino / DaisyDuino sketches** — out of scope. *(CR-1, contribution_5)*. **Decided:** ds-ide
  targets **bare libDaisy/DaisySP** C++. v1 test cases are the **official bare-libDaisy examples**
  in `daisy-seed-knowledge/examples` (`bypass`, `inout`, `Knob`, `Osc`) — already pots-only, no port
  needed (02 R9 downgraded). The user's DaisyDuino effects may be **ported later** (optional).
  Arduino support itself may be reconsidered in a later version, not v1.
- Replacing hardware testing entirely. *(contribution_5)*

---

## 14. Roadmap / Phasing

- **v1 / Phase 1:** open effect → build for emulator → load → Start (sine input) → move on-screen
  **pots (ADC only)** → see input vs output waveform → set/remove breakpoints, run in debug, pause
  (time frozen), continue, stop. *(contribution_5; pots-only per v1 scope decision)*
- **v2 / Phase 2:** **buttons / GPIO / `Switch` controllers**, live host audio input (priority —
  closest analogue to "play guitar through the Seed"), WAV file input, host-speaker monitoring,
  spectrum view, full debug (stepping/variables/watch/call stack), auto-derived controllers,
  built-in board control maps, parameter automation, session recording, real guitar input, MIDI,
  oscilloscope. *(contribution_1, contribution_2, contribution_5)*
- **v3 / Phase 3:** optional high-fidelity mode (QEMU/Renode and/or hardware-in-the-loop),
  additional peripherals (MIDI, display), remote debugging on real hardware, Daisy Patch/Petal
  support, project templates & sharing. *(contribution_1, contribution_5)*

---

## 15. Acceptance Criteria (proposed)

From contribution_2 and contribution_5:

- A known **pots-only** effect (e.g. the ported `tremolo` or `equalizzatore`, or a simple overdrive
  reading one "drive" pot) builds for the emulator and runs.
- Moving a virtual pot visibly changes the output on the scope (demonstrating ADC emulation).
- ~~Pressing a virtual button toggles internal state / makes output == input (demonstrating GPIO).~~
  **Deferred to v2** (pots-only v1; no button path in v1, R10).
- A breakpoint inside `ProcessBlock` / the audio callback is hit; the UI shows the line; the audio
  clock is frozen; Continue resumes; Stop ends.
- A local variable's value can be inspected at the breakpoint. *(contribution_2 — see conflict with
  contribution_5's v1 debug scope)*
- A NaN/clipping bug is flagged. *(contribution_5)*
- The full edit→…→recompile loop takes < 30 s for a small change. *(contribution_2)*
- The standard hardware build still works unchanged. *(contribution_5)*

---

## 16. Open Decisions (raised, not yet decided — distinct from conflicts)

These are gaps the sources flagged for the user; they are unresolved but not contradictory:

- Toolchain: **bundle** the ARM toolchain for one-click setup vs **rely on user-installed**.
  *(contribution_2 Q9, contribution_5 Q5/FR-CO-5)*
- Emulator runs **in-process** (simpler) vs **out-of-process** (more robust, IPC overhead).
  *(contribution_2 Q8; contribution_1 ER-002 leans isolated/out-of-process)*
- ~~Default count of virtual pots/buttons~~ → **RESOLVED: config-driven** (declarative, pots-only). *(03 FR-CT-6)*
- ~~Peripheral emulation scope~~ → **RESOLVED: v1 = audio + ADC pots only.** *(03 CR-4)*
- Whether sine-generator frequency/amplitude is adjustable or fixed in v1. *(contribution_5 Q7)* — *assumed adjustable (03 FR-AU-2).*
- ~~Whether hardware DFU deploy is retained inside the IDE in v1~~ → **RESOLVED: emulator-only v1;
  no in-IDE hardware build/flash; external workflow untouched.** *(03 D9)*
- Priority of the live-guitar-input feature in v2. *(contribution_5 Q8)*
- Emulator in-process vs out-of-process — deferred to **04_architecture**. *(contribution_2 Q8)*
- User to share actual effect source to pin the exact shim surface. *(contribution_5 Q5)*

---

## Open Conflicts

Contradictions between sources that require a user decision. Listed, not resolved.

1. **Emulation strategy — native mocking vs ISA emulation.**
   **✅ RESOLVED: Option A (native host simulation / HAL mock) for v1.** Recompile the effect for
   the host CPU against a host libDaisy shim; ISA emulation (QEMU/Renode) deferred and likely never
   built. contribution_2's opposing premise (CPU emulation as a module, Cortex-M7 Thumb-2
   interpretation, memory-mapped peripheral interception, QEMU "preferred for accuracy") is
   therefore **not adopted**.

2. **"Same binary on both targets" vs separate host/ARM builds.**
   **✅ RESOLVED by Conflict #1.** Under Option A the emulator build is a *host* build and only the
   hardware build uses the ARM toolchain, so contribution_2's acceptance criterion — "Compilation
   produces a binary that runs on both physical hardware and the emulator without code changes" — is
   **superseded**. There are two distinct build targets; the same binary does not run on both.

3. **v1 debugging depth — breakpoints-only vs full stepping/variables.**
   **✅ RESOLVED: breakpoints-only for v1** — add/remove breakpoints + run / pause / continue /
   stop, with simulated time frozen while paused. Stepping (over/into/out), variable/watch
   inspection, and call stack are deferred to v2 (they come cheaply once the native lldb/gdb + DAP
   backend exists, but are not a v1 commitment). The fuller debug scope in contribution_1/3/4 and
   contribution_2's "inspect a local variable at a breakpoint" acceptance criterion are **moved to
   v2**.

4. **Audible host-speaker output in v1 — required vs optional.**
   **✅ RESOLVED: visualization-only for v1; host-speaker monitoring moves to v2.** v1 feedback is
   input-vs-output waveform visualization; the engine therefore need not meet a hard real-time
   audio deadline and may run faster- or slower-than-real-time. The host-sound-card streaming
   required in v1 by contribution_1 (FR-AU-004) / contribution_2 (EXE-04) / contribution_4 is
   **moved to v2**. (Consequently the real-time-audio NFR applies only once monitoring lands in v2.)

5. **Waveform/oscilloscope visualization — v1 vs Phase 2.**
   **✅ RESOLVED: input/output waveform scope in v1 (the primary feedback); spectrum analyzer in
   v2.** contribution_3 (FR-4.3) and contribution_5 (FR-RU-5) agree on waveform in v1; contribution_1's
   Phase-2 oscilloscope is **pulled into v1**, while its spectrum analyzer and contribution_2's
   spectrum option (Q10) **stay in v2**.

6. **Audio input sources in v1 — sine-only vs sine + microphone.**
   **✅ RESOLVED: sine-only for v1; WAV file and live/microphone input in v2.** The internal sine
   generator is the sole v1 input source. contribution_1's FR-AU-001 listing of Microphone/WAV as
   v1 sources is **superseded** (and conflicted with its own Q5, which already recommended Phase 2).
   Consistent with live-guitar input being the priority v2 item.

7. **Primary operating system — Windows-first vs macOS/Apple-Silicon-first.**
   **✅ RESOLVED: macOS / Apple Silicon is the primary dev/test target** (the user's current dev
   machine) — but as a *priority, not an OS-locked design*. Keep code cross-platform where practical;
   accept minor platform gaps in v1 and defer them pragmatically. Windows secondary, Linux desirable.
   contribution_5's Windows-first default is **overridden**. (Clarified: the "Visual Studio" references in the project context and
   contribution_5 actually mean **VS Code** — the cross-platform editor, native on macOS — not the
   Windows-only full Visual Studio IDE. So no editor/OS conflict exists; the editor decision
   (Conflict #9) and macOS-first are mutually consistent. Remaining open item, tracked separately:
   confirm the retained hardware build/flash path — `arm-none-eabi-g++` + `dfu-util` — runs on macOS
   so the hardware reality check isn't Windows-bound.)

8. **Default audio block size.**
   **✅ RESOLVED: default 48 samples (the libDaisy default), user-configurable.** Matches the real
   Seed's default so the emulator behaves like hardware out of the box; contribution_2's 64/128/256
   become selectable alternatives rather than the default.

9. **IDE foundation — decided vs open.**
   **✅ RESOLVED: VS Code extension.** Reuses the official Daisy C++ workflow (build tasks +
   `marus25` Cortex-Debug), the DAP debug UI, terminal, and tasks; the emulator becomes a webview
   panel + custom debug adapter + build tasks. The standalone-desktop-app alternative
   (contribution_3/4) and contribution_2's unprescribed framework are **not adopted**.
