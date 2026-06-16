This is an excellent initiative. Mental debugging of digital signal processing (DSP) code on embedded hardware is a famously painful bottleneck. Building `ds-ide` to close that loop with a virtualized environment will save you countless hours of deployment and guessing.

As an experienced engineer, you know that the leap from a conceptual workflow to a functional IDE/emulator requires strict boundary definitions—especially when bridging UI, toolchains, and real-time audio.

Here is the drafted `requirements.md` documentation based on your desired workflow. I have structured it to serve as a solid foundation, followed by the critical gaps we need to address before you start building.

---

# `requirements.md`: Daisy Seed Emulator IDE (ds-ide)

## 1. Project Overview

**ds-ide** is an Integrated Development Environment and emulation platform designed for Daisy Seed hardware developers. It streamlines the development cycle by allowing developers to write, compile, deploy, execute, and debug embedded DSP audio effects entirely within a simulated desktop environment before targeting physical hardware.

## 2. Core Workflows

### 2.1 Target Workflow

1. **Authoring:** Developer writes C/C++ DSP code using the integrated editor.
2. **Compilation:** IDE triggers the toolchain to compile the firmware.
3. **Deployment (Virtual):** IDE loads the compiled artifact into the integrated emulation environment.
4. **Execution:** Developer starts the emulation. The emulator feeds a synthetic audio signal (e.g., sine wave) into the virtual DSP engine. Developer interacts with virtual controllers (potentiometers, buttons) mapped to hardware pins.
5. **Debugging:** If anomalous audio behavior is detected, the developer pauses execution, sets breakpoints, steps through the code, and inspects variables.
6. **Iteration:** Developer modifies code and loops back to step 2.

## 3. Functional Requirements

### 3.1 Integrated Development Environment (IDE)

* **Code Editor:** Basic text editing capabilities with syntax highlighting for C/C++.
* **Project Management:** Ability to manage standard Daisy Seed project structures (Makefiles, source directories).
* **Workspace Configuration:** Ability to save and load UI layouts, including virtual hardware setups (e.g., saving a layout that has 3 pots and 1 toggle switch).

### 3.2 Toolchain Integration

* **Compilation Engine:** The IDE must integrate with the standard Daisy Seed toolchain (typically `make` and `arm-none-eabi-gcc`).
* **Build Console:** A dedicated UI panel to display `stdout`/`stderr` from the compilation process.

### 3.3 Emulation Engine & Audio Interface

* **Execution State Management:** Controls to Start, Stop, Pause, and Reset the emulation.
* **Audio Input Simulation:** * V1: An integrated sine wave generator that feeds into the virtual audio input buffer.
* *Future:* Support for WAV file playback or live host audio input.


* **Audio Output:** Routing of the simulated output buffer to the host machine's audio API (CoreAudio, WASAPI, or ALSA) for real-time monitoring.

### 3.4 Virtual Hardware Interface

* **Controller Configuration:** A mechanism to define which Daisy Seed GPIO/ADC pins are connected to which virtual components.
* **Virtual Inputs:**
* **Potentiometers:** UI dials or sliders that output 0.0 to 1.0 floats to the respective virtual ADC pins.
* **Buttons/Switches:** UI toggles that drive virtual GPIO pins high or low.


* **Real-time Interaction:** Changing a virtual UI controller must dynamically update the hardware state being read by the emulation engine during execution.

### 3.5 Debugging

* **Debugger Integration:** Seamless integration with a debugger (e.g., `gdb` or `arm-none-eabi-gdb`).
* **Breakpoint Management:** Ability to click the editor gutter to add/remove breakpoints.
* **Execution Control:** Commands for Step Over, Step Into, Step Out, and Continue.
* **Variable Inspection:** A panel to view the current state of local variables and DSP buffers when execution is paused.

## 4. Non-Functional Requirements

* **Real-time Performance:** The emulation environment must process audio fast enough to prevent buffer underruns and audio dropouts on standard hardware.
* **Platform Compatibility:** Given typical developer setups, the application must run efficiently on modern systems (e.g., macOS ARM64/Apple Silicon, requiring efficient memory management and avoiding heavy emulation overhead).

---

### Identifying the Gaps: Architectural Decisions Needed

To move forward, we need to clarify the fundamental architecture of the "Emulator" itself, as this dictates how the entire system is built. Full Instruction Set Architecture (ISA) emulation of the Daisy's STM32H7 chip (e.g., using QEMU or Renode) is notoriously difficult to get running with low-latency audio.

Alternatively, a "Native Mocking" approach—where you compile the code for your host machine (macOS/Windows) instead of ARM, and mock the `libDaisy` hardware calls—is much easier to debug and run.

**How do you envision the core emulation layer working: are we compiling the actual ARM firmware and running it through a full hardware emulator (like QEMU), or are we compiling a native desktop executable that mocks the Daisy hardware API (libDaisy) to process the audio directly on the host OS?**