# MIDI synth

A monophonic synthesizer you play from the emulator's on-screen MIDI keyboard. Notes set the pitch, and a MIDI Control Change message switches the waveform. No hardware controller is needed.

## What you will learn

- How a Daisy project receives USB MIDI: a `MidiUsbHandler`, then `Listen()`, `HasEvents()` and `PopEvent()` in the main loop.
- How to read the three message types the example uses: Note On, Note Off and Control Change.
- How a MIDI note number becomes a frequency (`mtof`) and how an envelope (`Adsr`) keeps notes from clicking.
- How the emulator stands in for a keyboard: the **MIDI Panel** sends the same messages a real controller would.

## How to play it

1. Open this folder in VS Code (`File > Open Folder`) and **trust the folder** when asked.
2. Open `midi_synth.cpp` and click the play button at the top right of the editor, or run **Daisy IDE: Run Daisy Effect**.
3. Run **Daisy IDE: Show MIDI Panel** from the Command Palette (`Cmd+Shift+P`) if the panel is not already open.
4. Click keys on the on-screen keyboard. You hear the note while the key is down, and the Scope shows the wave.

The first build compiles DaisySP and takes a little longer. DaisySP is found automatically: the extension uses its own bundled copy when the project has none.

## Changing the waveform

The synth listens for **Control Change #1** (the mod wheel). In the MIDI Panel, leave **CC** on `1`, type a value in the second box and press **Send CC**:

| CC #1 value | Waveform |
|---|---|
| 0 to 25 | Sine |
| 26 to 51 | Triangle |
| 52 to 76 | Saw |
| 77 to 102 | Ramp |
| 103 to 127 | Square |

Hold a note, send a new value, and watch the Scope change shape. The **Rx** entries in the panel's monitor show every message the synth received.

## Things to try

- Compare the sine and the square wave in the spectrum: the square adds odd harmonics.
- Press two keys at once. The synth is monophonic and the last key pressed wins; releasing the first key does not cut the second.
- Move the **Volume** pot in the Controls Editor.
- Open `midi_synth.cpp` and change the `Adsr` times in `main()` to feel a slower attack or a longer release.
- Change `kWaveformController` to another controller number, rebuild, and send that number from the panel.

## A detail worth knowing

Many keyboards send a Note On with velocity 0 instead of a Note Off. libDaisy reports it as a Note On, so the example treats `velocity == 0` as a release.

## Files

- `midi_synth.cpp`: the synth, including the `ds-ide:controls` and `ds-ide:peripherals` blocks that the Wiring Editor reads and writes.
- `controllers.yaml`: label and range of the Volume pot.
- `CMakeLists.txt`: lets the extension recognise the folder as a project. The emulator build uses its own CMake file.
