Here is a detailed `requirements.md` document based on your requested workflow. I have structured it to cover functional, non-functional, and UI requirements, followed by a critical **"Open Questions & Gaps"** section that you need to answer to finalize the technical architecture.

***

# Requirements Specification: Daisy Seed Emulator & IDE (`ds-ide`)

## 1. Introduction
The goal of this project is to create an Integrated Development Environment (`ds-ide`) coupled with a Daisy Seed emulator. This system will replace the current hardware-dependent, slow iteration loop with a fast, virtualized workflow for developing and debugging audio effects (e.g., guitar pedals) targeting the Electro-Smith Daisy Seed.

## 2. System Architecture Overview
The system consists of three main components:
1. **`ds-ide` (Frontend):** A code editor and control panel for managing the project, compiling, deploying, and debugging.
2. **Build Wrapper:** Integrates standard Daisy Seed toolchains (`gcc-arm-none-eabi`, `make`/`cmake`, `libDaisy`, `DaisySP`).
3. **Emulator Core:** A virtualized environment that executes the compiled code, simulates STM32H750 hardware peripherals (ADC, GPIO, Audio Callbacks), and provides a UI for virtual hardware interaction.

---

## 3. Functional Requirements

### 3.1. Code Editing & Project Management (Write)
* **FR-1.1:** The IDE shall provide a text editor with C/C++ syntax highlighting.
* **FR-1.2:** The IDE shall support standard Daisy Seed project structures (e.g., `Makefile` or `CMakeLists.txt`, `src/`, `Debug/`).
* **FR-1.3:** The IDE shall provide basic code navigation (go to definition, find references) for `libDaisy` and `DaisySP` headers.

### 3.2. Compilation (Compile)
* **FR-2.1:** The IDE shall integrate the standard Daisy Seed compilation toolchain.
* **FR-2.2:** The IDE shall display a "Build" button that triggers the compilation process.
* **FR-2.3:** The IDE shall capture and display compiler errors and warnings in a dedicated "Problems" or "Console" panel, with clickable links to the offending lines of code.

### 3.3. Deployment to Emulator (Deploy)
* **FR-3.1:** Instead of flashing physical hardware via USB/DFU, the "Deploy" action shall load the compiled binary (`.elf` or `.bin`) into the Emulator Core's memory space.
* **FR-3.2:** The IDE shall provide visual feedback (e.g., "Deployment Successful") upon loading the binary.

### 3.4. Execution & Virtual Hardware (Execute)
* **FR-4.1:** The IDE shall provide a "Start/Stop" control to run or halt the emulation.
* **FR-4.2 (Audio Input):** The emulator shall generate a configurable test audio signal to feed into the emulated audio input callback. 
  * *V1 Requirement:* A pure sine wave with configurable frequency (e.g., 440Hz) and amplitude.
* **FR-4.3 (Audio Output):** The emulator shall visualize the resulting audio output (e.g., a real-time oscilloscope/waveform display).
* **FR-4.4 (Virtual Controllers):** The emulator shall provide a UI to configure and interact with virtual hardware:
  * **Potentiometers:** Virtual knobs that output a normalized float (0.0 to 1.0), mapped to specific emulated ADC pins (e.g., `A0`, `A1`).
  * **Buttons:** Virtual push-buttons that toggle emulated GPIO pin states (High/Low), mapped to specific pins (e.g., `D0`, `D1`).
* **FR-4.5:** The mapping between virtual controllers and Daisy Seed pins shall be configurable by the user (e.g., via a simple JSON config file or a drag-and-drop UI).

### 3.5. Debugging (Debug)
* **FR-5.1:** The IDE shall provide a "Debug" mode, distinct from "Run" mode.
* **FR-5.2:** The user shall be able to add and remove breakpoints by clicking in the gutter of the code editor.
* **FR-5.3:** When a breakpoint is hit, the Emulator Core shall pause execution (including the audio callback loop).
* **FR-5.4:** The IDE shall provide basic debugger controls: Continue, Step Over, Step Into.
* **FR-5.5:** The IDE shall provide a "Variables" or "Watch" panel to inspect the current values of local and global variables (e.g., audio buffer contents, potentiometer readings) while paused.
* **FR-5.6:** Virtual controllers (knobs/buttons) shall remain interactive while the emulator is paused, allowing the user to change states and then "Step" through the code to observe the effect.

---

## 4. Non-Functional Requirements
* **NFR-1 (Performance):** The emulator must process the audio callback in real-time (or faster) to prevent audio buffer underruns/crackling during execution. Target sample rate: 48kHz.
* **NFR-2 (Compatibility):** The system must compile and emulate standard, unmodified `libDaisy` and `DaisySP` C++ code.
* **NFR-3 (Platform):** *(To be defined based on your preference, e.g., Windows, macOS, Linux).*
* **NFR-4 (Usability):** The transition from "Run" to "Debug" should require no code changes by the user (e.g., no need to add `#ifdef DEBUG` macros manually).

---

## 5. Open Questions & Gaps (Requires Your Input)

To move from requirements to technical design, I need you to clarify the following critical gaps:

### Gap 1: Emulation Strategy (The Biggest Technical Hurdle)
Emulating an STM32H750 microcontroller at the instruction level is extremely complex. We have two main paths. Which do you prefer?
* **Option A: High-Level Mocking (Recommended for V1).** We create a "Mock `libDaisy`". When you compile in `ds-ide`, it compiles your code against a desktop C++ version of `libDaisy` (using standard desktop audio APIs like RtAudio or PortAudio, and standard desktop GUI elements for knobs). *Pros: Much easier to build, excellent debugging support (native GDB/LLDB).* *Cons: Might not catch hardware-specific STM32 bugs.*
* **Option B: Instruction-Level Emulation.** We use something like QEMU to emulate the actual STM32H750 chip and run the actual ARM cross-compiled `.elf` file. *Pros: 100% hardware accurate.* *Cons: Extremely difficult to set up, very hard to map desktop UI knobs to emulated hardware ADC registers, debugging is slow and complex.*

### Gap 2: IDE Foundation
What technology stack should `ds-ide` be built with?
* **Option A:** A VS Code Extension (leverages existing C++ debugging, syntax highlighting, and terminal integration).
* **Option B:** A standalone desktop app (e.g., Electron, Tauri, Qt, or C# WPF).

### Gap 3: Audio Input Evolution
You mentioned a sine wave for V1. Should the architecture be designed to easily accept **real audio input** (e.g., routing your computer's microphone or audio interface guitar input into the emulator) in V2?

### Gap 4: Pin Configuration
How do you want to define which virtual knob controls which pin? 
* Example: A `config.json` file in the project root? 
* Example: A visual "patch bay" UI in the IDE where you drag a wire from "Knob 1" to "Pin A0"?

### Gap 5: Debugging Protocol
If we go with Option A (Mocking), we can use standard desktop debuggers (GDB/LLDB). If we go with Option B (QEMU), we need a GDB server. Are you comfortable configuring GDB, or do you want the IDE to handle all debugger backend setup invisibly?

---

### Next Steps
Please review the requirements and provide answers to the **Open Questions & Gaps**. Once you clarify those, I can generate a **Technical Architecture Document** and a **Step-by-Step Implementation Plan** for building V1 of this system.