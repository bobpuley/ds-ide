# 02 — Assumptions & Risks (v2)

> **v1 complete.** All v1 bets (A1–A8) held. A1–A3 verified against real source; A4–A8
> confirmed through implementation (M0–M7, 0.1.0–0.1.7). Archived: `docs/v1/02_assumptions-and-risks.md`.

What ds-ide **v2 is betting on**, and where those bets could be wrong. Derived from the
v2 feature set in [01_input-ideas.md](01_input-ideas.md). The v1 decisions that still hold
(Option A native simulation, VS Code extension, bare libDaisy/DaisySP, macOS-first/pragmatic
cross-platform) are carried forward without re-litigating them.

Legend — **Impact if wrong**: 🔴 high · 🟠 medium · 🟡 low.

---

## 1. Core v2 bets

| ID | We are betting that… | Why we believe it | Impact if wrong |
|----|----------------------|-------------------|-----------------|
| **A9** | **Real-time host audio** (CoreAudio / PortAudio) is achievable within the existing out-of-process emulator runtime (C4). The audio thread can be converted from a simulated-clock loop to an OS-callback-driven loop without redesigning the engine. | v1 already runs a block loop on a dedicated audio thread; the OS callback just replaces the `sleep`-paced clock. Buffer marshalling, scope tap, NaN/clip scan, and IPC are unchanged. | 🔴 If the OS callback and IPC/DAP threads conflict at real-time priority, the architecture needs rethinking. |
| **A10** | **Live host audio input** latency is acceptable for an interactive dev loop (not a recording studio). The developer connects a guitar and hears their effect with tolerable round-trip delay. | Typical CoreAudio buffer sizes (64–512 samples @ 48 kHz) give 1–11 ms one-way. Round-trip through the effect adds one block. Total < 30 ms on most setups — usable for development. | 🟠 If round-trip latency is too high for the user's preferred audio interface, we may need configurable buffer size and a latency-indicator. |
| **A11** | **`Switch` / GPIO shim is feasible** with bounded effort, mirroring the ADC shim: a virtual button state array written by the IPC thread, read by `Debounce()`/`Pressed()` on the audio thread. | The v1 ADC shim used exactly this pattern (atomic array, IPC writes, callback reads). GPIO is structurally identical. The `daisy-seed-knowledge` reference confirms the `Switch` API surface. | 🟠 New debounce timing semantics or GPIO interrupt dependencies could require deeper shim work. |
| **A12** | **Full debug (step/variables/call-stack) comes nearly for free** from the existing lldb-dap backend: v2 just enables DAP capabilities already supported by lldb-dap that v1 left unexposed in the extension UI. | v1's C6 (debug adapter) already connects to lldb-dap; DAP `next`, `stepIn`, `stackTrace`, `variables` requests are standard. | 🟡 Stepping inside the audio thread while the OS audio callback is live could require suspending the callback. Needs a verified approach. |
| **A13** | **`arm-none-eabi-g++` and `dfu-util` run on macOS Apple Silicon** (homebrew or official ARM install). The hardware build path can be driven from the extension just like the emulator CMake build. | Both tools are officially supported on macOS/ARM; Homebrew formulae exist. R7 was flagged but never proven wrong — just unverified. | 🟡 Installation / PATH discovery may require toolchain detection logic; easily mitigated. |
| **A14** | **PortAudio (or a native-only CoreAudio implementation) is a viable host audio API** for both live input and speaker output, cross-platform where needed. | PortAudio is MIT, well-maintained, and used in Audacity, Ardour, and similar tools. CoreAudio native is the macOS-first fallback if PortAudio adds too much complexity. | 🟡 PortAudio adds a bundled native dependency; if build complexity outweighs benefit, CoreAudio-first is the pragmatic path. |

---

## 2. Risk register (v2)

| ID | Risk | Likelihood | Impact | Mitigation |
|----|------|-----------|--------|------------|
| **R12** | **Real-time audio deadline failures (xruns)** — once host speaker output is live, the audio callback has a hard deadline. A slow DSP effect, GC pause, or OS scheduler hiccup causes audible glitches. | Medium | 🔴 | Expose a configurable buffer size (larger buffers = more headroom); show a live xrun counter; document that xrun-free performance depends on the host machine, not a ds-ide guarantee. |
| **R13** | **Live input latency too high for the dev** — the guitar-to-effect-to-ears round-trip may feel sluggish on some machines/audio interfaces. | Low–Med | 🟠 | Show the measured round-trip latency; allow buffer size tuning; document that a low-latency audio interface (not the built-in Mac mic) is recommended for minimal latency. |
| **R14** | **GPIO/`Switch` shim timing mismatch** — real Daisy `Switch::Debounce()` is called from the main loop at a fixed rate; emulating it from the audio thread at audio-block rate may break effects that rely on debounce timing. | Low–Med | 🟠 | Provide a configurable "debounce call rate" in the shim; test against the official `examples/` that use `Switch`. |
| **R15** | **Stepping into the audio callback while host audio is live** — lldb pausing the audio thread causes the OS callback to miss its deadline → xruns → audible glitches during debug. | High (likely) | 🟠 | Pause / mute the audio device when a breakpoint is hit; or keep the simulated-clock mode available for debugging (no OS deadline). |
| **R16** | **ARM toolchain discovery** — `arm-none-eabi-gcc` may not be on `PATH`; Xcode CLT does not include it; Homebrew install may differ by machine. | Medium | 🟡 | Implement toolchain detection (check known paths, offer install hint if missing); allow user to configure the toolchain path in settings. |
| **R17** | **DFU flash on macOS** — `dfu-util` requires the device in bootloader mode and the correct USB permissions; may fail silently or with unhelpful errors. | Low | 🟡 | Surface `dfu-util` stdout/stderr; provide step-by-step instructions for BOOT+RESET in the UI. |
| **R18** | **Non-determinism under real-time audio** — v1's simulated clock gave deterministic block sequencing; the OS audio callback may be non-deterministic (scheduler jitter, buffer size changes). Reproducibility (NFR-6) becomes hard to guarantee. | High (inherent) | 🟠 | Keep the simulated-clock mode available for debugging and regression (WAV file input); treat real-time mode as "best effort determinism." |

---

## 3. Carried-forward v1 bets (still hold in v2)

| ID | Bet | Still holds? |
|----|-----|-------------|
| A1 | Daisy effects are host-portable C++ | ✅ Verified in v1; unchanged for v2. |
| A2 | Host libDaisy shim has bounded surface | ✅ v2 extends (Switch/GPIO) but the pattern is proven. |
| A3 | DaisySP runs natively unchanged | ✅ Proven in v1. |
| A4 | VS Code extension model is sufficient | ✅ Proven in M0–M7. |
| A6 | macOS-first with portable APIs | ✅ Carried forward; v2 host-audio adds the first real cross-platform work. |

---

## 4. Open items for v2

- **Host audio API decision** (A14 / Open Conflict #2 in 01): PortAudio vs CoreAudio-first.
  Resolve before M8 design.
- **Clock model for debugging** (R15 / R18): decide whether the simulated clock remains
  available alongside the OS-callback clock, or v2 always goes real-time.
- **ARM toolchain bundle vs detect** (A13 / Open Conflict #1 in 01): resolve before
  designing the hardware build milestone.
