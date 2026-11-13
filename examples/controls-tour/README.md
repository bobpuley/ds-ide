# Controls tour

One of every basic control the emulator offers (pot, button, toggle switch, LED, RGB LED and rotary encoder), each wired to something you can hear or see. It is written in plain libDaisy, with no DaisySP, so it builds with nothing but the extension.

## What you will learn

- How each control is declared in code and shown in the **Controls Editor** and **Wiring Editor**.
- How the code reads each one: `hardware.adc.GetFloat()` for pots, `Switch::Pressed()` for buttons, `Switch3::Read()` for a 3-position toggle, `Encoder::Increment()` for a rotary encoder.
- How the code drives each output: `Led::Set()` and `RgbLed::Set()`, each followed by `Update()`.
- What the `ds-ide:controls` block is: the part of the source the editors read and write, so the pin you drop in the Wiring Editor and the pin in your code are the same.

## Controls

| Control | Pin | What it does |
|---|---|---|
| Gain pot | A0 (D15) | Output level. |
| Tone pot | A1 (D16) | Brightness. Turn it down and the sound gets darker (a one-pole low-pass written in the example). |
| Mute button | D28 | Momentary. While held, the output is silent. |
| Mode toggle | D27 | Three positions, 0 to 2: **0** clean, **1** soft clip, **2** bit crush. Click it to step through the positions. |
| Dial (encoder) | D24 to D26 | Drag it up or down to set the drive amount. It scales how hard the soft clip or bit crush works. |
| Status LED | D23 | On while audio is passing, off while Mute is held. |
| Colour LED | D18 to D20 | Green in mode 0, yellow in mode 1, red in mode 2. Its brightness follows the drive amount. |

## How to run it

1. Open this folder in VS Code (`File > Open Folder`) and **trust the folder** when asked.
2. Open `controls_tour.cpp` and click the play button at the top right of the editor, or run **Daisy IDE: Run Daisy Effect**.
3. The **Scope** opens and the **Controls Editor** switches to run mode, with all seven controls on the canvas.

## Things to try

- Put the toggle on **1**, then drag the dial up. The scope's sine turns into a flat-topped wave, and the colour LED gets brighter.
- Put the toggle on **2** and raise the drive: the waveform turns into steps. Watch the spectrum fill with extra harmonics.
- Hold **Mute**: the scope goes flat and the Status LED goes off. Release it and both come back.
- Lower **Tone** and see the sine lose level as the filter closes (clearer with the **Noise** input in the Scope toolbar).
- Open the **Wiring Editor**. Drag the Tone pot to another analog pin and look at the `ds-ide:controls` block in `controls_tour.cpp`: the declaration and the init lines both change. `Cmd+Z` undoes it.

## Limits to know about

- The encoder's push-button (its click) is part of the real hardware but cannot be pressed from the Controls Editor in this preview, so this example does not use it.
- Pins D1 to D14 are left free on purpose: the SD card, OLED and MIDI TRS use them, and the other examples add those peripherals.

## Files

- `controls_tour.cpp`: the effect, including the `ds-ide:controls` block and the init lines inside the `ds-ide:controls:init` markers.
- `controllers.yaml`: labels, ranges and editor positions of the virtual controls.
- `CMakeLists.txt`: lets the extension recognise the folder as a project. The emulator build uses its own CMake file.
