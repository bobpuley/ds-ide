# 05 — Development Plan (v2)

> **v1 complete.** M0–M7 shipped as ds-ide 0.1.0–0.1.7. All ACs (AC-1…AC-8) green.
> v1 milestone files are in `docs/milestones/v1/M0.md`…`M7.md` (read-only history).
> Archived plan: `docs/v1/05_dev-plan.md`.

Sprint/milestone plan for **ds-ide v2** (target: 0.2.x). Built on
[03_requirements.md](03_requirements.md) and [04_architecture.md](04_architecture.md).
Each milestone is a demonstrable vertical slice closing ≥ 1 AC.

Same sprint-close protocol: automated tests pass → human test feedback → merge →
inspect tags → propose semver → update CHANGELOG.md → annotated tag → push.

---

## 0. v2 Milestone Registry

| Milestone                          | Theme                                  | Target version | Status         |
|------------------------------------|----------------------------------------|----------------|----------------|
| M8 — Real-time audio I/O           | Live input + speaker output            | 0.2.0          | in progress    |
| M9 — WAV file input                | File-based audio source                | 0.2.1          | planned        |
| M10 — Virtual buttons, GPIO & LEDs | Controls + outputs; scope review first | 0.2.2          | needs review   |
| M10b — Visual controller editor    | Drag-and-drop panel + pin wiring       | 0.2.3          | planned        |
| M11 — Full debug                   | Step / variables / call stack          | 0.2.4          | planned        |
| M12 — Hardware build & flash       | arm-none-eabi + dfu-util               | 0.2.5          | planned        |
| M13 — Spectrum & FFT               | Frequency-domain view                  | 0.2.6          | planned        |
| M14 — Session recording            | Record / replay / compare              | 0.2.7          | planned        |

> M8 is confirmed highest-priority. Milestone ordering M8 → M9 → M10 → M10b → M11 → M12 → M13 → M14
> is confirmed. M10 scope (controls + outputs) must be reviewed and locked before implementation begins.

---

## 1. Approach

- Same walking-skeleton-first principle as v1: land the hardest architectural change (real-
  time audio clock, M8) before adding features that depend on it.
- **M8 is the critical v2 gate:** it changes the engine's clock model (04 §2). Everything
  else in v2 layers on top without rearchitecting.
- Feature milestones (M9–M14) are relatively independent once M8 is stable.

---

## 2. Dependency graph & critical path

```
v1 (0.1.7, stable) ──► M8 real-time audio ──┬──► M9 WAV input
                                              ├──► M10 buttons / GPIO / LEDs ──► M10b visual editor
                                              ├──► M11 full debug (needs M8 mute-on-breakpoint)
                                              ├──► M12 hardware build (independent)
                                              ├──► M13 spectrum (needs M8 real-time stream)
                                              └──► M14 session recording (needs M8 pipeline)
```

**Critical path:** M8. All subsequent milestones can progress in parallel once M8 is stable,
but M11 (mute-on-breakpoint) and M13/M14 (audio pipeline) have soft dependencies on it.
M10b (visual editor) depends on M10 (yaml schema and controller panel must exist first).

---

## 3. AC coverage map

| AC | Closed in | AC | Closed in |
|----|-----------|----|----|
| AC-9 live audio in + out | M8 | AC-13 hardware build + flash | M12 |
| AC-10 WAV file input | M9 | AC-14 spectrum FFT spike | M13 |
| AC-11 virtual button + LED | M10 | AC-15 visual editor round-trip | M10b |
| AC-12 step/variables/call stack | M11 | AC-16 session record + replay | M14 |

---

## 4. Milestone sketches

### M8 — Real-time audio I/O (0.2.0)
**Goal:** play live audio through an effect and hear the output through the host speakers.

Key tasks:
- Decide host audio API (CoreAudio vs PortAudio — 04 §9 open item).
- Implement two-mode clock in C4: real-time (OS callback) + simulated (v1 mode, kept intact).
- Open host audio input device; feed blocks into the existing effect callback pipeline.
- Open host audio output device; write processed blocks out.
- Add input source selector to C2 webview (sine / live / WAV stub).
- Add xrun counter and round-trip latency display (NFR-11, NFR-12).
- IPC: `audioMode`, `audioDevice` messages.
- **Mute-on-breakpoint stub:** add `audioMode: simulated` IPC switch to C4 (no UI wiring yet);
  M11 will complete the wiring. This stub is required so M11 has something to connect to.
- **AC-9 green.** No regression to AC-1…AC-8 (simulated mode still works).

### M9 — WAV file input (0.2.1)
**Goal:** load a WAV file as a repeating or one-shot audio source for automated regression.

Key tasks:
- WAV file reader in C4 (libsndfile or a minimal MIT WAV parser).
- Feed WAV blocks into the block loop (simulated-clock mode).
- IPC: `wavFile` message.
- UI: file picker in C2, loop toggle.
- **AC-10 green.**

### M10 — Virtual buttons, GPIO & LEDs (0.2.2)
**Goal:** press a virtual button and have the effect respond; trigger an LED from the effect and see it lit in the UI.

> ⚠️ Scope must be reviewed and locked before implementation. The tasks below are a starting
> sketch only — minimal controls (buttons) and minimal outputs (LEDs) confirmed; exact
> IDs and yaml schema details to be finalized in the pre-implementation review.

Key tasks (draft):
- `controllers.yaml` `buttons:` + `leds:` section parser.
- Button rendering in C2 (press/release, toggle/momentary visual state).
- LED rendering in C2 (lit/unlit driven by runtime GPIO output state).
- `Switch` shim in C5: `Debounce()`, `Pressed()`, `RisingEdge()`, `FallingEdge()` backed by
  atomic button state (same pattern as ADC).
- LED shim in C5: GPIO output write → IPC `led` message → C2 indicator.
- IPC: `button`, `buttonSnapshot`, `led` messages.
- Test against an example that uses `Switch` + LED (e.g. bypass with button + status LED).
- **AC-11 green.**

### M10b — Visual controller editor (0.2.3)
**Goal:** drag controls onto a canvas, wire each to a Daisy pin, and have `controllers.yaml`
updated automatically — so the layout doubles as a hardware wiring reference.

Key tasks:
- Editor canvas in C2 (new tab alongside scope/controller panel): drag controls from a
  palette (pot, button, LED) onto a free-form panel.
- Pin wiring UI: each placed control exposes an ADC channel (pots) or GPIO pin (buttons/LEDs)
  selector; selected value written to yaml.
- `controllers.yaml` round-trip: load → parse → render onto canvas; save → serialize
  canvas state → write yaml.
- Controllers palette sidebar: available control types listed; drag-to-canvas to instantiate.
- No new IPC messages required (runtime reads yaml on deploy; editor only edits the file).

### M11 — Full debug (0.2.4)
**Goal:** step through the audio callback and inspect variables without leaving ds-ide.

Key tasks:
- Wire DAP `next`, `stepIn`, `stepOut` through C6 to VS Code debug UI (FR-DB-7).
- Variables, watch, and call stack come from lldb-dap responses; VS Code renders them natively.
- Implement mute-on-breakpoint: C6 sends `audioMode: simulated` on `stopped` DAP event,
  `audioMode: realtime` on `continued` (R15 mitigation, 04 §7).
- **AC-12 green.**

### M12 — Hardware build & flash (0.2.5)
**Goal:** build and flash to real Daisy Seed hardware without leaving ds-ide.

Key tasks:
- Toolchain detection (C7): user setting → PATH → Homebrew → install hint (FR-HW-2).
- Hardware build command: invoke project `Makefile` via C7, parse diagnostics (FR-HW-1).
- DFU flash command (C8): invoke `dfu-util`, stream progress, surface errors (FR-HW-3).
- Validate on macOS Apple Silicon with a Daisy Seed connected.
- **AC-13 green.**

### M13 — Spectrum & FFT (0.2.6)
**Goal:** add a frequency-domain view alongside the existing waveform scope.

Key tasks:
- FFT library decision (pocketfft or kiss_fft — 04 §8); integrate into C4.
- Compute FFT per scope tap; send as `spectrum` IPC message.
- C2 webview: draw input/output spectrum alongside waveform.
- **AC-14 green.**

### M14 — Session recording (0.2.7)
**Goal:** record a run and replay it for regression comparison.

Key tasks:
- Session recording format design (timestamps + samples + pot/button/LED events).
- Record mode in C4: write blocks + events to file.
- Replay mode: feed recorded blocks into the existing pipeline (simulated-clock mode).
- UI: record/replay controls in C2.

---

## 5. Risk-driven sequencing notes

- **R12/R13 (real-time audio):** M8 is the proof that the clock model change works without
  xruns. Validate early on the development machine before building M9–M14 on top.
- **R15 (breakpoint + live audio):** mute-on-breakpoint is a critical M11 task; design it
  in M8 as a stub (IPC `audioMode` switch) so M11 just wires it.
- **R14 (debounce timing):** validate the `Switch` shim debounce call-rate in M10 against
  a real effect before considering it closed.
- **R16/R17 (hardware toolchain):** M12 is last because it's most machine-dependent and
  doesn't block any other v2 feature.

---

## 6. Open items for v2 planning

| Item | Resolve by |
|------|-----------|
| ~~Host audio API decision~~ | ✅ CoreAudio-native for v2; cross-platform deferred to v3+ |
| ARM toolchain bundle vs detect | Before M12 design |
| FFT library selection | Before M13 design |
| Session recording format | Before M14 design |
| ~~Phasing within v2~~ | ✅ Confirmed: M8→M9→M10→M10b→M11→M12→M13→M14 |
