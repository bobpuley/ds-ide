# 02 — Assumptions & Risks

What ds-ide is **betting on**, and where those bets could be wrong. Derived from the decisions
locked in [01_input-ideas.md](01_input-ideas.md) (Option A native simulation, v1 scope, VS Code
extension, macOS-first/cross-platform-pragmatic). Uncertain items are marked with
`> ⚠️ ASSUMPTION:` per the project convention and need confirmation.

Legend — **Impact if wrong**: 🔴 high (threatens the value proposition) · 🟠 medium (costly rework
or scope cut) · 🟡 low (local fix / deferrable).

---

## 1. Core bets (assumptions)

| ID | We are betting that… | Why we believe it | Impact if wrong |
|----|----------------------|-------------------|-----------------|
| **A1** | Daisy effects are **host-portable C++** — they compile and run natively once libDaisy's hardware layer is shimmed. | ✅ **VERIFIED**: official examples (§3.1) are bare-libDaisy + portable; the user's effects (§3, pure float math, no fixed-point/intrinsics/register code) port cleanly too. | 🔴 Option A's whole premise; non-portable code can't run in the emulator. |
| **A2** | A **host libDaisy shim** covering only the API surface the user's effects touch is feasible with bounded effort. | ✅ **VERIFIED**: the touched surface is small and now enumerated (§4) — audio callback, ADC, sample-rate, plus Serial/delay stubs. | 🔴 The shim is the largest build item; if the surface balloons, v1 slips. |
| **A3** | **DaisySP runs natively unchanged** (pure portable C++, MIT). | ✅ **VERIFIED**: `equalizzatore` uses `MoogLadder` (portable C++); no hardware coupling. | 🟠 Would force per-module porting. |
| **A4** | The **VS Code extension model** (DAP + native lldb/gdb + build tasks + webview) gives editor, debug UI, and project mgmt largely for free. | Daisy's official C++ workflow already lives in VS Code. | 🟠 Webview/DAP limits could force a heavier custom UI. |
| **A5** | **Visualization-only v1** (no host-speaker output) means the engine has **no hard real-time deadline** and can run faster/slower than real time. | Decided in Conflict #4; waveform is the v1 feedback. | 🟡 If hearing output is needed sooner, real-time constraint returns. |
| **A6** | **macOS-first with portable APIs** keeps cross-platform largely free; minor platform gaps are acceptable in v1. | VS Code + portable audio/host abstractions; user direction. | 🟡 Some host-audio/file paths may need per-OS work later. |
| **A7** | In v1 the **declarative controller config (YAML)** is hand-kept consistent with what the firmware actually reads (no auto-derive until v2). | Bare-Seed target → mapping must be declared; auto-derive deferred. | 🟡 Config can drift from code; surfaced via validation, not prevention. |
| **A8** | Default **48 kHz / block size 48** matches libDaisy defaults so emulator behaviour mirrors hardware out of the box. | libDaisy defaults; both configurable. | 🟡 Local config fix if wrong. |

> ⚠️ ASSUMPTION: A1–A3 are stated against *typical* Daisy effects, not the user's actual code. They
> stay assumptions until the real effect source (or its libDaisy/DaisySP usage list) is reviewed.

---

## 2. Risk register

| ID | Risk | Likelihood | Impact | Mitigation | Links |
|----|------|-----------|--------|------------|-------|
| **R1** | Native sim verifies **correctness, not the Seed's real-time CPU/RAM budget** — an effect can be glitch-free in ds-ide and still overrun or exhaust memory on the M7. | High (inherent) | 🔴 | Make the fidelity caveat visible in-product (NFR-3); keep the hardware flash as the periodic reality check (FR-DE-3); consider v3 high-fidelity/HIL mode only if hit repeatedly. | A1, A5 |
| **R2** | **Non-host-portable source** — hardware-only headers, ARM intrinsics, register/SDRAM access, fixed-point/memory-layout assumptions — fails to compile or link against the shim. | **Low** (source reviewed, §4: clean) | 🔴 | FR-CO-4 actionable detection (not raw linker errors); FR-SH-5 no-op/warn stubs for unsupported peripherals. | A1, A2 |
| **R3** | ~~Shim surface unknown~~ → **mitigated**: surface enumerated from real effects (§4). Residual risk only if future effects pull in new APIs. | Low | 🟡 | Shim pinned to §4 list; extend per new effect. | A2 |
| **R4** | **Numeric/timing divergence** — desktop float, denormal handling, and timing differ from the M7, so audio results aren't bit-identical; could mask or introduce bugs. | High | 🟠 | Document as fidelity caveat; surface NaN/Inf/denormal/clipping indicators (FR-RU-7). | A1 |
| **R5** | **Debug adapter complexity** — freezing simulated audio time on a breakpoint while keeping controllers interactive is non-trivial. | Medium | 🟠 | Drive native lldb/gdb behind DAP (FR-DB-8); validate the freeze-time behaviour early (AC-4). | A4 |
| **R6** | **VS Code webview limits** constrain the controller panel / scope UI (latency, rendering). | Low–Med | 🟡 | Prototype the controller+scope webview against latency NFRs early. | A4 |
| **R7** | **Hardware build/flash on macOS unverified** — `arm-none-eabi-g++` + `dfu-util` retained path may need setup work on Apple Silicon. | Low | 🟡 | Confirmation item (both tools support macOS); validate before relying on the hardware reality check. | A6 |
| **R8** | **Non-determinism** — host audio backend/threading could make runs non-reproducible, undermining debugging (NFR-6). | Low–Med | 🟡 | Decouple the audio clock from wall-clock when visualizing; drive the callback deterministically. | A5 |
| **R9** | ~~Porting prerequisite~~ → **DOWNGRADED:** porting the user's Arduino effects is **no longer on the critical path.** The `daisy-seed-knowledge/examples` (`bypass`, `Osc`, `inout`, `Knob`) are already bare-libDaisy + pots-only and serve as v1 test cases (AC-1). Porting `tremolo`/`equalizzatore` becomes optional, later work. | Low | 🟡 | Use official examples for v1; port user effects when convenient. | A1, A2 |
| **R10** | ~~GPIO path unverified by real code~~ → **RESOLVED by scope cut:** v1 is **pots-only**; buttons / GPIO / `Switch` are **deferred to v2**. Removes the GPIO shim, the button controller type, and AC-3 from v1. | — | — | Decision recorded in 01 §7 / §14 / §15. Revisit GPIO when a button-using effect exists. | A7 |
| **R11** | ~~Callback-shape mismatch~~ → **DOWNGRADED:** libDaisy itself provides **both** an interleaved (`InterleavingInput/OutputBuffer`, `out[i]/out[i+1]`) and a non-interleaved (`InputBuffer`, `in[chan][i]`) callback form (confirmed: `bypass.cpp`/`Osc.cpp` vs `InOut.cpp`). The DaisyDuino interleaved style maps ~1:1 to the interleaving form. | Low | 🟡 | Shim provides **both `StartAudio` overloads**; cover both in buffer-marshalling tests. | A2 |

---

## 3. Verified facts from source review (`mydaisyseed`)

Reviewed `tremolo/tremolo.ino` and `equalizzatore/equalizzatore.ino` (both DaisyDuino).

**Enumerated shim surface (the complete API the real effects touch):**
- **Init/system:** `DAISY.init(board, AUDIO_SR_48K)` → `DaisyHardware`; `DAISY.get_samplerate()`;
  `DAISY.begin(callback)`. → libDaisy: `DaisySeed.Init`, audio config, `StartAudio`.
- **Audio callback:** `void cb(float* in, float* out, size_t size)`, **interleaved stereo**
  (`in[i]`, `in[i+1]`), 48 kHz. → libDaisy callback is **non-interleaved** (port change, R11).
- **ADC:** `analogRead(A0..A5)` → 0..1023, normalized by `/1023` (or `/potScale`). → `adc.GetFloat(ch)`
  → 0..1. Read from `loop()` (tremolo) **and** from inside the callback (equalizzatore).
- **GPIO/buttons:** **none used** (pots only — see R10).
- **DSP (portable, no shim):** DaisySP `MoogLadder` (Init/SetFreq/SetRes/Process); `sinf/fmaxf/fminf`, `M_PI`.
- **Stub-only:** `Serial.begin/print/println`, `delay(ms)`, `pinMode`.

**Controller inventory (feeds the v1 `controllers.yaml`, FR-CT-1):**
- *tremolo:* 4 pots — A0 Rate (0.1–10 Hz), A1 Depth (0–1), A2 Ratio (0.01–0.99), A3 Waveform selector
  (5-way via thresholds). All 10 kΩ linear.
- *equalizzatore:* 6 pots — A0–A5, one per band (gain 0..1×15). All 10 kΩ linear.

**Port-checklist hazards (Arduino → libDaisy)** — relevant only when/if the user's own effects are
ported (now optional, R9): interleaved loop → libDaisy interleaving callback (near 1:1, R11);
`tremolo` `DAISY_PETAL` → `DaisySeed`; `analogRead/1023` → `adc.GetFloat` (already 0..1);
`Serial`/`delay` → `PrintLine`/`System::Delay`; forward-declare functions used before definition.

### 3.1 Canonical bare-libDaisy API (confirmed from `daisy-seed-knowledge/examples`)

The **authoritative shim surface** (C5), confirmed against official examples — this supersedes the
DaisyDuino-derived guesses above:
- **Init:** `DaisySeed hw; hw.Configure(); hw.Init();` `hw.SetAudioBlockSize(n);`
  `hw.AudioSampleRate();`  *(namespaces `daisy`, `daisy::seed`, `daisysp`)*
- **Audio:** `hw.StartAudio(cb)` with **two** callback forms — interleaved
  (`AudioHandle::InterleavingInput/OutputBuffer`, `out[i]/out[i+1]`) and non-interleaved
  (`AudioHandle::Input/OutputBuffer`, `in[chan][i]`). Shim implements **both overloads**.
- **ADC:** `AdcChannelConfig cfg; cfg.InitSingle(seed::A0 | hw.GetPin(n));` `hw.adc.Init(cfg, count);`
  `hw.adc.Start();` `hw.adc.GetFloat(ch)` → 0..1 (callable from `main` loop **and** the callback).
- **System/log:** `hw.PrintLine(fmt, …)`; `System::Delay(ms)`.
- **DaisySP (unchanged, no shim):** `Oscillator`, `AdEnv`, `MoogLadder`, `mtof`, …
- **v2 (not shimmed in v1):** `Led`, `Switch` (`Debounce`/`RisingEdge`), `GetPin` for GPIO.
- **Reference material on hand:** `doc/md/_a3_Getting-Started-Audio.md`, `_a4_…-ADCs.md`,
  `doc/libdaisy_reference.pdf`, `doc/Daisy_Seed_Rev4_Pinout.csv`.

> The shim should be built/tested directly against these examples (`bypass`, `inout`, `Knob`, `Osc`).

---

## 4. Items needing validation (carried from 01 §16)

- ~~Port the current effect~~ → **no longer required for v1** (R9 downgraded; official examples are
  the v1 test cases). Porting `tremolo`/`equalizzatore` is optional later work.
- **Shim surface** → **pinned** to the canonical libDaisy API (§3.1), validated against the official
  examples. *(Resolves the earlier "pin the shim" item.)*
- **Confirm macOS hardware build/flash path** (`arm-none-eabi-g++` + `dfu-util`) (R7) — only relevant
  when in-IDE hardware build returns in v2 (D9).
- **In-process vs out-of-process emulator** → **RESOLVED in 04: out-of-process.**
