# 04 — Architecture

Technical design for **ds-ide v1**, realizing the requirements in
[03_requirements.md](03_requirements.md) under the locked decisions (Option A native simulation,
VS Code extension, bare libDaisy/DaisySP, macOS-first, emulator-only, pots-only, visualization-only,
breakpoints-only).

Built incrementally; decisions are recorded inline as they're made. `> ⚠️ ASSUMPTION:` marks
provisional choices.

---

## 1. Process model — in-process vs out-of-process

**The question (from 01 §16 / 03 §7):** does the emulator — the thing that actually runs the user's
compiled effect — live *inside* ds-ide's process, or as a *separate* process it talks to?

### 1.1 Why this is essentially forced to out-of-process

Three already-locked decisions converge on **out-of-process**:

1. **VS Code extension (D2).** A VS Code extension runs in a **Node.js extension host**. You cannot
   sensibly run a native, real-time C++ audio loop — the user's compiled effect — *inside* the
   Node process. The effect is native machine code; it needs a native process to run in.
2. **Native debugging (D1, FR-DB-6).** v1 debugging drives a native debugger (lldb) behind DAP.
   The DAP model is fundamentally *debugger ↔ a separate debuggee process*. Breakpoints in the
   user's effect require lldb to own a real native process — again, separate from the extension host.
3. **Crash isolation (NFR-8, FR-RU-4).** The user's effect *will* segfault, NaN, deadlock, or
   infinite-loop during development. If it shared ds-ide's process, it would take the editor down on
   every bad build. Isolation must be a process boundary.

> **DECISION (process model): out-of-process.** The emulator is a **separate native process**; the
> VS Code extension (TypeScript/Node) controls it over IPC, and lldb attaches to it via DAP. The
> "in-process" option only made sense for the rejected standalone-native-IDE alternative (Qt/C++),
> where the effect could be loaded as a library into the app itself. With a VS Code extension,
> in-process is not viable.

### 1.2 What this makes the high-level shape

```
┌────────────────────────── VS Code ──────────────────────────┐
│  Extension host (TypeScript / Node)                          │
│   • project open, build tasks, diagnostics                   │
│   • emulator lifecycle + IPC client                          │
│   • debug adapter glue (DAP)                                  │
│                                                              │
│  Webview panel(s)  ── controllers (pots) + input/output scope│
└───────┬───────────────────────────────────┬─────────────────┘
        │ IPC (control: transport,           │ DAP
        │ pot values, scope frames)          │ (breakpoints, pause/continue)
        ▼                                    ▼
┌──────────────────── Emulator runtime (native process) ───────┐
│  audio engine + sine generator + scope tap                   │
│  host libDaisy shim  (audio cb, ADC GetFloat, system/log)    │
│  ── the user's compiled effect ──  (+ DaisySP, unchanged)    │
└──────────────────────────────────────────────────────────────┘
                         ▲ lldb attaches here
```

### 1.3 The real sub-decision: how the effect is packaged into that process

"Out-of-process" settles *where* the effect runs, but not *how the build is packaged* — and that's
the genuine engineering fork for Option A:

**Option P1 — Standalone executable (relaunch on redeploy).**
The emulator build links the user's effect + the shim + a runtime `main()` (audio engine, sine,
scope, IPC client) into **one native executable per build**. ds-ide launches it as a child process;
redeploy = kill & relaunch. lldb/DAP just "launches a program."
- ✅ Simplest, most debuggable (a plain executable — textbook DAP launch). Strong crash isolation.
- ✅ Controller positions preserved by the *extension* replaying state on launch (satisfies FR-DE-2).
- ❌ Redeploy is a process relaunch (a few hundred ms — within NFR-1's single-digit seconds).

**Option P2 — Shared library + persistent host runner (hot reload).**
ds-ide ships a long-lived "emulator host" process (audio engine, sine, scope, IPC, ADC state). The
user's effect compiles to a **`.dylib`** the host `dlopen`s; redeploy = `dlclose`/`dlopen` the new
lib without restarting the host.
- ✅ Fast hot reload; audio engine & controller state persist across rebuilds in the host itself.
- ❌ Requires defining a stable host↔effect ABI/entry-point contract; debugging a dynamically
  loaded lib's symbols is fiddlier; a bad effect can still corrupt the shared host (weaker isolation).

> **DECISION (P1 vs P2): P1 — standalone executable.** Each emulator build links the effect + shim
> + runtime `main()` into one native executable; ds-ide launches it and relaunches on redeploy.
> Simplest, most debuggable, best-isolated; relaunch latency is well within NFR-1. P2's hot-reload
> is deferred — a later optimization if relaunch ever feels slow. (Implication for FR-DE-2:
> controller positions live in the extension and are **replayed to the runtime on launch**.)

---

## 2. Components

| # | Component | Tech | Responsibility | Reqs |
|---|-----------|------|----------------|------|
| C1 | **Extension host** | TypeScript/Node (VS Code API) | Project open, build orchestration, diagnostics, emulator lifecycle, IPC client, debug glue, persistence | FR-ED, FR-BU, FR-CF |
| C2 | **Controller + scope webview** | HTML/TS webview | Render pot sliders & input/output scope; send pot changes; draw scope frames | FR-CT, FR-AU-3 |
| C3 | **Emulator build (CMake)** | CMake + host clang | Compile effect + shim + DaisySP + runtime `main()` → one native executable | FR-BU-1/4/6 |
| C4 | **Emulator runtime** | C++ executable | Audio engine, sine gen, simulated clock, scope tap, IPC server, NaN/clip detection; hosts the effect | FR-RU, FR-AU, NFR-2/6/8 |
| C5 | **Host libDaisy shim** | C++ (linked into C4) | `DaisySeed`/audio/`AdcHandle`/system surface the effect calls; ADC backed by IPC pot state; `StartAudio` interleaved overload in v1.0, block overload v1.1 (§4.1) | FR-SH |
| C6 | **Debug adapter** | lldb-dap wrapper | Launch C4 under lldb via DAP; breakpoints, pause/continue/stop | FR-DB |

The user's effect and **DaisySP are compiled unchanged** into C4 (via C3); the only substituted
layer is C5 (the shim replacing real libDaisy).

---

## 3. Emulator build pipeline (C3)

> **DECISION (host build system): CMake**, managed by ds-ide. Rationale: cross-platform
> (macOS-first, portable per D4), clean separation from the project's hardware `Makefile` (NFR-5 —
> the two builds never touch each other), and standard lldb/DAP integration.

- ds-ide generates/maintains a CMake build (out of the project tree, e.g. `.ds-ide/build/`) that
  compiles: the effect `*.cpp`, the **host libDaisy shim** (shipped with ds-ide), **DaisySP** (from
  the project's submodule, host-compiled), and the **runtime `main()`** (shipped with ds-ide).
- Output: a single native executable, e.g. `.ds-ide/build/effect_emu`.
- Debug builds use `-O0 -g` (FR-BU-4); errors are parsed back to diagnostics (FR-ED-3); unresolved
  symbols against the shim surface produce the actionable FR-BU-5 message.
- No `arm-none-eabi` involved (D9 / FR-BU-6).

---

## 4. Emulator runtime internals (C4)

**Threads:** (1) an **audio/processing thread** running the block loop; (2) an **IPC thread**
serving control messages and emitting scope/status frames. Pot values are shared as an atomic
array written by the IPC thread and read by the shim's `GetFloat` on the audio thread.

**Simulated clock & pacing.**
- v1 opens **no host audio output device** (D6, visualization-only). The audio thread runs the block
  loop driven by a **simulated sample clock**, not an OS audio callback — so there are no xruns
  (NFR-2).
- > ⚠️ ASSUMPTION: the loop is **soft-paced to ≈ real-time** (sleep to match block duration) so
  > time-based effects (e.g. tremolo's LFO) look/behave naturally on the scope. Missing the pace
  > just yields slightly irregular visuals, never an xrun. (Free-running as-fast-as-possible is the
  > alternative; rejected because it would make the LFO visually meaningless.)

**Block loop (per block):** sine generator fills the input buffer → present it to the effect in the
required libDaisy buffer view (**interleaved in v1**, see §4.1) → call the effect's `AudioCallback` →
tap input & output for the scope → scan output for **NaN/Inf, denormal, clipping** (FR-RU-4) →
advance the simulated clock.

**Scope tap.** Input/output blocks are **downsampled** to a modest frame (a few hundred points) and
pushed over IPC at a UI-friendly rate (≈30–60 fps) to keep the channel light (C2 draws them).

**Determinism (NFR-6).** Same sine params + same pot values ⇒ identical block sequence (the clock is
simulated and the loop is single-threaded for DSP).

### 4.1 Audio-callback contract — the host ↔ effect boundary

This is the one interface every effect crosses to receive audio, and the **only** surface where the
runtime's audio engine (C4) meets the user's compiled code. It is therefore the highest-priority
contract C4/C5 must get exactly right — everything else in a DSP effect is plain C++ that runs
untouched.

libDaisy exposes the audio callback in **two source-incompatible signatures**, and real effects are
split across both:

| Form | `StartAudio` overload | Buffer types | Layout | Examples in corpus |
|------|----------------------|--------------|--------|--------------------|
| **Interleaved** | `InterleavingAudioCallback` | `InterleavingInputBuffer` = `const float*`, `InterleavingOutputBuffer` = `float*` | `in[2i]`,`in[2i+1]` — L/R packed in one array | **44** (Osc, bypass, tone, svf, reverbsc, adsr, biquad, oscillator …) |
| **Non-interleaved (block)** | `AudioCallback` | `InputBuffer` = `const float* const*`, `OutputBuffer` = `float* const*` | `in[chan][i]` — separate per-channel pointers | **28** (chorus, flanger, string, USB_MIDI, QSPI, varisaw, zoscillator …) |

> Evidence: across the 70 bundled DaisyExamples, the callback buffer symbol appears 144 times — 44
> examples reference `Interleaving*Buffer`, 28 reference the block `Input/OutputBuffer`. An effect
> written for one form will **not compile** against a shim that only provides the other, so the shim
> must eventually offer both `StartAudio` overloads (FR-SH-2).

> **DECISION (callback contract sequencing): interleaved first, block-form as a fast-follow.**
> v1.0 implements `StartAudio(InterleavingAudioCallback)` in the shim (C5) and the runtime (C4)
> presents its sine input / scope tap in interleaved `float*` layout. This unblocks the larger
> **44-example** set for the least effort. The non-interleaved `StartAudio(AudioCallback)` overload
> + `const float* const*` marshalling is a **fast-follow (v1.1)** — additive, with no rework of the
> interleaved path.
>
> This **phases FR-RU-2 / FR-SH-2** (which require *both* forms): both are still delivered within v1,
> but interleaved lands first and block-form follows. 03_requirements should note that "both forms"
> is satisfied across v1.0 + v1.1 rather than in a single drop.

> ⚠️ ASSUMPTION: the engine keeps **one canonical internal buffer** and exposes it to the effect as
> either an interleaved `float*` or a non-interleaved `float* const*` *view*, rather than running two
> separate buffer pipelines. This is what makes the fast-follow purely additive — a second
> marshalling adapter plus the second `StartAudio` overload, with no change to the sine generator,
> scope tap, simulated clock, or NaN/clip scan.

---

## 5. IPC / control channel (C1 ↔ C4)

> **DECISION:** line-delimited **JSON messages over a local socket** (loopback TCP or UNIX domain
> socket). Simple, debuggable, language-agnostic (TS ↔ C++), low setup. Shared memory is unnecessary
> at v1 scope/bandwidth (downsampled scope frames are small).

| Direction | Message | Payload |
|-----------|---------|---------|
| ext → runtime | `config` | sampleRate, blockSize |
| ext → runtime | `transport` | start \| stop |
| ext → runtime | `sine` | freq, amplitude |
| ext → runtime | `pot` | adcChannel, value (0..1) |
| ext → runtime | `potSnapshot` | full pot array (replayed on launch, FR-DE-2) |
| runtime → ext | `scope` | downsampled in[] / out[] |
| runtime → ext | `status` | sampleRate, blockSize, running |
| runtime → ext | `event` | nan \| clip \| denormal \| crashed (FR-RU-4) |

Webview (C2) never talks to the runtime directly: pot moves and scope frames are relayed through the
extension (C1) using VS Code's webview messaging, keeping one IPC owner.

---

## 6. Debug architecture (C6)

- v1 debugging uses **lldb** (macOS-first) via **`lldb-dap`** (the DAP server lldb ships), wrapped by
  a thin ds-ide debug adapter that launches `effect_emu` under lldb-dap.
- **Run vs Debug:** *Run* launches `effect_emu` directly (no debugger). *Debug* launches it under
  lldb-dap with breakpoints active (FR-DB-2). The IPC/controller wiring is identical in both modes.
- **Breakpoints** (FR-DB-1/3) map editor gutter ↔ source lines via DAP; breakpoints inside
  `AudioCallback` are supported.
- **Freeze simulated time while paused (FR-DB-4) — falls out for free:** when lldb halts the process
  at a breakpoint, the **audio thread stops with it**, so the simulated clock cannot advance. Because
  there's no OS audio device and no real-time deadline (D6/NFR-2), nothing under-runs while you
  inspect for as long as you like. This is the structural advantage over hardware debugging.
- v2 stepping/variables/call-stack come "for free" from the same lldb-dap backend (FR-DB-6).

---

## 7. Controller mapping (C2 → C5)

`controllers.yaml` (FR-CT-1) declares pots: `id`, `label`, `adc_channel`, `range`, `taper`,
`default`. Flow on a pot move:

```
slider (C2) → webview msg → extension (C1) → IPC `pot{channel,value}` →
runtime atomic pot[channel] → shim AdcHandle.GetFloat(channel) → effect reads it
```

- `taper` (linear/log/antilog) and `range` are applied so `GetFloat` returns what the firmware
  expects (the effects normalize 0..1 themselves; see 02 §3). Target ≤ 50 ms end-to-end (NFR-3).
- ds-ide validates the config (duplicate channels, out-of-range, missing fields) → FR-CT-5.
- The extension owns pot state and replays a `potSnapshot` on each launch (P1 / FR-DE-2 / FR-CF).

---

## 8. Project layout & integration

- ds-ide keeps its artifacts under **`.ds-ide/`** in the project (generated CMake, build output,
  emulator settings) — isolated from the hardware `Makefile`/`libDaisy` build so NFR-5 holds.
- `controllers.yaml` lives at the project root (user-editable, version-controllable).
- Persistence (FR-CF): breakpoints, panel layout, pot values, emulator settings, build settings —
  via VS Code workspace state + the on-disk config.

---

## 9. Traceability (component → requirements)

| Requirement area | Realized by |
|------------------|-------------|
| FR-ED editor/project | C1 + VS Code |
| FR-BU build | C3 (CMake host build) |
| FR-DE deploy/redeploy | C1 launches/relaunches C4 (P1) |
| FR-RU run/transport/robustness | C4 |
| FR-AU sine + scope | C4 (gen/tap) + C2 (draw) |
| FR-CT controllers | C2 + C1 + C5 |
| FR-SH shim | C5 |
| FR-DB debug | C6 (lldb-dap) |
| FR-CF persistence | C1 |
| NFR-2/6/8 engine/determinism/isolation | C4 + process boundary |

---

## 10. Open architectural items

| Ref | Item | Current stance |
|-----|------|----------------|
| §4 | Soft-pace-to-real-time vs free-run | Soft-pace (assumption) |
| §4.1 | Non-interleaved (block) callback overload | Fast-follow v1.1; interleaved ships v1.0. Confirm one-canonical-buffer assumption at impl |
| §4.1 | FR-RU-2/FR-SH-2 "both forms" phasing | Update 03 to note both delivered across v1.0+v1.1 |
| §5 | Loopback TCP vs UNIX socket | Either; pick at implementation |
| C6 | lldb-dap packaging on macOS (Xcode CLT vs bundled) | Detect Xcode CLT lldb first |
| — | Windows/Linux debugger (gdb) parity | Deferred (macOS-first, D4) |
