# Daisy Seed IDE (ds-ide) — Project Context

## What this is

DS-IDE is an integrated development environment for developing, testing, and debugging Daisy Seed audio effects without requiring physical Daisy Seed hardware during the development cycle.

The core idea is to replace the slow hardware-dependent workflow (compile → deploy to Daisy Seed → connect instrument → test → modify code) with a much faster software-only workflow (compile → deploy to emulator → execute → debug → modify code).

The system consists of two primary components:

1. **IDE** — delivered as a **VS Code extension**

    * Source code editing & project management
    * Host build integration (CMake), kept separate from the project's hardware `Makefile`
    * Emulator lifecycle management
    * Debugging interface (lldb via DAP)

2. **Daisy Seed Emulator** — a **separate native process** the extension drives over IPC

    * Executes Daisy Seed applications as native desktop programs
    * Provides a host **libDaisy compatibility layer** (audio, ADC, system) — not emulated STM32 hardware
    * Simulates audio I/O: internal sine generator in, live input/output scope out (no host speaker in v1)
    * Simulates physical controls — **potentiometers in v1** (buttons/switches deferred to v2)
    * Supports interactive testing and breakpoint debugging

The emulator executes Daisy applications as native desktop programs through a compatibility layer that implements the Daisy APIs, rather than performing cycle-accurate STM32 hardware emulation. The goal is rapid development, easy debugging, and high developer productivity while preserving behavior that is relevant to audio-effect development.

**Locked v1 scope** (see `docs/03_requirements.md` + `docs/04_architecture.md`): native simulation via the compatibility layer (not STM32 emulation); VS Code extension + out-of-process native emulator; bare libDaisy/DaisySP compiled unchanged; macOS-first / Apple Silicon; emulator-only (no in-IDE hardware flashing); pots-only controllers; visualization-only audio; breakpoint debugging. The bundled `daisy-seed-knowledge/` corpus (libDaisy docs + official examples) is the API reference and v1 test corpus; it is also indexed as a graphify knowledge graph — query it with `/graphify query "…"` (see `graphify-out/`).

Runtime: VS Code (Visual Studio Code — the cross-platform editor, not the full Visual Studio IDE). Primary OS: macOS / Apple Silicon.
Audience: developers.
Phase: planning & design complete — docs 00–05 drafted, v1 scope + architecture locked. Implementation not yet started (M0 pending).

## Working rules
1. Never make implicit assumptions — ask when something is ambiguous or incomplete
2. One question at a time — never bundle more than 2 questions in a single turn
3. Simplicity first, complexity only when strictly justified
4. These are living documents — update earlier docs when later ones reveal conflicts
5. Mark uncertain content with `> ⚠️ ASSUMPTION:` blockquotes
6. When a document is updated, state explicitly what changed and why
7. Sprint-close protocol: after all sprint tasks pass automated tests, collect human-driven test feedback before merging. 
   If green: merge → inspect existing tags → propose next semver tag → update CHANGELOG.md + commit → create annotated tag → push commit and tag.

## Document map
| File                             | Purpose                                        | Status                              |
|----------------------------------|------------------------------------------------|-------------------------------------|
| docs/00_north-star.md            | Core idea, target UX, MVP definition of done   | drafted                             |
| docs/01_input-ideas.md           | Raw collected information                      | drafted; 9 conflicts resolved       |
| docs/02_assumptions-and-risks.md | What we're betting on, where we could be wrong | drafted; A1–A3 verified vs source   |
| docs/03_requirements.md          | Clear, coherent, complete requirements         | drafted; v1 scope locked            |
| docs/04_architecture.md          | Tech decisions, system design, API contracts   | drafted; process model + components |
| docs/05_dev-plan.md              | Sprint plan, tasks, DoD                        | drafted; M0–M6                      |

## Interaction model
Claude drives. The user responds.
- Ask focused questions to extract information
- After each answer, update the relevant document silently, then continue
- Periodically summarize what has been captured and what remains open
- Never present a full document draft unprompted — build it incrementally