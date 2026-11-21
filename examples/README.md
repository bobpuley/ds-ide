# Examples

Five small projects, each showing one thing Daisy IDE does. Open any one of them as a folder in VS Code (`File > Open Folder`), trust it, and click the play button in the editor. Each has its own README that says what to try and what you will learn.

They are independent, so you can start anywhere. If you are new, this order builds up from the simplest to the most involved:

1. [tremolo-filter](tremolo-filter/): a complete DaisySP effect with four pots, a button and an LED. Start here to see the Scope, the spectrum and the Controls Editor, and to try breakpoint debugging.
2. [controls-tour](controls-tour/): one of every basic control (pot, button, toggle, LED, RGB LED and encoder) in plain libDaisy.
3. [midi-synth](midi-synth/): a synth played from the on-screen MIDI keyboard, with a Control Change message that switches the waveform.
4. [midi-synth-oled](midi-synth-oled/): the same synth with an OLED that draws the selected waveform.
5. [controls-sd-logger](controls-sd-logger/): the controls tour plus an SD card that logs everything you do, and the audio-thread-safe pattern for doing it.

## Before you start

- Open the example folder itself, not the `examples` folder, and **trust it** when VS Code asks.
- The first build compiles the emulator and (for the DaisySP examples) DaisySP, so it takes a little longer than later ones.
- On macOS you need CMake (`brew install cmake`) and the Xcode Command Line Tools. On Windows nothing needs installing by hand: the extension offers to download a toolchain the first time you build. The extension's README lists the full requirements.
- Examples that use the SD card write to a `sdcard/` folder inside the example, so copy an example out of the extension's folder before running it if you want to keep your changes.
