# 04 — Architecture (v2)

> **v1 complete.** The v1 architecture (out-of-process runtime C4, VS Code extension C1,
> CMake build C3, host libDaisy shim C5, lldb-dap C6, JSON-over-socket IPC) was implemented
> and validated across M0–M7. Archived: `docs/v1/04_architecture.md`.

Technical design for **ds-ide v2**, extending the v1 architecture for the requirements in
[03_requirements.md](03_requirements.md). v1 decisions that are unchanged are referenced,
not repeated. New sections cover the significant architectural deltas.

---

## 1. v1 architecture summary (carried forward unchanged)

```
┌────────────────────────── VS Code ──────────────────────────┐
│  Extension host (TypeScript / Node) — C1                     │
│  Webview panel — C2 (scope + controllers)                    │
└───────┬───────────────────────────────────┬─────────────────┘
        │ IPC (JSON/socket)                 │ DAP
        ▼                                   ▼
┌──────────────── Emulator runtime (native process) ──────────┐
│  C4: audio engine, scope tap, NaN/clip, IPC server           │
│  C5: host libDaisy shim (audio cb, ADC GetFloat, stubs)      │
│  user effect + DaisySP (compiled unchanged)                   │
└──────────────────────────────────────────────────────────────┘
                         ▲ lldb-dap (C6)
```

Components C1–C6, the P1 standalone-executable model, and the JSON-over-socket IPC channel
are all unchanged in v2. New features layer on top.

---

## 2. The big delta: real-time audio clock

### 2.1 v1 clock model (simulated)
The v1 audio thread ran a block loop driven by `sleep`-based soft pacing — no OS audio
device open, no hard deadline, no xruns. This made freeze-on-breakpoint free (the thread
just stops with lldb; no OS is waiting for a buffer).

### 2.2 v2 clock model (OS-callback-driven)
Once host speaker output (D11) and live host input (D10) are active, the audio thread must
be driven by the **OS audio callback** (CoreAudio `AudioUnit`, PortAudio stream, etc.).

Key consequences:

- **Hard real-time deadline.** Missing the callback → xrun → audible glitch. NFR-11.
- **Clock authority shifts.** The OS callback dictates when each block runs; soft pacing
  is replaced.
- **Breakpoint/freeze conflict.** When lldb pauses the audio thread at a breakpoint, the OS
  callback misses its deadline → xruns → glitches. **Mitigation:** mute/suspend the audio
  device when a breakpoint is hit; resume on continue/stop. (R15.)
- **Non-determinism.** OS-callback timing has jitter; reproducibility (NFR-6/R18) is best-
  effort. Keep the simulated-clock mode available for WAV-file/regression testing.

> **DECISION (v2 clock):** two modes — **real-time mode** (OS-callback, live I/O, host
> speaker) and **simulated mode** (v1 behaviour, WAV file or sine, no OS device). The
> extension selects the mode based on the active audio source (FR-AU-7): sine/WAV → simulated;
> live host input → real-time.

### 2.3 Audio device abstraction

> **DECISION (host audio API):** **CoreAudio-native** for v2 (macOS-first, zero new dependency).
> Windows/Linux host audio (WASAPI/ALSA or PortAudio) is deferred to v3+ when cross-platform
> runtime is in scope. This removes a bundled C library from the v2 build and keeps the
> dependency surface minimal.

The audio device abstraction lives inside C4, behind an interface the block loop calls:
`read_input_block(buf)` / `write_output_block(buf)`. In simulated mode these are a sine gen /
no-op; in real-time mode they're CoreAudio read/write.

---

## 3. Updated component table

| # | Component | Tech | v2 changes |
|---|-----------|------|-----------|
| C1 | Extension host | TS/Node | Hardware build commands, DFU flash command, full debug UI wiring, audio source selector |
| C2 | Controller + scope webview | HTML/TS | Add button/GPIO/LED controls; visual controller editor (M10b); spectrum/FFT view; session recording UI; audio source selector; latency + xrun display |
| C3 | Emulator build (CMake) | CMake + host clang | No change (emulator build unchanged) |
| C4 | Emulator runtime | C++ executable | Real-time audio clock mode; host audio I/O; two-mode clock (real-time / simulated); mute-on-breakpoint; WAV file reader; session recorder |
| C5 | Host libDaisy shim | C++ | Add `Switch`/GPIO shim (FR-CT-10); upgrade LED stub; keep ADC shim unchanged |
| C6 | Debug adapter | lldb-dap | Wire step/variables/watch/call-stack DAP commands through to the extension UI (FR-DB-7…10) |
| **C7** | **Hardware build driver** | TS + child_process | New: invoke `arm-none-eabi-g++` / `make`, parse diagnostics; detect toolchain (FR-HW-1/2) |
| **C8** | **DFU flash driver** | TS + child_process | New: invoke `dfu-util`, parse output, surface progress/errors (FR-HW-3) |

---

## 4. GPIO / `Switch` shim design (C5 extension)

The pattern mirrors the v1 ADC shim (proven in M1–M3):

```
Virtual button press (C2) → webview msg → extension (C1) →
IPC `button{gpioPin, pressed}` → runtime atomic button[pin] →
shim Switch::Debounce() reads button[pin] → effect sees Pressed()/RisingEdge()
```

- `Switch::Debounce()` is called by the effect from `loop()` or the audio callback. The
  shim calls it at audio-block rate when invoked from the callback, or polls at a configured
  rate from a dedicated thread when called from `loop()`. (R14 — debounce timing.)
- Debounce semantics: a "press" sets `rising_edge_ = true` for one Debounce call, then
  clears; `pressed_` stays true while the button is held. This matches the real `Switch` impl.

---

## 5. IPC additions (v2)

Extending the v1 message table (04v1 §5) with new message types:

| Direction | Message | Payload |
|-----------|---------|---------|
| ext → runtime | `audioMode` | `simulated` \| `realtime` |
| ext → runtime | `audioDevice` | deviceId, sampleRate, bufferSize |
| ext → runtime | `wavFile` | path, loop (bool) |
| ext → runtime | `button` | gpioPin, pressed (bool) |
| ext → runtime | `buttonSnapshot` | full button state array |
| runtime → ext | `xrun` | count, timestamp |
| runtime → ext | `latency` | measuredRoundTripMs |
| runtime → ext | `spectrum` | in_fft[], out_fft[], binHz |
| runtime → ext | `led` | gpioPin, lit (bool) |

All v1 messages (`pot`, `potSnapshot`, `transport`, `sine`, `config`, `scope`, `status`,
`event`) are unchanged — backward compatible.

---

## 6. Hardware build & flash architecture (C7, C8)

The hardware build follows the same child-process pattern as the emulator build (C3/C1),
but invokes the project's own `Makefile` rather than the ds-ide-managed CMake.

```
C7 (TS): toolchain detect → arm-none-eabi-g++ path →
         spawn `make` in project root → parse output →
         apply diagnostics (FR-ED-3 / FR-HW-1) → emit success/failure
```

```
C8 (TS): dfu-util detect → device in bootloader mode (user action) →
         spawn `dfu-util -D <elf>` → stream progress % →
         report success or error message (FR-HW-3)
```

Toolchain detection order (FR-HW-2): user setting → `arm-none-eabi-gcc` on `PATH` →
known Homebrew path (`/opt/homebrew/bin/`) → ARM developer package path → show install hint.

---

## 7. Full debug wiring (C6 extension)

v1 C6 already connects to lldb-dap. v2 wires the remaining DAP capabilities:

| v2 feature | DAP request | Extension change |
|-----------|-------------|-----------------|
| Step over | `next` | Add "Step Over" button / keybind; dispatch via debug session |
| Step into | `stepIn` | Same |
| Step out | `stepOut` | Same |
| Variables | `variables` (per `stackFrame`) | Show in VS Code Variables panel (native, no webview needed) |
| Watch | `evaluate` | VS Code Watch panel (native) |
| Call stack | `stackTrace` | VS Code Call Stack panel (native) |

VS Code natively supports all these panels once the debug adapter returns correct responses
— minimal extension code needed.

**Mute-on-breakpoint (R15):** when a `stopped` DAP event arrives (breakpoint hit), C6 sends
an `audioMode: simulated` IPC message to C4 (which pauses the OS callback). When `continued`
or `terminated` arrives, C6 sends `audioMode: realtime` to resume. This keeps the OS callback
from starving during a long inspection.

---

## 8. Visual controller editor (C2, M10b)

The editor lives entirely inside C2 (a new tab in the existing webview panel). The runtime
is not involved — the editor only reads and writes `controllers.yaml` via C1.

```
Open editor
  → C1 reads controllers.yaml from disk
  → C1 sends file contents to C2 via webview message
  → C2 parses yaml, renders controls on canvas

User edits canvas (drag, wire pin, rename)
  → C2 serializes canvas state to yaml
  → C2 sends yaml to C1 via webview message
  → C1 writes controllers.yaml to disk
```

**No new IPC messages to the runtime.** The runtime reads `controllers.yaml` at deploy time
(existing behaviour); the editor just provides a visual way to author that file.

**Canvas model:** each control on the canvas carries:
- type (`pot` | `button` | `led`)
- label
- pin assignment (ADC channel for pots; GPIO pin for buttons/LEDs)
- position (x, y) — stored in yaml as an optional `editor_pos:` field, ignored by the runtime

**Controllers palette:** a sidebar listing available control types. Drag-to-canvas instantiates
a new control with default pin assignment; the user then adjusts via inline property fields.

**Relationship to M10:** the editor depends on M10's yaml schema (`buttons:`, `leds:` sections)
and the controller panel being established. It adds no new shim or IPC work — purely a C2/C1
file-editing feature.

---

## 9. Open architectural items (v2)

| Item | Current stance |
|------|----------------|
| ~~Host audio API~~ | ✅ CoreAudio-native for v2; cross-platform deferred to v3+ |
| Mute-on-breakpoint implementation detail | IPC `audioMode` switch; verify no race with lldb halt |
| `Switch::Debounce()` call-rate from loop() | Dedicated debounce thread at ~1 kHz; validate against examples |
| Session recording format | Simple binary (timestamps + samples + pot/button/LED events); design at M-recording |
| Spectrum FFT library | FFTW (GPL — bad) / pocketfft (MIT) / kiss_fft (BSD); decide before M-spectrum |
