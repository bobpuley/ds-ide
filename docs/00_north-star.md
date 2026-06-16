# 00 — North Star

The one-page anchor for **ds-ide**. If a decision doesn't serve this page, question the decision.
Details live in [01](01_input-ideas.md)–[05](05_dev-plan.md); this is the why and the what.

---

## The problem

Building audio effects for the **Daisy Seed** means a slow loop: edit → build → **flash hardware** →
plug in a guitar → listen → guess at what went wrong → repeat. There's no way to *see* what the code
is doing while it runs, and every iteration pays the flash-and-replug tax.

## The core idea

> **ds-ide lets you run and debug a Daisy Seed effect on your desktop — same source, no hardware in
> the loop — so the inner loop drops from minutes to seconds.**

It does this by **recompiling the effect for the host CPU** against a software stand-in for the Daisy
hardware (a libDaisy *shim*), not by emulating the STM32 chip. Correctness and DSP iteration, fast;
the real Seed remains the final reality check.

## Target UX (the loop we're optimizing)

```
open effect → build (host) → run → drive audio with a sine →
turn on-screen pots → watch input vs output waveforms →
set a breakpoint → pause with time frozen → inspect → fix → repeat
```

All in one place (a **VS Code extension**), starting on **macOS / Apple Silicon**.

## What v1 is — and isn't

| v1 **is** | v1 is **not** (deferred) |
|-----------|--------------------------|
| Native simulation (host compile + shim) | STM32/ISA emulation |
| Bare **libDaisy/DaisySP** C++ effects | Arduino/DaisyDuino, gen~/Pd |
| **Sine** input, **waveform** visualization | Live/WAV input, host-speaker audio, spectrum |
| **Potentiometers** (ADC) | Buttons/GPIO |
| **Breakpoints** + run/pause/continue/stop, time frozen | Stepping, variables, call stack |
| Emulator path only | In-IDE hardware build/flash |

## MVP — definition of done

v1 is done when, for a real ported effect (`tremolo` / `equalizzatore`):

- **AC-1** — it builds for the emulator, deploys, and runs on Start.
- **AC-2** — turning an on-screen pot visibly changes the output on the scope (ADC works).
- **AC-4** — a breakpoint inside the audio callback is hit; the line is shown; **simulated time is
  frozen**; Continue resumes; Stop ends.
- **AC-5** — a NaN/clipping bug is flagged (debug value the ear would miss).
- **AC-6** — the existing external hardware build still works untouched.
- **AC-7** — the full edit→…→recompile loop is **< 30 s** for a small change.

## Non-negotiables

- **Speed is the product.** If the inner loop isn't seconds-fast, ds-ide has failed its purpose.
- **Same source, no edits.** Switching to the emulator (or to debug) requires no code changes.
- **Don't break the hardware path.** ds-ide lives alongside the standard build, never in its way.
- **Honest fidelity.** The emulator proves *correctness*, not the Seed's real-time CPU/RAM budget —
  and says so. "Runs in ds-ide" ≠ "fits on hardware."
- **Simplicity first.** Complexity only when strictly justified; defer minor gaps pragmatically.

## The bet (and its blind spot)

We're betting that native simulation gives 90% of the debugging value for 10% of the effort of chip
emulation — **verified** against the user's real effects, which are clean, portable C++. The known
blind spot: native sim can't tell you if an effect *fits* on the M7. That answer stays on hardware;
ds-ide's job is to make everything *up to* that point fast.
