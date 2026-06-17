This is a strong idea because it shortens the feedback loop dramatically. 
The biggest value is not actually "emulating the Daisy Seed CPU"—it's providing a desktop environment where Daisy effects can be 
compiled, run, inspected, and interacted with exactly as if they were deployed to hardware.

Before writing the final requirements, I see a few important gaps that will significantly affect the architecture. 
I'll provide a detailed draft requirements document and then list the questions that need answers.

---

# requirements.md

## 1. Project Overview

### 1.1 Purpose

Develop **DS-IDE**, an integrated development environment for Daisy Seed effect development that provides:

* Source code editing
* Compilation using the official Daisy toolchain
* Deployment to a desktop Daisy Seed emulator
* Execution of Daisy Seed effects without physical hardware
* Interactive control simulation (pots, buttons, switches, etc.)
* Basic debugging capabilities

The goal is to reduce the development cycle from:

```text
Edit
↓
Compile
↓
Deploy to hardware
↓
Test on instrument
↓
Reason about problems
↓
Repeat
```

to:

```text
Edit
↓
Compile
↓
Deploy to emulator
↓
Execute
↓
Debug
↓
Fix
↓
Repeat
```

---

# 2. Scope

## Included

### IDE

* Project creation
* Project loading
* Code editing
* Build integration
* Emulator integration
* Debug integration

### Emulator

* Daisy Seed runtime emulation
* Audio input/output
* Virtual controls
* State inspection

### Debugger

* Breakpoints
* Pause/Resume
* Variable inspection
* Step execution

---

## Excluded (Phase 1)

* Exact STM32 hardware emulation
* Cycle-accurate CPU emulation
* DSP performance profiling
* MIDI emulation
* CV/Gate emulation
* Multi-board support
* Daisy Patch support
* Daisy Petal support

Phase 1 targets Daisy Seed only.

---

# 3. High-Level Architecture

```text
+----------------+
|     DS-IDE     |
+--------+-------+
         |
         +------------------+
         |                  |
         v                  v

+---------------+   +---------------+
| Build System  |   |   Emulator    |
+---------------+   +---------------+
                           |
                           v

                 +------------------+
                 | Virtual Hardware |
                 +------------------+
```

---

# 4. Functional Requirements

# 4.1 Project Management

### FR-PM-001

User shall create a new Daisy Seed project.

### FR-PM-002

User shall open an existing Daisy Seed project.

### FR-PM-003

User shall save project files.

### FR-PM-004

User shall maintain project settings.

---

# 4.2 Code Editing

### FR-ED-001

Provide source editor.

### FR-ED-002

Provide syntax highlighting for:

* C
* C++

### FR-ED-003

Provide code completion.

### FR-ED-004

Provide error highlighting.

### FR-ED-005

Provide build output panel.

---

# 4.3 Build System

### FR-BL-001

Use official Daisy build tools.

### FR-BL-002

Support command line build execution.

### FR-BL-003

Display compiler output.

### FR-BL-004

Display warnings and errors.

### FR-BL-005

Allow one-click build.

---

# 4.4 Deployment

### FR-DP-001

Deploy compiled binary to emulator.

### FR-DP-002

Reload emulator automatically after successful build.

### FR-DP-003

Display deployment status.

---

# 5. Emulator Requirements

## 5.1 Objective

Execute Daisy effect code on desktop without physical hardware.

---

## 5.2 Emulation Model

Phase 1 shall emulate:

### Audio

* Audio input
* Audio output

### Controls

* Potentiometers
* Buttons
* Toggle switches

### Timing

* Audio callback timing
* System timing APIs

### GPIO abstraction

Only APIs used by libDaisy.

---

## 5.3 Non-Goals

Phase 1 shall NOT emulate:

* STM32 instruction set
* Registers
* DMA
* Interrupt controllers

Instead, application code shall be compiled for desktop execution.

---

# 6. Audio System

## 6.1 Input Sources

### FR-AU-001

User shall select audio input source.

Supported sources:

* Sine wave generator
* WAV file
* Microphone

---

### FR-AU-002

Sine generator shall support:

* Frequency
* Amplitude

---

### FR-AU-003

WAV playback shall support:

* Mono
* Stereo

---

## 6.2 Output

### FR-AU-004

Audio output shall play through host audio device.

### FR-AU-005

Output level meter shall be displayed.

---

# 7. Virtual Controls

## 7.1 Potentiometers

### FR-VC-001

User shall create virtual potentiometers.

### FR-VC-002

Each potentiometer shall support:

* Name
* Min value
* Max value
* Current value

### FR-VC-003

Pot value changes shall be reflected immediately.

---

## 7.2 Buttons

### FR-VC-004

User shall create virtual buttons.

### FR-VC-005

Buttons shall support:

* Press
* Release
* Toggle

---

## 7.3 Layout

### FR-VC-006

Controls shall be displayed in a dedicated panel.

### FR-VC-007

Layout shall be persisted.

---

# 8. Daisy API Mapping

## 8.1 Adc

Virtual ADC channels shall map to potentiometers.

```cpp
hw.adc.GetFloat(...)
```

shall read virtual control values.

---

## 8.2 Switches

```cpp
switch.Debounce()
switch.Pressed()
```

shall operate on virtual buttons.

---

## 8.3 Audio

```cpp
AudioCallback(...)
```

shall execute using desktop audio buffers.

---

## 8.4 System

Provide desktop implementations of:

* Delay
* Timing APIs
* Logging

---

# 9. Execution

## 9.1 Run

### FR-EX-001

Start emulator.

### FR-EX-002

Stop emulator.

### FR-EX-003

Restart emulator.

---

## 9.2 Runtime Status

Display:

* Sample rate
* Buffer size
* CPU load estimate

---

# 10. Debugging

## 10.1 Breakpoints

### FR-DB-001

User shall add breakpoints.

### FR-DB-002

User shall remove breakpoints.

### FR-DB-003

Execution shall stop at breakpoint.

---

## 10.2 Control

### FR-DB-004

Resume execution.

### FR-DB-005

Pause execution.

### FR-DB-006

Step over.

### FR-DB-007

Step into.

### FR-DB-008

Step out.

---

## 10.3 Inspection

### FR-DB-009

Display local variables.

### FR-DB-010

Display global variables.

### FR-DB-011

Display call stack.

---

# 11. Emulator Control Configuration

## 11.1 Automatic Mapping

System shall support configuration file:

```json
{
  "controls": [
    {
      "type": "pot",
      "name": "Drive",
      "adc": 0
    },
    {
      "type": "pot",
      "name": "Tone",
      "adc": 1
    },
    {
      "type": "button",
      "name": "Bypass",
      "pin": "D1"
    }
  ]
}
```

---

## 11.2 Runtime Reconfiguration

Controls may be added or removed without rebuilding.

---

# 12. User Interface

## Main Layout

```text
+--------------------------------------------------+
| Menu                                              |
+--------------------------------------------------+

+------------+----------------------+-------------+
| Explorer   | Editor               | Controls    |
|            |                      |             |
| project    | effect.cpp           | Drive Pot   |
| files      |                      | Tone Pot    |
|            |                      | Bypass Btn  |
+------------+----------------------+-------------+

+--------------------------------------------------+
| Build / Debug Console                            |
+--------------------------------------------------+

+--------------------------------------------------+
| Audio Monitor                                    |
+--------------------------------------------------+
```

---

# 13. Persistence

Store:

* Breakpoints
* Window layout
* Control layout
* Emulator settings
* Build settings

---

# 14. Performance Requirements

### PR-001

Build launch < 2 seconds overhead.

### PR-002

Emulator startup < 1 second.

### PR-003

Control latency < 20ms.

### PR-004

Audio underruns shall be reported.

---

# 15. Error Handling

### ER-001

Build failures shall not crash IDE.

### ER-002

Emulator crashes shall be isolated.

### ER-003

Runtime exceptions shall be reported.

---

# 16. Future Enhancements

### Phase 2

* Real guitar input
* MIDI support
* Oscilloscope
* Spectrum analyzer
* Parameter automation
* Session recording

### Phase 3

* Daisy Patch support
* Daisy Petal support
* Hardware-in-the-loop testing
* Remote debugging on real Daisy hardware

---

# Critical Open Questions

These need answers before the architecture can be finalized.

### Q1. What exactly should "emulator" mean?

Option A (recommended)

Compile Daisy code for desktop.

```text
Daisy APIs
       ↓
Desktop implementations
       ↓
Native executable
```

Pros:

* Much simpler
* Fast
* Easy debugging
* Breakpoints work naturally

Option B

Emulate STM32 and run ARM binary.

Pros:

* More accurate

Cons:

* 10x–50x more work
* Harder debugging
* Much slower

I strongly recommend Option A.

---

### Q2. Must existing Daisy projects run unmodified?

Example:

```cpp
#include "daisy_seed.h"
#include "daisysp.h"
```

Should this compile in the emulator without any code changes?

My recommendation: **yes**.

---

### Q3. How should controls be discovered?

Options:

1. Manual JSON config
2. Visual designer
3. Parse source code automatically
4. Combination

I recommend:

```text
Phase 1 → JSON
Phase 2 → Visual designer
Phase 3 → Auto-discovery
```

---

### Q4. Which debugger is expected?

Option A

Standard C++ debugger (gdb/lldb)

* breakpoints
* watch variables
* stepping

Option B

Audio-aware debugger

* breakpoints
* signal inspection
* waveform snapshots

I recommend A first.

---

### Q5. Should the emulator support live audio from the guitar in Phase 1?

You mentioned starting with a sine generator.

Should microphone/audio-interface input be:

* Phase 1
* Phase 2

My recommendation: Phase 2, after the core emulator is stable.

---

### Q6. What technology stack do you want for DS-IDE?

Examples:

* Electron + Monaco + C++ backend
* VSCode extension
* Qt/C++
* JetBrains plugin

This decision affects 30–40% of the architecture. 
My recommendation would likely be **VSCode extension + native emulator runtime**, because it gives you editing, debugging, and project management 
almost for free while you focus on the emulator.
