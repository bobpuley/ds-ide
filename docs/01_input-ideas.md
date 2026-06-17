# 01 — Input Ideas (v2)

> **v1 complete.** ds-ide 0.1.x (M0–M7) shipped the full v1 scope: native host simulation,
> VS Code extension, CMake emulator build, sine-input audio engine, virtual potentiometers,
> input/output waveform scope, and breakpoint debugging. All ACs (AC-1…AC-8) are green.
> The archived v1 raw ideas and synthesis are in `docs/raw/v1/` and `docs/v1/`.

This document collects the **v2 feature ideas** carried forward from the v1 deferred list
(`docs/v1/01_input-ideas.md` §13/§14, `docs/v1/03_requirements.md` §6). Nothing has been
invented here — all items trace directly to decisions made during v1 planning.

Contradictions or gaps are listed in [Open Conflicts](#open-conflicts).

---

## 1. v2 north star

v1 gave developers a tight inner loop for DSP *logic*. v2 makes that loop **realistic**:
the developer can play a guitar (or any instrument) through their effect in real time on the
desktop, watch the spectrum alongside the waveform, interact with buttons and pots, inspect
variables at a breakpoint, and flash to real hardware without leaving the IDE.

The same "no-hardware-in-the-path" philosophy holds; v2 just raises the audio and
interaction fidelity to match what the real Seed can do.

---

## 2. Audio I/O — live input & host speaker output

These two features are the **highest-priority v2 items** (explicitly flagged in v1 planning)
because they make the emulator feel like real hardware.

- **Live host audio input (priority):** route the host microphone/line input into the
  emulator's input buffer instead of (or alongside) the sine generator. This is "play guitar
  through the Seed" — the single most requested improvement over v1's sine-only input.
  *(deferred from v1 Conflict #6)*
- **WAV file input:** load a WAV file as a repeating or one-shot audio input source.
  Useful for automated regression: same WAV → same output → diff.
  *(deferred from v1 Conflict #6)*
- **Host speaker / line output (real-time monitoring):** route the emulator's output buffer
  to the host audio device (CoreAudio/WASAPI/ALSA) so the developer can *hear* the effect
  in real time. This is what makes latency matter: once host-speaker output is on, the audio
  engine must meet a hard real-time deadline. *(deferred from v1 Conflict #4)*
- **Input source selector:** UI to switch between sine generator / live host input / WAV
  file without restarting the emulator.

### Sequencing note
Host-speaker output changes the engine's clock model: the simulated clock (v1) becomes an
OS-audio-callback-driven clock. This is the biggest architectural delta for v2. It makes
sense to land live input and speaker output together (both require the host audio device open)
before WAV file input (which can replay into the same pipeline).

---

## 3. Virtual controllers — buttons, GPIO & outputs

v1 shipped potentiometers only. v2 adds a minimal set of interactive controls and visual
outputs. Scope to be reviewed and locked before implementation starts.

**Inputs (controls):**
- **Virtual buttons / switches** driving GPIO pin state (high/low); support press, release,
  toggle / momentary, active level, and debounce semantics matching `Switch::Debounce()` /
  `Switch::RisingEdge()`. *(deferred from v1 §7)*
- `Switch` shim: `Debounce()`, `Pressed()`, `RisingEdge()`, `FallingEdge()` backed by
  virtual button state over IPC. *(deferred from v1 §8 / FR-SH-5 stub → full impl)*
- **`controllers.yaml` extended** with a `buttons:` section alongside the existing `pots:`.
- Real-time interaction: pressing a virtual button updates GPIO/`Switch` state immediately,
  including while paused in debug. *(same pattern as pots in v1)*

**Outputs:**
- **Virtual LEDs:** the emulator runtime writes GPIO output state; the UI reflects it as a
  lit/unlit LED indicator. Upgrades the existing LED stub in C5 to a live, IPC-driven display.
- `controllers.yaml` extended with an `leds:` section declaring each LED: `id`, `label`,
  `gpio_pin`.

> ⚠️ ASSUMPTION: the minimal output set for v2 is LEDs only. Encoders, displays (OLED), and
> other peripherals are deferred. Full scope to be confirmed in a pre-implementation M10 review.

---

## 3a. Visual controller editor

A WYSIWYG drag-and-drop editor for `controllers.yaml`, living in the C2 webview alongside
the existing scope/controller panel.

- **Canvas:** the developer drags controls (pots, buttons) onto a virtual panel and positions
  them freely — representing the physical layout of controls on their hardware build.
- **Pin wiring:** each placed control is wired to a specific Daisy Seed ADC channel (for pots)
  or GPIO pin (for buttons) via a UI affordance (dropdown, connection line, or inline property).
- **`controllers.yaml` as round-trip format:** opening the editor reads the existing yaml and
  visualizes it; saving writes changes back to yaml. The yaml remains the source of truth.
- **Hardware wiring reference:** the editor doubles as a hardware documentation artifact —
  the visual layout reflects the actual wiring the developer will build on the real Seed.
- **Controllers palette:** a sidebar listing available control types (pot, button/toggle,
  encoder in future); drag from palette onto canvas to add.

> ⚠️ ASSUMPTION: the editor lives inside the existing C2 webview (new tab or panel), not as
> a separate tool window. Implementation requires no new IPC messages beyond what M10 already
> adds for buttons.

---

## 4. Debugging — full stepping & variable inspection

v1 shipped breakpoints + run/pause/continue/stop only. The underlying lldb-dap backend
(C6) already supports full debug; it's a question of wiring the DAP capabilities through.

- **Step over / into / out** while paused at a breakpoint.
- **Local variable and global variable inspection** in a variables panel.
- **Watch expressions.**
- **Call stack** panel showing the frame hierarchy.
- *(All of these come "for free" from lldb-dap — the v1 DAP plumbing already handles the
  protocol; v2 just exposes the commands and panels in the extension UI.)*

*(Deferred from v1 Conflict #3 / 03 §6)*

---

## 5. Build & toolchain — in-IDE hardware build + DFU flash

v1 was emulator-only; the user kept their external `make`/`dfu-util` workflow. v2 brings
the hardware path inside the IDE.

- **In-IDE hardware-target build:** invoke `arm-none-eabi-g++` / `make` from the project
  `Makefile` as a first-class IDE action, with diagnostics in the Problems panel.
- **DFU flash:** invoke `dfu-util` (BOOT+RESET) from a command, showing flash progress.
  This is the "reality check" path that v1 kept external (D9).
- **ARM toolchain: bundle vs detect.** Open question deferred from v1: should ds-ide
  bundle `arm-none-eabi-gcc` for one-click setup, or rely on the user's installed toolchain?
  *(v1 §16 open item; also 03 §7)*
- **macOS hardware build path validation:** confirm `arm-none-eabi-g++` + `dfu-util` run on
  Apple Silicon. This was flagged as R7 in v1 but not resolved (hardware flash was
  out-of-scope for v1).

---

## 6. Visualization — spectrum & session recording

- **Spectrum / FFT view:** frequency-domain view of input and output (in addition to the
  time-domain waveform). *(deferred from v1 Conflict #5)*
- **Session recording:** record a run (input + output + pot values over time) and replay
  it for regression comparison. *(deferred from v1 §14)*
- **Parameter automation:** record pot movements as a timeline and replay them. Enables
  automated testing of control sweeps.

---

## 7. Board support — built-in control maps

v1 targets the bare Daisy Seed with user-wired controls; fixed-board maps were out of scope.

- **Built-in control maps for:** Daisy Pod, Daisy Patch, Daisy Petal, Daisy Field,
  Terrarium. Each map pre-declares the board's pots, buttons, encoders, and LEDs,
  eliminating the hand-written `controllers.yaml`. *(deferred from v1 §13)*
- **Auto-derived controllers:** parse the effect source for `AdcChannelConfig`/`InitSingle`
  calls and GPIO/`Switch` init to auto-generate a draft `controllers.yaml`.
  *(deferred from v1 §7 / 01 §7)*

---

## 8. Other deferred items

- **MIDI:** MIDI input/output shim (USB MIDI or virtual MIDI port).
  *(deferred from v1 §13 / 03 §6)*
- **Cross-platform debug:** `gdb` parity for Windows/Linux (v1 shipped lldb/macOS only).
  *(deferred from v1 04 §10)*
- **Windows / Linux host audio paths:** WASAPI/ASIO and ALSA/JACK for host-speaker output
  and live input. (v1 accepted macOS-first gaps.)
- **Non-determinism under real-time host audio:** once speaker output is live, the audio
  clock is driven by the OS callback — reproducibility (NFR-6 in v1) becomes harder and
  the mitigation strategy needs revisiting.

---

## 9. Roadmap / phasing (initial thinking)

| Phase | Theme | Key features |
|-------|-------|--------------|
| **v2.0** | Live audio | Live host input + speaker output; WAV file input; input source selector |
| **v2.1** | Full interaction | Virtual buttons/GPIO; `Switch` shim; `controllers.yaml` buttons section |
| **v2.2** | Full debug | Step over/into/out; variables; watch; call stack |
| **v2.3** | Hardware path | In-IDE `arm-none-eabi` build + DFU flash; toolchain bundle decision |
| **v2.4** | Advanced viz | Spectrum/FFT view; session recording; parameter automation |
| **v2.5** | Board support | Built-in board maps; auto-derived controllers; MIDI |

> ⚠️ ASSUMPTION: phasing above is a starting hypothesis. Live audio (v2.0) is confirmed
> highest-priority; everything else is subject to user input.

---

## Open Conflicts

No cross-source conflicts yet (v2 planning is starting fresh). Open questions to resolve:

1. **ARM toolchain bundle vs detect** — ship `arm-none-eabi-gcc` with ds-ide for one-click
   setup, or require the user to install it? Trade-off: bundle size + maintenance vs
   install friction.

2. **Host audio API strategy** — use PortAudio (cross-platform) or native APIs directly
   (CoreAudio on macOS, WASAPI on Windows, ALSA on Linux)? PortAudio abstracts the
   difference but adds a dependency; native gives more control per platform.

3. **Live input + speaker output sequencing** — land both together (same host audio device
   open) or live input first (simpler, no real-time deadline) then speaker output?

4. **Real-time clock model migration** — v1's simulated clock (no xruns) vs v2's
   OS-audio-callback-driven clock (hard deadline once speaker output is live). Does the
   simulated clock remain as an option (visualization-only mode), or does v2 always use the
   real-time clock?
