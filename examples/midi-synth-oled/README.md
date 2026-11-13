# MIDI synth with an OLED

The [`midi-synth`](../midi-synth) example plus a 128 by 64 OLED display that draws the selected waveform. Read that example's README first; this one only describes what is new.

## What you will learn

- How an OLED is declared and initialised in a Daisy project, and how the Wiring Editor adds it for you (`ds-ide:peripherals` block).
- How to draw on it: `Fill()`, `DrawPixel()` and `Update()`.
- Why the display draws a shape instead of the waveform's name. The emulator's display has pixel primitives only, with no text or fonts, so there is no `WriteString()`. The example plots one waveform pixel by pixel, which is also a good exercise in turning a function into a picture.
- How to redraw only when needed, and still show something to a display that connects late.

## How to play it

1. Open this folder in VS Code (`File > Open Folder`) and **trust the folder** when asked.
2. Open `midi_synth_oled.cpp` and click the play button at the top right of the editor, or run **Daisy IDE: Run Daisy Effect**.
3. Run **Daisy IDE: Show OLED Display** and **Daisy IDE: Show MIDI Panel** from the Command Palette (`Cmd+Shift+P`) if the panels are not already open.
4. In the MIDI Panel, click keys to play and send **Control Change #1** values to change the waveform. The values are the same as in `midi-synth`: 0 to 25 sine, 26 to 51 triangle, 52 to 76 saw, 77 to 102 ramp, 103 to 127 square.

## What the display shows

- Two cycles of the selected waveform across the screen. Saw falls and ramp rises, as in DaisySP.
- A small filled square in the top-left corner while a note is held. It clears when you release the key.

## Things to try

- Send a few different CC values and compare the shapes with the Scope. The OLED is a drawing of the idealised wave; the Scope shows the real output.
- Change `kCycles` in `Draw()` to show one cycle or four.
- Add a sixth shape: write a new case in `ShapeAt()` (a half-wave, say), extend `kWaves`, and update `ShapeFromCc()`.
- Delete the periodic refresh in `main()`, rebuild, and open the OLED panel after the effect has started: it stays blank until the first MIDI message. This is why the example redraws about every 250 ms.

## Limits to know about

- The emulator's OLED has no text, no fonts and no line or rectangle helpers, only single pixels. Code that uses `WriteString()` or `DrawLine()` from the real libDaisy will not build here yet.
- The example uses the SPI display bus. Pins D7 to D10 are used by it, so avoid them for other controls.

## Files

- `midi_synth_oled.cpp`: the synth and the display code, including the `ds-ide:controls` and `ds-ide:peripherals` blocks.
- `controllers.yaml`: label and range of the Volume pot.
- `CMakeLists.txt`: lets the extension recognise the folder as a project. The emulator build uses its own CMake file.
