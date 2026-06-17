# 03 — Requirements (v2)

> **v1 complete.** All v1 requirements (FR-ED, FR-BU, FR-DE, FR-RU, FR-AU, FR-CT, FR-SH, FR-DB,
> FR-CF, NFR-1…NFR-10, CR-1…CR-5) were implemented and all ACs (AC-1…AC-8) are green across
> ds-ide 0.1.0–0.1.7. Archived: `docs/v1/03_requirements.md`.

Clear, testable requirements for **ds-ide v2**, derived from [01_input-ideas.md](01_input-ideas.md)
and the bets/risks in [02_assumptions-and-risks.md](02_assumptions-and-risks.md).

**Conventions** (same as v1)
- IDs: `FR-*` functional · `NFR-*` non-functional · `CR-*` constraint. Stable; referenced by tests.
- "**shall**" = a v2 commitment. Items pending decisions are marked `> ⚠️ ASSUMPTION:`.
- IDs continue from v1 (new FRs start at FR-AU-5, FR-CT-7, etc.; new NFRs start at NFR-11).

**v2 in one sentence:** extend ds-ide so the developer can play live audio through their effect
in real time on the desktop, interact with virtual buttons alongside pots, inspect variables
while stepping through the audio callback, and flash to real hardware without leaving the IDE.

---

## 1. Inherited v1 decisions (carried forward, not re-litigated)

| Ref | Decision |
|-----|----------|
| D1 | Native host simulation (Option A). |
| D2 | VS Code extension. |
| D3 | Bare libDaisy/DaisySP C++. |
| D4 | macOS-first; cross-platform where practical. |
| D6 (was visualization-only) | **Extended in v2:** host-speaker output is now in scope. |
| D8 (was breakpoints-only) | **Extended in v2:** full stepping/variables/call-stack. |
| D9 (was emulator-only) | **Resolved in v2:** in-IDE hardware build + DFU flash are in scope. |

---

## 2. New v2 foundational decisions

| Ref | Decision |
|-----|----------|
| **D10** | **v2 audio input: live host input (priority), WAV file, or sine.** Sine remains as fallback; live input is the headline feature. |
| **D11** | **v2 audio output: host speaker monitoring** (real-time). Once live, the engine must meet a hard audio deadline. |
| **D12** | **v2 controllers: buttons / GPIO / Switch** (in addition to v1 pots). |
| **D13** | **v2 debug: full stepping + variable inspection** (step over/into/out, variables, watch, call stack). |
| **D14** | **v2 hardware path: in-IDE arm-none-eabi build + DFU flash.** |

> ⚠️ ASSUMPTION: D10–D14 are the confirmed v2 scope. Phasing within v2 (which lands first) is
> recorded in [05_dev-plan.md](05_dev-plan.md) and subject to revision.

---

## 3. Functional requirements

### 3.1 Live audio I/O (`FR-AU-5…FR-AU-9`)

- **FR-AU-5** — ds-ide shall support **live host audio input** as an audio source: route the
  host microphone or line input into the emulator input buffer in real time. **Verify:** AC-9.
- **FR-AU-6** — ds-ide shall support **WAV file input**: load a WAV file and feed it as the
  input buffer (looping or one-shot). **Verify:** AC-10.
- **FR-AU-7** — The audio source shall be user-selectable via an **input source selector** in
  the UI: *sine generator* (v1) / *live host input* / *WAV file*.
- **FR-AU-8** — ds-ide shall route the emulator's output buffer to the **host audio output
  device** (speaker / line out) in real time. **Verify:** AC-9.
- **FR-AU-9** — The buffer size for host audio I/O shall be user-configurable (e.g. 64, 128,
  256, 512 samples). ds-ide shall display the measured round-trip latency and an xrun counter.
  *(Mitigates R12, R13.)*

### 3.2 Virtual buttons & GPIO (`FR-CT-7…FR-CT-11`)

- **FR-CT-7** — `controllers.yaml` shall support a `buttons:` section alongside `pots:`,
  declaring each button: `id`, `label`, `gpio_pin`, `mode` (momentary/toggle), `active_level`.
- **FR-CT-8** — ds-ide shall render a button per declared entry in the controller panel.
- **FR-CT-9** — Pressing a virtual button shall update the GPIO/`Switch` state returned by
  the corresponding `Switch::Debounce()` / `Switch::Pressed()` / `Switch::RisingEdge()` in
  real time (within NFR-3's ≤ 50 ms). Updates shall work from `loop()` and from `AudioCallback`.
  **Verify:** AC-11.
- **FR-CT-10** — The `Switch` shim shall implement `Debounce()`, `Pressed()`, `RisingEdge()`,
  and `FallingEdge()` backed by the IPC virtual button state. *(Upgrades the v1 stub.)*
- **FR-CT-11** — Controller state (pots + buttons) shall persist across re-deploys within a
  session (extending v1 FR-CT-4).

### 3.3 Full debug (`FR-DB-7…FR-DB-10`)

- **FR-DB-7** — ds-ide shall provide **step over, step into, step out** while paused at a
  breakpoint. **Verify:** AC-12.
- **FR-DB-8** — ds-ide shall display **local and global variable values** while paused. **Verify:** AC-12.
- **FR-DB-9** — ds-ide shall support **watch expressions**.
- **FR-DB-10** — ds-ide shall display the **call stack** while paused.

> ⚠️ ASSUMPTION: All of FR-DB-7…FR-DB-10 are exposed via the existing lldb-dap backend
> (C6) with extension-side wiring only, per A12. If stepping into the audio callback causes
> xruns when host audio is live, the runtime shall mute the audio device on breakpoint hit
> (mitigates R15).

### 3.4 In-IDE hardware build & flash (`FR-HW-1…FR-HW-4`)

- **FR-HW-1** — ds-ide shall invoke the project's existing **hardware-target build** (`make`
  / `arm-none-eabi-g++`) as a first-class IDE action, showing diagnostics in the Problems panel.
- **FR-HW-2** — ds-ide shall detect the `arm-none-eabi` toolchain (known install paths,
  configurable setting) and surface a clear install hint if not found. *(Mitigates R16.)*
- **FR-HW-3** — ds-ide shall invoke **`dfu-util`** to flash the built ELF/bin to a connected
  Daisy Seed in bootloader mode, showing flash progress and errors. *(Mitigates R17.)*
- **FR-HW-4** — In-IDE hardware build + flash shall not interfere with the emulator build
  or IPC state (NFR-5 extended).

### 3.5 Visualization (`FR-VZ-1…FR-VZ-3`)

- **FR-VZ-1** — ds-ide shall display a **spectrum / FFT view** of the input and output
  signals alongside the existing waveform scope.
- **FR-VZ-2** — ds-ide shall support **session recording**: record a run (input, output,
  and pot/button timeline) to a file for later replay and comparison.
- **FR-VZ-3** — ds-ide shall support **parameter automation**: record a pot-movement timeline
  during a session and replay it for reproducible test sweeps.

---

## 4. Non-functional requirements (new/updated)

- **NFR-11 (Real-time audio)** — When host speaker output is active (D11), the audio engine
  shall meet the OS callback deadline at the configured buffer size on a standard modern
  developer laptop. An xrun counter shall be visible at all times.
- **NFR-12 (Round-trip latency)** — ds-ide shall display the measured round-trip audio latency
  (input → effect → output). The target is ≤ 30 ms at the default buffer size (256 samples
  @ 48 kHz ≈ 5 ms one-way); achievability depends on the host audio interface.
- **NFR-4 (Platform, updated)** — v2 host-audio work introduces the first real cross-platform
  surface. macOS (CoreAudio) is primary; Windows (WASAPI) and Linux (ALSA/JACK) are
  secondary and may ship in later v2.x milestones. *(Extends v1 NFR-4.)*

---

## 5. Constraints (v2)

- **CR-6** — The v1 emulator build and visualization-only mode shall remain available;
  v2 features are additive.
- **CR-7** — The host audio API dependency shall be MIT/permissive licensed.

---

## 6. Out of scope for v2 (deferred to v3+)

- QEMU / Renode high-fidelity mode (v3).
- MIDI (may move to v2 if the shim is trivial; currently v3).
- Daisy Patch/Petal per-board examples beyond the control maps (v3).
- Remote debugging on real hardware (v3).
- JetBrains plugin (v3+).

---

## 7. Open items

| Ref | Open question | Current assumption |
|-----|---------------|--------------------|
| Open #1 (01) | ARM toolchain bundle vs detect | Detect + hint (FR-HW-2); bundle deferred |
| Open #2 (01) | Host audio API: PortAudio vs native | TBD — resolve before M8 |
| Open #3 (01) | Live input + speaker together or sequenced | Together (same device) |
| Open #4 (01) | Simulated clock kept alongside real-time clock | Keep for WAV/regression mode |
| R15 (02) | Stepping into audio callback while OS audio live | Mute audio on breakpoint hit |

---

## 8. Acceptance criteria (v2)

- **AC-9** — Live audio: connect a host audio input (mic/line), select it as the source,
  start the emulator, and hear the effect applied to the live signal through the host
  speakers. *(FR-AU-5, FR-AU-8)*
- **AC-10** — WAV file: load a WAV, start the emulator, output waveform matches expected
  transformation of the WAV. *(FR-AU-6)*
- **AC-11** — Virtual button: pressing a virtual button visibly changes the effect output
  (e.g. bypass toggle). *(FR-CT-9)*
- **AC-12** — Full debug: step over/into a line inside `AudioCallback`; inspect a local
  variable value; view the call stack. *(FR-DB-7, FR-DB-8, FR-DB-10)*
- **AC-13** — Hardware build + flash: build the project for hardware and flash to a
  connected Daisy Seed without leaving ds-ide. *(FR-HW-1, FR-HW-3)*
- **AC-14** — Spectrum: with an effect running, a sine input produces a visible spike in
  the FFT output at the expected frequency. *(FR-VZ-1)*
