# Daisy Seed Emulator - Requirements Document

**Version:** 0.1 (Draft)  
**Date:** 2026-06-16  
**Status:** Inception – awaiting clarifications

---

## 1. Introduction

This document outlines the requirements for the **Daisy Seed Emulator**, a software component that will be integrated into the `ds-ide` (Daisy Seed Integrated Development Environment). The emulator allows developers to compile, deploy, execute, and debug Daisy Seed firmware entirely on a host computer, without physical hardware. The primary goal is to accelerate the development cycle for audio effects and DSP algorithms targeting the Electrosmith Daisy Seed platform.

The emulator **does not** replace the physical hardware but provides a controlled, reproducible environment for early-stage development, unit testing, and logic debugging.

---

## 2. Scope

**In scope:**
- Integration of existing Daisy toolchain (`libDaisy`, `DaisySP`, ARM GCC compiler) into the IDE for compilation.
- Deployment of compiled binaries (ELF/HEX) to the emulator runtime.
- Execution of the firmware with simulated audio I/O and controllable peripherals.
- Basic debugging support (breakpoints, step-over, variable inspection – limited to first release).
- A simple graphical user interface (GUI) within `ds-ide` to control the emulator (start/stop, set potentiometer/button values).

**Out of scope (for v1):**
- Cycle-accurate CPU/FPU emulation (functional emulation is sufficient).
- Emulation of external hardware (MIDI, USB, SD card, etc.) – only onboard peripherals (ADC, GPIO, DAC, I2C/SPI peripherals if strictly needed) are considered.
- Real-time low-latency performance matching hardware (audio latency may be higher).
- Full GDB server with advanced debugging features (watchpoints, tracing) – only breakpoints and basic step.

---

## 3. Definitions & Acronyms

| Term | Description |
|------|-------------|
| **Daisy Seed** | ARM Cortex-M7 based microcontroller board with audio codec, ADC, DAC, GPIO, etc. |
| **libDaisy** | Hardware abstraction library for Daisy Seed. |
| **DaisySP** | DSP library for audio effects. |
| **IDE** | Integrated Development Environment (`ds-ide`). |
| **Emulator** | Software that mimics the Daisy Seed’s behaviour on a host computer. |
| **Breakpoint** | A point in the code where execution pauses for inspection. |
| **Peripheral** | ADC (analog inputs for pots), GPIO (buttons, LEDs), DAC/Codec (audio I/O). |

---

## 4. Functional Requirements

### 4.1 Compilation (Integration)

| ID | Requirement |
|----|-------------|
| CMP-01 | The IDE shall provide a **"Compile"** button/command that invokes the standard Daisy toolchain (ARM GCC, `make` or `cmake`). |
| CMP-02 | The IDE shall parse compiler output and display errors/warnings in a dedicated panel, with clickable file/line references. |
| CMP-03 | The compilation process shall generate an ELF file (or .bin/.hex) suitable for both physical deployment and emulator execution. |
| CMP-04 | The IDE shall allow the user to select the build configuration (Debug/Release) – Debug builds shall include debug symbols for the emulator. |

### 4.2 Deployment to Emulator

| ID | Requirement |
|----|-------------|
| DEP-01 | The IDE shall provide a **"Deploy to Emulator"** button/command that loads the compiled binary into the emulator runtime. |
| DEP-02 | The emulator shall reset its internal state (memory, peripherals, audio buffers) upon each deployment. |
| DEP-03 | The IDE shall indicate successful deployment or report errors (e.g., invalid ELF format, missing symbols). |

### 4.3 Execution & Audio Simulation

| ID | Requirement |
|----|-------------|
| EXE-01 | The IDE shall provide a **"Start/Stop"** toggle button to begin and halt emulator execution. |
| EXE-02 | While running, the emulator shall continuously process audio blocks (e.g., 64, 128, or 256 samples per block) at a configurable sample rate (default 48 kHz). |
| EXE-03 | **Audio input** – The emulator shall generate a **sine wave** (frequency configurable, default 440 Hz) as its primary test signal. Optionally, it may also accept audio from a WAV file or host microphone (to be decided – see §8). |
| EXE-04 | **Audio output** – The emulator shall stream the processed audio to the host’s sound card (speakers/headphones) via a low-latency audio backend. |
| EXE-05 | **Controller emulation** – The IDE shall provide a panel with **virtual potentiometers** (sliders) and **virtual buttons** (toggle/click) that the user can manipulate in real-time. These inputs are mapped to the emulated ADC and GPIO pins. |
| EXE-06 | The IDE shall allow the user to configure the mapping between virtual controls and Daisy pins (e.g., slider 1 → ADC1, button 1 → GPIO Pin 9). A default mapping shall be provided. |
| EXE-07 | The emulator shall respect the audio processing latency introduced by the firmware (e.g., block processing) and output audio accordingly. |

### 4.4 Debugging (Breakpoint Support)

| ID | Requirement |
|----|-------------|
| DBG-01 | The IDE shall support **adding/removing breakpoints** by clicking on the source code line numbers (only for Debug builds). |
| DBG-02 | When execution hits a breakpoint, the emulator shall **pause** and the IDE shall highlight the current line. |
| DBG-03 | The IDE shall provide a **"Resume"** button to continue execution after a breakpoint. |
| DBG-04 | The IDE shall provide a **"Step Over"** button to execute the next source line without stepping into functions (basic step). |
| DBG-05 | The IDE shall display a **variables/watch** panel showing current values of local/global variables (at least primitive types). |
| DBG-06 | The debugger shall not require a physical GDB server; a built-in lightweight debug stub within the emulator is acceptable for v1. |
| DBG-07 | The IDE shall allow the user to **detach** from the debug session and stop the emulator. |

---

## 5. Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-01 | **Performance** – The emulator shall process audio in real-time (or near real-time) on a standard modern developer laptop (Intel i5/AMD Ryzen 5, 8GB RAM). Block processing time shall not exceed 80% of the block duration to avoid underruns. |
| NFR-02 | **Usability** – The control panel (sliders, buttons) shall respond to user input with a latency under 50 ms. |
| NFR-03 | **Portability** – The emulator and IDE shall run on **Windows 10/11** and **macOS (Intel/Apple Silicon)**. Linux support is desirable but not mandatory for v1 (to be confirmed – see §8). |
| NFR-04 | **Stability** – The emulator shall not crash on invalid ELF files; it shall report meaningful errors. |
| NFR-05 | **Maintainability** – The emulator code shall be modular, separating CPU emulation, peripheral emulation, audio I/O, and debug interface. |

---

## 6. Technical Constraints & Assumptions

- The emulator will **not** execute ARM instructions natively; instead, it will rely on **QEMU** (user-mode) or a custom **interpretive emulator** that can handle Cortex-M7 Thumb-2 instructions and memory-mapped I/O. If using QEMU, integration with the IDE (via QMP or GDB) is required. If custom, development effort increases.
- The emulator must intercept all memory accesses to peripheral addresses (e.g., ADC registers, GPIO registers) and route them to the virtual controls.
- Audio I/O on the host will use:
  - **Windows:** WASAPI or ASIO (if available)
  - **macOS:** CoreAudio
  - **Linux:** ALSA or JACK (if supported)
- The IDE frontend is assumed to be built with a cross-platform framework (e.g., Qt, Electron, or JUCE). This document does not prescribe the UI framework, but the emulator must expose a clean API (C/C++ or inter-process communication) for the IDE to control it.
- The compilation toolchain (ARM GCC, newlib, libDaisy, DaisySP) must be bundled with the IDE or installed separately by the user.

---

## 7. User Workflow (Summary)

1. User writes code in the `ds-ide` editor.
2. Clicks **Compile** – the IDE runs the toolchain and shows results.
3. Clicks **Deploy to Emulator** – the binary is loaded.
4. Clicks **Start** – audio begins (sine wave) and the user can tweak virtual pots/buttons.
5. If behaviour is wrong, user clicks **Pause** (or sets a breakpoint and runs).
6. Debug mode reveals variable values; user fixes code.
7. Repeat from step 2.

---

## 8. Open Questions / Gaps to Fill

Before finalising this requirements document, the following decisions must be made by the project stakeholders (you). Please answer each question explicitly.

| # | Question | Suggested Options | Your Decision |
|---|----------|-------------------|---------------|
| **Q1** | **Emulation engine** – Shall we use **QEMU** (proven, but integration overhead) or build a **custom lightweight emulator** (more control, but higher development effort)? | (A) QEMU (preferred for accuracy) <br> (B) Custom emulator (preferred for simplicity and control) | |
| **Q2** | **Audio input sources** – Beyond a sine wave, do you want to support **WAV file playback** and/or **live microphone input** in v1? | (A) Sine wave only <br> (B) Sine + WAV file <br> (C) Sine + WAV + Microphone | |
| **Q3** | **Host operating systems** – Which OSes must be supported for v1? | (A) Windows only <br> (B) Windows + macOS <br> (C) Windows + macOS + Linux | |
| **Q4** | **Peripheral emulation scope** – Which Daisy peripherals must be emulated? (Minimal: ADC and GPIO for pots/buttons. Do you need DAC, I2C, SPI, UART, MIDI?) | (A) Only ADC + GPIO (buttons) <br> (B) ADC + GPIO + DAC (for audio output) – DAC is implied <br> (C) Also I2C/SPI for external EEPROM or sensors | |
| **Q5** | **Controller mapping** – How many virtual potentiometers and buttons should the GUI provide by default? (Daisy Seed has up to 8 ADC channels and many GPIOs). | (A) 4 pots + 2 buttons <br> (B) 8 pots + 4 buttons <br> (C) Customisable with user-defined number | |
| **Q6** | **Debugging depth** – For v1, you said "just supports add/remove breakpoints". Do you also want **step-into** (vs only step-over)? And **call stack** view? | (A) Breakpoints + Step-over only, no call stack <br> (B) Breakpoints + Step-over + Step-into, no call stack <br> (C) Full GDB-like with call stack and registers | |
| **Q7** | **Audio block size** – What block size should the emulator use for processing? This affects latency and performance. | (A) 64 samples <br> (B) 128 samples <br> (C) 256 samples <br> (D) Configurable by user | |
| **Q8** | **Integration with IDE** – Should the emulator run **in-process** (as a library inside the IDE) or **out-of-process** (as a separate process with IPC)? | (A) In-process (simpler, but crashes affect IDE) <br> (B) Out-of-process (more robust, but IPC overhead) | |
| **Q9** | **Compiler integration** – Should the IDE **bundle** the toolchain (ARM GCC, make) or rely on the user to have it installed (e.g., via `brew`, `apt`, or `setup.exe`)? | (A) Bundle everything for one-click setup <br> (B) Rely on system-installed toolchain (user must set paths) | |
| **Q10** | **Output visualisation** – Besides audio output, would you like a **visual scope/spectrum** of the processed signal displayed in the IDE? | (A) No, audio only <br> (B) Yes, a simple waveform/spectrum display | |

---

## 9. Acceptance Criteria (Draft)

To consider the emulator feature complete for v1, the following criteria must be met:

- [ ] Compilation produces a binary that runs on both physical hardware and the emulator without code changes (provided no hardware-specific hacks).
- [ ] The emulator can load and run the `libDaisy` "Passthrough" example with sine input, outputting an audible sine wave.
- [ ] Moving a virtual slider changes the gain/frequency of the effect (demonstrating ADC emulation).
- [ ] Pressing a virtual button toggles an internal state (demonstrating GPIO emulation).
- [ ] Setting a breakpoint in the `ProcessBlock` function pauses execution at that point.
- [ ] The user can inspect a local variable's value at the breakpoint.
- [ ] The entire workflow from code edit → compile → deploy → run → debug → fix → recompile takes less than 30 seconds for a small change.

---

## 10. Next Steps

1. **Please provide answers to Q1–Q10** in a reply.
2. Based on your answers, I will refine this document into a finalised `requirements.md` with detailed technical specifications, architecture diagrams, and a development roadmap.
3. Once finalised, we can proceed to design the emulator’s internal architecture and begin implementation.

---

*Please fill the gaps above so we can move forward with precision.*