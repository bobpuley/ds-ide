# ds-ide — Daisy Seed Emulator & IDE — Requirements

| | |
|---|---|
| **Document** | Product / Engineering Requirements |
| **Status** | Draft v0.2 — three pivotal decisions locked (§13 Q1–Q3); remaining assumptions tagged `[ASSUMPTION]`, open items in §13 Q4–Q8 |
| **Owner** | _(you)_ |
| **Last updated** | 2026-06-16 |

> **How to read this document.** Every requirement has an ID (`FR-*` functional, `NFR-*` non-functional, `CR-*` constraint) so we can trace and check them off. Where I had to guess, I wrote `[ASSUMPTION]` — please confirm or correct each one. Decisions I need from you before this can be finalised are collected in **§13 Open questions**, each with my recommended default so the document is usable even before you answer.

---

## 1. Problem statement

You build audio effects for the [Electro-Smith Daisy Seed](https://electro-smith.com/products/daisy-seed) (STM32H750, Cortex-M7, 96 kHz/24-bit stereo codec) in C++ on top of `libDaisy` + `DaisySP`. Today the only way to hear/test an effect is to flash real hardware and play your guitar through it. That makes the edit→build→flash→listen→reason→fix loop slow, and it gives you no way to inspect what the code is doing while it runs.

You want a single tool — **ds-ide** — that keeps you in one place: write, build, run the effect against a simulated audio input, and (when something is wrong) pause it on a breakpoint instead of debugging in your head on hardware.

### 1.1 Current workflow
1. Write code (text editor / Visual Studio).
2. Build (CLI or VS).
3. Flash to hardware (CLI or VS, via `dfu-util`).
4. Play guitar into the Seed to evaluate the effect.
5. On a problem: reason about the code mentally → fix → back to step 2.

### 1.2 Target workflow
1. Write code (**ds-ide editor**).
2. Build (**ds-ide**).
3. Load the build into the **embedded emulator** (no hardware).
4. Run the emulation; feed the audio input a signal (v1: a sine wave; start/stop transport).
5. On a problem: re-run **in debug mode** (v1: add/remove breakpoints, pause on hit) → understand → fix → back to step 2.

---

## 2. Goals & non-goals

### 2.1 Goals
- **G1** — Collapse the inner loop (build → run → observe) to seconds, with no hardware in the path.
- **G2** — Let you *interact* with the running effect through on-screen controllers (potentiometers, buttons) that map to the same code your firmware reads (ADC channels, GPIO/switches).
- **G3** — Let you *see* what the audio path is doing (at minimum input vs output waveform; ideally a spectrum).
- **G4** — Let you *stop time* and inspect: set breakpoints, run, pause at the breakpoint, continue/stop.
- **G5** — Reuse the standard Daisy toolchain and not reinvent compilation/flashing.

### 2.2 Non-goals (for the foreseeable versions)
- **NG1** — Cycle-accurate or bit-exact reproduction of the STM32H750. The emulator is for *logic/DSP iteration*, not for catching hardware-timing, cache, or peripheral-quirk bugs. (See §11 fidelity caveat.)
- **NG2** — Emulating non-audio peripherals (SD card, MIDI, OLED/Pod displays, SPI/I²C devices) in v1.
- **NG3** — A visual/patch (Max gen~, Pd) authoring layer. ds-ide targets C++ source.
- **NG4** — Replacing hardware testing entirely. The emulator de-risks and speeds iteration; final validation still happens on the Seed.

---

## 3. Glossary

| Term | Meaning |
|---|---|
| **Daisy Seed** | The bare STM32H750 audio board. Controls (pots/buttons) are wired by the user, not fixed. |
| **libDaisy** | Hardware abstraction library (audio callback, ADC, GPIO, switches, timers). MIT-licensed. |
| **DaisySP** | Portable DSP building-block library (filters, oscillators, effects). MIT-licensed. Pure C++, host-portable. |
| **Audio callback** | `void AudioCallback(AudioHandle::InputBuffer in, AudioHandle::OutputBuffer out, size_t size)` — called per audio block. The heart of any effect. |
| **HAL shim / host libDaisy** | A host (x86/ARM64) implementation of the slice of the libDaisy API your effect uses, so the *same source* compiles and runs natively. The core technical artifact of the native approach. |
| **DFU** | USB Device Firmware Upgrade — how firmware is flashed to a real Seed (`dfu-util`, BOOT+RESET). |
| **DAP** | Debug Adapter Protocol — the standard that decouples a debugger UI from the underlying debug engine (gdb/lldb). |
| **Block / block size** | Number of samples per audio callback (e.g. 48). |
| **xrun** | Audio buffer under/overrun (a glitch caused by missing the real-time deadline). |

---

## 4. The pivotal architectural decision: emulation strategy

This single choice reshapes §6–§9 and the whole effort. Three options:

**Option A — Native host simulation (HAL mock).** Recompile the user's effect *for the host CPU*, replacing libDaisy's hardware layer with a software implementation that routes audio I/O to synthetic signals / host audio, and ADC/GPIO reads to UI controls. DaisySP and the user's DSP are portable C++ and run natively.
- ✅ Fast inner loop, trivial native debugging (lldb/gdb, real breakpoints), low effort, easy to "freeze time."
- ❌ Does **not** catch hardware-specific bugs; requires the user's code to be host-portable; needs a HAL shim covering the API surface used.
- *Community-validated as the practical path; no full Daisy ISA emulator exists today.*

**Option B — Full instruction-set emulation (QEMU / Renode).** Build the actual ARM binary with the standard toolchain and run it under an emulator with an STM32H7 machine model.
- ✅ Runs the exact flashed artifact; highest fidelity to the build.
- ❌ STM32H7 peripheral support (SAI/I²S audio codec, SDRAM, QSPI) is incomplete in QEMU; real-time audio + a 480 MHz M7 doing DSP is hard to keep fluid; large effort to model Daisy's audio path; breakpoints require gdb-remote into the target.

**Option C — Phased hybrid.** Ship Option A first (fast iteration), add an optional Option B / hardware-in-the-loop "high-fidelity" mode later for final checks.

> **DECISION (Q1):** **Option A for v1.** Your goals (speed + breakpoints + DSP correctness) are exactly what native simulation does best, and ISA emulation would fight every one of them. **Option B is deferred and likely never built** — STM32H7 audio-peripheral support is weak and the effort undermines the loop speed. The phased shape (C) is the practical reality: native for the inner loop, with the existing hardware flash as the periodic reality check.
>
> **Known blind spot of Option A (important):** native sim runs on the desktop CPU, so it verifies *correctness*, not the Seed's *real-time CPU/RAM budget*. An effect can be glitch-free in the emulator and still overrun or run out of RAM on the M7. That "does it fit on the metal" question is answered by flashing real hardware (retained, §6.3) — *not* by the emulator. Promote ISA/hardware-in-the-loop (v3, §12) only if you repeatedly hit this wall.
>
> Note: Option A means the *emulator* build is a host build, while *hardware deploy* (§6.3) still uses the standard ARM toolchain unchanged.

The remainder of this document is written on **Option A** (decided); sections that would change materially under B/C are flagged.

---

## 5. System overview

ds-ide is composed of:

1. **Editor / project shell** — open a Daisy project, edit C++, see build problems, run tasks.
2. **Build subsystem** — two targets:
   - *hardware build* — standard `make` + ARM GCC (unchanged from today).
   - *emulator build* — host compile of the effect linked against the **host libDaisy shim**.
3. **Emulator runtime** — loads the emulator build, drives the audio callback, exposes audio I/O and controller state.
4. **Controller panel** — renders pots/buttons from a config and feeds their values into the emulator's ADC/GPIO mocks.
5. **Audio/transport panel** — input source (v1: sine), start/stop, input vs output visualisation, optional host-speaker monitoring.
6. **Debug subsystem** — breakpoints, run/pause/continue/stop, current-line indication; native debugger (lldb/gdb) behind a DAP-style interface.

> **DECISION (Q3): ds-ide is a VS Code extension.** The official Daisy C++ workflow already runs inside VS Code (build tasks + the `marus25` Cortex-Debug extension), so this reuses the editor, DAP-based debug UI, terminal, and tasks; the emulator becomes a webview panel (controllers + scope) plus a custom debug adapter and build tasks. This is the lowest-effort route and aligns with "reuse standard tools." (Standalone Tauri/Electron + Monaco was the rejected alternative.)

---

## 6. Functional requirements

### 6.1 Editor & project (`FR-ED`)
- **FR-ED-1** — Open an existing Daisy project (a folder with a `Makefile`, `*.cpp`, and `libDaisy`/`DaisySP` as submodules or referenced dirs).
- **FR-ED-2** — Edit C++ with syntax highlighting; save.
- **FR-ED-3** — Show build diagnostics (errors/warnings) parsed from compiler output, navigable to source line.
- **FR-ED-4** — `[ASSUMPTION]` Create a new project from a template (effect skeleton with an audio callback + one pot + one button) — *nice-to-have v1, can defer.*

### 6.2 Compile (`FR-CO`)
- **FR-CO-1** — Build the project for the **emulator** target (host compile) with one action.
- **FR-CO-2** — Build the project for **hardware** with one action, invoking the standard toolchain (`arm-none-eabi-g++`, flags `-mcpu=cortex-m7 -mthumb -mfpu=fpv5-d16 -mfloat-abi=hard -DSTM32H750xx …`, via the project `Makefile`). No reimplementation of the build.
- **FR-CO-3** — Surface build success/failure and full log.
- **FR-CO-4** — Detect & report when source is **not host-portable** (e.g. uses hardware-only headers/intrinsics not provided by the shim) with an actionable message rather than a raw linker error. _(Mitigation for Option A's main failure mode.)_
- **FR-CO-5** — `[ASSUMPTION]` Manage/locate the toolchain (bundle Electro-Smith's `DaisyToolchain`, or detect an installed one). Confirm bundling vs detection.

### 6.3 Deploy (`FR-DE`)
- **FR-DE-1** — Load the **emulator build** into the emulator runtime ("deploy to emulator"). For Option A this means loading the freshly built host module/executable into the running emulator process.
- **FR-DE-2** — Re-deploy on rebuild without restarting ds-ide; ideally without losing controller positions.
- **FR-DE-3** — *(Retained from current workflow)* Deploy the **hardware build** to a connected Seed via `dfu-util` (BOOT+RESET DFU mode), surfacing the same dfu errors the CLI shows. Confirm whether hardware deploy stays in scope for v1 (§13 Q4).

### 6.4 Execute / run the emulation (`FR-RU`)
- **FR-RU-1** — **Transport: Start / Stop.** Start begins driving the audio callback at the configured sample rate/block size; Stop halts it.
- **FR-RU-2** — **Input source (v1): internal sine generator** feeding the audio input buffer(s). `[ASSUMPTION]` adjustable frequency & amplitude (default e.g. 440 Hz, −6 dBFS); confirm whether even these controls are in v1 or fixed.
- **FR-RU-3** — Run the user's `AudioCallback` with correct buffer shape (channel count, block size, sample rate) matching libDaisy semantics.
- **FR-RU-4** — Default sample rate / block size = libDaisy defaults (`[ASSUMPTION]` 48 kHz, block size 48), with both configurable.
- **FR-RU-5** — **Output visualisation:** show input vs output as a live waveform/scope. `[ASSUMPTION]` a spectrum view is v2.
- **FR-RU-6** — **Monitoring (optional v1, see §13 Q4):** route emulator output to host speakers so you can *hear* the effect, not just see it.
- **FR-RU-7** — Robustness: if the callback throws / NaNs / blows the deadline, stop cleanly and report rather than crashing ds-ide. Surface NaN/Inf/denormal and clipping indicators (these are the bugs you'd otherwise hunt by ear).
- **FR-RU-8** — `[ASSUMPTION] v2` Input source = **WAV file** (e.g. a recorded guitar DI loop).
- **FR-RU-9** — `[ASSUMPTION] v2, high value` Input source = **live host audio input** (your real audio interface / guitar) routed through the emulator in real time. _This is the closest analogue to your current "play the guitar through the Seed" test and the most direct fix for your stated pain — flagged as a priority candidate for the version right after v1._

### 6.5 Controllers (`FR-CT`) — used in **both** run and debug modes
Your effect reads pots via the ADC (`adc.GetFloat(channel)` → 0..1) and buttons via GPIO/`Switch`. On a bare Seed these are user-wired, so the mapping must be **declared**.

- **FR-CT-1** — A **controller configuration** (e.g. `controllers.yaml` in the project) declares each control. Proposed schema:
  ```yaml
  potentiometers:
    - id: knob_drive          # stable identifier
      label: "Drive"          # UI label
      adc_channel: 0          # which ADC channel the firmware reads
      seed_pin: A0            # informational / for hardware parity
      range: [0.0, 1.0]       # value the emulator returns
      taper: linear           # linear | log | antilog
      default: 0.5
  buttons:
    - id: btn_bypass
      label: "Bypass"
      gpio_pin: D7
      mode: momentary         # momentary | toggle
      active_level: low       # active-low w/ internal pull-up is typical
      debounce_ms: 5
  ```
- **FR-CT-2** — The **controller panel** renders a slider/knob per potentiometer and a button per button, from the config.
- **FR-CT-3** — Moving a UI pot updates the value returned by the corresponding `adc.GetFloat(channel)` in the running emulation, in real time. Pressing a UI button updates the corresponding GPIO/`Switch` state with the configured semantics (momentary/toggle, active level, debounce).
- **FR-CT-4** — Controller state persists across re-deploys within a session (FR-DE-2).
- **FR-CT-5** — Validate the config (duplicate channels, missing fields) with clear errors.
- **FR-CT-6** — `[ASSUMPTION] v2` **Auto-derive** controls from the effect's `AdcChannelConfig` / pin init in code, to remove the risk of the declared config drifting from what the firmware actually reads. (v1: declarative config is the source of truth; you keep them consistent.)
- **FR-CT-7** — `[DEFERRED]` Built-in control maps for fixed boards (Pod/Patch/Petal/Field/Terrarium). Out of scope per Q2 (target is bare Seed); revisit only if you add a fixed board later.

### 6.6 Debug (`FR-DB`)
v1 scope is breakpoints; a usable minimum needs run/pause/continue around them.
- **FR-DB-1** — **Add/remove a breakpoint** on a source line (gutter click).
- **FR-DB-2** — **Run in debug mode**: build (debug, `-O0 -g` for the emulator target), load, run with breakpoints active.
- **FR-DB-3** — **Pause on hit**: when execution reaches a breakpoint, halt the emulation and indicate the current line.
- **FR-DB-4** — **Continue** and **Stop**.
- **FR-DB-5** — **Freeze simulated time while paused.** Because audio time is *simulated*, pausing must stop the audio clock (no callbacks advance, no xruns) so you can inspect indefinitely — an advantage over hardware debugging.
- **FR-DB-6** — Breakpoints inside the audio callback are supported (this is where effect bugs live); hitting one cleanly suspends audio.
- **FR-DB-7** — `[ASSUMPTION] v2` Step over/into/out, call stack, variable & watch inspection. (Mechanically "free" once a DAP/lldb-gdb backend is wired, but explicitly out of the v1 commitment per your spec.)
- **FR-DB-8** — Implementation note (Option A): drive a native debugger (lldb/gdb) behind a DAP interface so the debug UI is reusable and so v2 features come cheaply. Under Option B this becomes gdb-remote into QEMU/Renode.

---

## 7. Build & deploy targets summary

| | Emulator target | Hardware target |
|---|---|---|
| Compiler | Host C++ (clang/gcc) | `arm-none-eabi-g++` |
| HW layer | host libDaisy **shim** | real libDaisy |
| Artifact | host module/executable | `.bin` / `.elf` |
| "Deploy" | load into emulator runtime | `dfu-util` over USB |
| Debug | native lldb/gdb (real breakpoints) | OpenOCD + probe (existing) |

---

## 8. The host libDaisy shim (Option A) — scope (`FR-SH`)
The shim is the largest build item. It only needs to cover the API surface your effects touch.
- **FR-SH-1** — `DaisySeed` init/config, `System` timing helpers.
- **FR-SH-2** — Audio: `AudioHandle` config (sample rate, block size, channels), `StartAudio(callback)`, buffer marshalling matching libDaisy's interleaving/types.
- **FR-SH-3** — ADC: `AdcHandle` init + `GetFloat(channel)` driven by the controller panel.
- **FR-SH-4** — GPIO / `Switch`: state driven by the controller panel, with debounce semantics.
- **FR-SH-5** — `[ASSUMPTION]` Stubs that no-op or warn for unsupported peripherals (SD, MIDI, display) so code referencing them still *links*, with a clear "not emulated" notice.
- **FR-SH-6** — `[ACTION]` The exact surface should be pinned to **your effect's actual code** — please share it (or the list of libDaisy classes it uses) so §8 can be made concrete instead of assumed (§13 Q5).

---

## 9. Non-functional requirements

- **NFR-1 (Latency of loop)** — Edit→build→running emulation should typically complete in **single-digit seconds** for a small effect. This is the core value; if it isn't fast, the project fails its purpose.
- **NFR-2 (Real-time audio when monitoring)** — When output goes to host speakers (FR-RU-6), the engine must meet the audio deadline well enough to avoid constant xruns at the default block size; when only visualising, it may run faster- or slower-than-real-time.
- **NFR-3 (Fidelity caveat — must be visible to the user)** — The emulator approximates the Seed. Floating-point results, timing, denormal handling, and peripheral behaviour can differ from hardware. **Most importantly, because the emulator runs on the desktop CPU, it does NOT validate the Seed's real-time CPU/RAM budget:** an effect can be glitch-free in ds-ide and still overrun or exhaust memory on the M7. ds-ide must not imply bit-exactness or that "runs in the emulator" means "fits on hardware." Final validation — especially CPU/RAM headroom — is on hardware (FR-DE-3).
- **NFR-4 (Portability of ds-ide)** — `[ASSUMPTION]` Primary OS = **Windows** (you use Visual Studio); macOS and Linux desirable. Confirm priority (§13 Q6). The VS Code-extension route gives cross-platform largely for free.
- **NFR-5 (No regression to hardware path)** — Using ds-ide must not change or break the standard hardware build/flash you rely on today.
- **NFR-6 (Determinism)** — Given the same input signal and controller values, a run should be reproducible (important for debugging).
- **NFR-7 (Licensing)** — libDaisy and DaisySP are MIT; bundling/wrapping them is fine. Track licenses of any toolchain/emulator components bundled.
- **NFR-8 (Usability)** — A user who can flash a Seed today should be able to run their effect in the emulator without reading a manual.

---

## 10. Constraints & assumptions
- **CR-1** — `[ASSUMPTION]` Targets are C++ effects on libDaisy/DaisySP (not Arduino, not gen~/Pd).
- **CR-2** — **Confirmed (Q2): the target is the bare Daisy Seed with user-wired controls.** This makes the declarative controller config (§6.5) the source of truth. Fixed-board control maps (FR-CT-7) are therefore out of v1 scope.
- **CR-3** — Option A requires effect source to be host-portable; non-portable code is a known limitation surfaced via FR-CO-4 / FR-SH-5.
- **CR-4** — v1 emulates the **audio path + ADC pots + GPIO buttons** only; other peripherals are out of scope (NG2).

---

## 11. MVP (v1) definition

**In v1, you can:** open your effect → build it for the emulator → load it → press Start to drive the audio input with a sine wave → move on-screen pots and press on-screen buttons mapped to your ADC/GPIO reads → see input vs output waveforms → set/remove breakpoints, run in debug, pause at a breakpoint (with time frozen), continue, and stop.

**v1 explicitly excludes:** WAV/live-guitar input, spectrum view, stepping/variables/call-stack, auto-derived controls, non-audio peripherals, ISA-level emulation, and (TBD) host-speaker monitoring and hardware deploy.

### 11.1 v1 acceptance criteria
- **AC-1** — A known effect (e.g. a simple overdrive reading one "drive" pot and one "bypass" button) builds for the emulator and runs.
- **AC-2** — Turning the on-screen "drive" pot audibly/visibly changes the output (verifiable on the scope).
- **AC-3** — Pressing "bypass" makes output == input (or whatever the code does), proving GPIO mapping.
- **AC-4** — A breakpoint set inside the audio callback is hit on Run-in-debug; the UI shows the line; the audio clock is frozen; Continue resumes; Stop ends.
- **AC-5** — Inducing a bug that produces NaN/clipping is flagged (FR-RU-7), demonstrating the debug value over hardware.
- **AC-6** — The standard hardware build still works unchanged (NFR-5).

---

## 12. Roadmap (indicative)
- **v1** — as §11.
- **v2** — Live host audio input (FR-RU-9, priority), WAV input, host-speaker monitoring, spectrum view, full debug (stepping/variables/watch), auto-derived controllers, built-in board control maps.
- **v3** — Optional high-fidelity mode (QEMU/Renode and/or hardware-in-the-loop), additional peripherals (MIDI, display), project templates & sharing.

---

## 13. Open questions / decisions needed
Each has my recommended default (used as the `[ASSUMPTION]` above) so work isn't blocked.

| # | Question | Why it matters | Recommended default |
|---|---|---|---|
| **Q1** | ~~Emulation strategy?~~ | Reshapes compile/deploy/debug (§4). | ✅ **RESOLVED: Option A (native) for v1; B deferred/likely-never; phased reality check on hardware.** |
| **Q2** | ~~Bare Seed or fixed board?~~ | Controller model (§6.5). | ✅ **RESOLVED: bare Seed, declarative config.** |
| **Q3** | ~~IDE foundation?~~ | Effort & tooling reuse. | ✅ **RESOLVED: VS Code extension.** |
| **Q4** | **In v1, do you want (a) to *hear* output via host speakers, and (b) hardware DFU deploy retained inside ds-ide — or are both deferred?** | Affects real-time constraint (NFR-2) and v1 scope. | Hearing = yes if cheap; hardware deploy = retained. |
| **Q5** | **Can you share your current effect's source (or the libDaisy classes it uses)?** | Lets §8 pin the exact shim surface instead of assuming it. | — (please provide) |
| **Q6** | **Primary OS (Windows/macOS/Linux) and priority order?** | Drives NFR-4 and packaging. | Windows first. |
| **Q7** | **Is the sine generator's frequency/amplitude adjustable in v1, or fixed?** | Minor scope (FR-RU-2). | Adjustable. |
| **Q8** | **How important is the live-guitar-input feature relative to other v2 items?** It's the closest match to your real test (FR-RU-9). | Prioritisation of v2. | High. |
