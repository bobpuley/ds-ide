# Daisy IDE guide for AI coding agents

Describes Daisy IDE 0.25.x. Last verified: 2026-11-15.

Read this file completely before you create or change a Daisy Seed effect in this project. Daisy IDE is a VS Code extension that builds the effect as a native desktop program against a host libDaisy compatibility layer, runs it in an emulator (scope, virtual controls, MIDI, OLED, SD card), and builds and flashes the real board. It is not an STM32 emulator. Follow the rules below; they are what the IDE parses and the emulator supports.

## 1. Project layout

- The effect is one `.cpp` file. The IDE looks for it in the project root, then `src/`, then `source/`. If a folder has several `.cpp` files, the one that is not `main.cpp` wins; with more than one candidate the IDE cannot choose. Keep exactly one effect source.
- A `ds-ide.effectSource` setting in `.vscode/settings.json` can point to another file inside the project.
- `controllers.yaml` sits in the project root next to the source.
- A `CMakeLists.txt` in the project root only marks the folder as an effect project. Do not put build logic in it: the emulator build uses a CMake file the IDE generates.
- `DaisySP/Source/` is a bundled copy of DaisySP used by the emulator build. Do not edit it.
- Hardware build and flash use the project's own `Makefile` (libDaisy style). Do not create or change it unless the user asks.
- `main()` is renamed to `effect_main` for the emulator, so keep a normal `int main()` in the effect file.

## 2. Include and basic structure

- Include `"daisy_seed.h"` (and `"daisysp.h"` only if you use DaisySP). Use `using namespace daisy;`.
- Declare one global `DaisySeed hardware;`.
- In `main()`: `hardware.Init();`, optional `hardware.SetAudioBlockSize(n);`, set up controls, `hardware.adc.Start();` when ADC is used, `hardware.StartAudio(AudioCallback);`, then loop forever with `System::Delay(1);` (or an empty loop).
- Two audio callback forms are supported. Use the one the code already uses; do not mix them.
  - Interleaved: `void cb(AudioHandle::InterleavingInputBuffer in, AudioHandle::InterleavingOutputBuffer out, size_t size)`, samples packed L R L R, `size` counts all samples.
  - Block: `void cb(AudioHandle::InputBuffer in, AudioHandle::OutputBuffer out, size_t size)`, `in[0][i]` is left and `in[1][i]` is right.
- Audio runs at 48 kHz stereo. Read the real values with `hardware.AudioSampleRate()` and `hardware.AudioCallbackRate()`.
- Inside the audio callback do no allocation, no printing, no file or SD access, no locks.

## 3. The `ds-ide:controls` block

The Controls Editor and Wiring Editor read this block to know which controls exist.

```cpp
// ds-ide:controls:begin
  AdcChannelConfig ds_ide_adc_cfg[2];
// ds-ide: id=gainPot, kind=pot, pin=15
// ds-ide: id=tonePot, kind=pot, pin=16
Switch muteBtn; // ds-ide: id=muteBtn, kind=button, pin=28
Led statusLed; // ds-ide: id=statusLed, kind=led, pin=23
// ds-ide:controls:end
```

Rules:

- The block starts with `// ds-ide:controls:begin` and ends with `// ds-ide:controls:end`, each alone on its line, begin before end.
- Every control is one line carrying the annotation `// ds-ide: id=<id>, kind=<kind>, pin=<n>`. Multi-pin devices add `, pins=<p0>,<p1>,<p2>`; `pin` is then the first of them.
- `kind` is one of: `pot`, `button`, `led`, `toggle`, `rgbled`, `encoder`.
- `id` is unique in the block and must match the same `id` in `controllers.yaml` for pots, buttons and LEDs.
- `pin` is the Daisy Seed pin number: GPIO 0–30; ADC pins are 15–26 (A0–A11). Two controls must not use the same pin.
- Pots are the only controls with no C++ declaration of their own: they are channels of the shared array `AdcChannelConfig ds_ide_adc_cfg[N];` and their annotation lines have no declaration. The channel number is the position of the pot in that array.
- Do not hand-write the block for a new project from memory when the user can wire controls in the Wiring Editor (see section 8). Edit it by hand only to keep it consistent with code you changed.

| kind | C++ type | Pins | Notes |
|---|---|---|---|
| `pot` | channel of `AdcChannelConfig ds_ide_adc_cfg[N]` | 1 ADC pin | read with `hardware.adc.GetFloat(channel)` |
| `button` | `Switch` | 1 | `Debounce()` every callback, then `Pressed()`, `RisingEdge()`, `FallingEdge()` |
| `led` | `Led` | 1 | `Set(0..1)` then `Update()`; pin 23 is the onboard LED |
| `toggle` | `Switch3` | 1 | `Debounce()` then `Read()` returns 0, 1 or 2 |
| `rgbled` | `RgbLed` | 3 (`pins=r,g,b`) | `Set(r,g,b)` then `Update()` |
| `encoder` | `Encoder` | 3 (`pins=a,b,click`) | `Debounce()`, `Increment()`, `Pressed()` |

## 4. The init block

The IDE writes the `Init` calls for the declared controls between these markers inside `main()`, after `hardware.Init();`:

```cpp
// ds-ide:controls:init:begin
  muteBtn.Init(daisy::seed::D28, hardware.AudioCallbackRate());
  statusLed.Init(daisy::seed::D23, false);
  ds_ide_adc_cfg[0].InitSingle(daisy::seed::A0);
  hardware.adc.Init(ds_ide_adc_cfg, 2);
// ds-ide:controls:init:end
```

- Keep both markers. Do not put your own code between them: the Wiring Editor regenerates the region.
- Put everything else (`hardware.adc.Start();`, `StartAudio`, your own setup) outside it.

## 5. Other peripherals

SD card, OLED and MIDI are declared in a separate block, and the IDE generates their setup as well:

```cpp
// ds-ide:peripherals:begin
  MidiUsbHandler ds_ide_midi_usb;
  OledDisplay<SSD130x4WireSpi128x64Driver> ds_ide_oled;
// ds-ide:peripherals:end
```

- Supported: `MidiUsbHandler`, `MidiUartHandler` (TRS), `OledDisplay` (128x64 SSD130x), `SdmmcHandler` with `FatFSInterface` and the FatFs file functions.
- MIDI: `Listen()`, then `while (midi.HasEvents()) { auto e = midi.PopEvent(); ... }`; `AsNoteOn()`, `AsNoteOff()`, `AsControlChange()`, `AsProgramChange()`.
- The SD card is the project's `sdcard/` folder on the computer.
- Pins used by SD, OLED and MIDI-TRS conflict with each other and with GPIO controls; the Wiring Editor flags conflicts. Do not assign these pins to controls by hand.
- Do MIDI, SD and OLED work in `main()`'s loop, never in the audio callback.

## 6. `controllers.yaml`

Sections are all optional. Example:

```yaml
controllers:
  - id: gainPot
    label: Gain
    adc_channel: 0
    range: [0, 1]
    taper: linear
    default: 0.7
buttons:
  - id: muteBtn
    label: Mute
    gpio_pin: 28
    mode: momentary
    active_level: low
leds:
  - id: statusLed
    label: Status
    gpio_pin: 23
```

- `controllers:` (pots): `id`, `label`, `adc_channel` (integer 0–11, unique), `range: [min, max]`, `taper` (`linear`, `log` or `antilog`), `default` (0–1). `range` maps the slider to the value the emulator gives your code.
- `buttons:`: `id`, `label`, `gpio_pin` (0–30, unique), `mode` (`momentary` or `toggle`, default `momentary`), `active_level` (`high` or `low`, default `low`).
- `leds:`: `id`, `label`, `gpio_pin` (0–30, unique).
- `encoders:`, `toggles:` and `rgbleds:` hold only `id` and `editor_pos`; their pins come from the code annotation.
- `editor_pos: [x, y]` is written by the editor when the user drags a control. Never edit it by hand.
- Ids must match the code annotations exactly. Rename an id in the source and the YAML together or not at all.

## 7. What the emulator supports

- Supported classes: `DaisySeed` (`Init`, `Configure`, `SetAudioBlockSize`, `AudioSampleRate`, `AudioCallbackRate`, `GetPin`, `StartAudio`, `SetLed`, `PrintLine`), `AdcChannelConfig` and `AdcHandle`, `System::Delay`, `Switch`, `Switch3`, `Led`, `RgbLed`, `Encoder`, the MIDI, OLED and SD classes of section 5, and the pin constants `daisy::seed::D0`–`D30` and `A0`–`A11`.
- DaisySP is available: include `"daisysp.h"`. A project can also carry its own copy in `DaisySP/Source`.
- Anything else from libDaisy (DAC, SDRAM sections, Qspi, timers, USB serial, CV and gate helpers, other displays and drivers) is not provided. Code using it does not build in the emulator.
- The emulator build defines no macro that tells your code it runs on the host. Do not invent one; ask the user before adding conditional code for hardware-only parts.
- GPIO is not emulated at register level. Pins are labels that connect a control to the code; two controls on one pin is an error.
- Timing is not cycle-accurate. Do not rely on CPU load, interrupt timing or memory limits being modelled.
- When a build fails on a missing libDaisy symbol, report the symbol to the user. Do not invent a stub for it in the project.

## 8. Commands (Command Palette, prefix "Daisy")

| Task | Command |
|---|---|
| Build and run in the emulator | Run Daisy Effect, or Build & Deploy to Emulator |
| Debug with breakpoints (lldb) | Debug Daisy Effect |
| Stop | Stop Daisy Effect |
| Compile for the board | Build for Hardware |
| Flash over DFU | Flash to Daisy Seed, or Build & Flash to Daisy Seed |
| Wire controls visually | Focus Wiring Editor |
| Panels | Show Scope, Show OLED Display, Show MIDI Panel, Focus Controls Editor |
| New project | Create New Effect Project |

The Wiring Editor writes the controls block, the init block and `controllers.yaml` together. When the user needs to add or move a control, prefer asking them to use it over editing those regions by hand.

## 9. Writing a new effect

1. Start from the structure in section 2.
2. Declare each control the effect needs, with the annotation, and add it to `controllers.yaml` (sections 3 to 6).
3. Read controls inside the audio callback, or in `main()`'s loop for slow ones.
4. Keep the DSP in plain C++ or DaisySP.
5. Tell the user to run the effect and check the scope.

## 10. Adapting an existing libDaisy effect

1. Find the effect source file and keep its DSP unchanged.
2. List the hardware the code uses: ADC channels, `Switch`, `Led`, `Encoder` and similar objects, SD, OLED, MIDI.
3. For each supported device, add the annotation line (section 3) with the pin the code uses today, put the `Init` calls between the init markers (section 4), and add the matching `controllers.yaml` entry with a sensible `label`, `range` and `default`.
4. Convert pin expressions to numbers: `daisy::seed::D28` is pin 28, `A0` is pin 15.
5. Move unsupported hardware use (section 7) out of the emulator path, or stop and ask the user what it should do on the host.
6. Keep the original `Makefile` and project files; do not delete hardware setup the board still needs.
7. Ask the user to run Run Daisy Effect. If the build fails, read the error, fix it, and run again.

## 11. Do not

- Do not remove or rename the `ds-ide:` markers or annotations.
- Do not edit `editor_pos`, `DaisySP/Source/`, or generated build folders (`.ds-ide/`, `build/`).
- Do not add features, libraries or files the user did not ask for.
- Do not claim that something works on the board because it works in the emulator.

## 12. Ask the user when

- The effect has more than one `.cpp` candidate for the effect source.
- It uses hardware the emulator does not provide.
- Two controls would share a pin.
- The pin a control should use is unknown.
