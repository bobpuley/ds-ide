# Tremolo + Resonant Filter

A complete audio effect built with DaisySP: a sine LFO modulates the volume (tremolo) and a resonant state-variable filter shapes the tone. It is the best first example: it is a real effect, you can hear and see every control working, and it shows the debugger.

## What you will learn

- How an effect fits together: `hw.Init()`, the audio callback, `hw.StartAudio()`.
- How pots reach the code (`hw.adc.GetFloat(channel)`) and how the **Controls Editor** and **Wiring Editor** show them.
- How to read the **Scope** and the spectrum while you turn a control.
- How to stop inside the audio callback with a breakpoint and inspect it.

## Controls

| Control | Pin | What it does |
|---|---|---|
| Rate pot | A0 (D15) | LFO speed, 0.1–10 Hz. The Beat LED blinks at the same rate. |
| Depth pot | A1 (D16) | Tremolo depth. At 0 there is no tremolo. |
| Cutoff pot | A2 (D17) | Filter cutoff, 200–8000 Hz. Lower is darker. |
| Resonance pot | A3 (D18) | Filter resonance, capped at 0.9. The filter rings near the top of the range. |
| Bypass button | D28 | Toggle. On: the dry signal passes untouched and the Beat LED stays off. |
| Beat LED | D23 | On during the high half of each LFO cycle. |

## How to run it

1. Open this folder in VS Code (`File > Open Folder`) and **trust the folder** when asked.
2. Open `tremolo_filter.cpp`, then click the play button at the top right of the editor, or run **Daisy IDE: Run Daisy Effect** from the Command Palette. It builds the effect for the emulator and starts it.
3. The **Scope** and the **Controls Editor** open. The input is a sine wave by default.

The first build compiles DaisySP and takes a little longer. DaisySP is found automatically: the extension uses its own bundled copy when the project has none.

## Things to try

- Raise **Depth**, then move **Rate**. The ripple on the scope speeds up and slows down, and the Beat LED follows.
- Sweep **Cutoff** with **Resonance** high. The peak moves across the spectrum.
- Toggle **Bypass**. The tremolo freezes and the plain sine returns.
- Open the **Wiring Editor** to see each control placed on the Daisy Seed pinout, then drag one to another pin and watch the `ds-ide:controls` block in the source change. `Cmd+Z` undoes it.

## Debugging it

1. Stop the effect, then set a breakpoint in the audio callback, for example on the `lfo.SetFreq(lfoFreq);` line.
2. Run **Daisy IDE: Debug Daisy Effect**. The effect starts under the debugger and audio stops when the breakpoint is hit.
3. Inspect the code state, then continue. Audio resumes.

Debugging uses `lldb-dap`, which comes with the Xcode Command Line Tools (`xcode-select --install`).

## Files

- `tremolo_filter.cpp`: the effect, including the `ds-ide:controls` block that the editors read and write.
- `controllers.yaml`: labels, ranges and positions of the virtual controls.
- `CMakeLists.txt`: lets the extension recognise the folder as a project. The emulator build uses its own CMake file.
