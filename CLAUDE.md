# Daisy Seeds IDE  — Project Context

This is a draft of the context file, we will refine it together 

## What this is

DS-IDE is an integrated development environment for developing, testing, and debugging Daisy Seed audio effects without requiring physical Daisy Seed hardware during the development cycle.

The core idea is to replace the slow hardware-dependent workflow (compile → deploy to Daisy Seed → connect instrument → test → modify code) with a much faster software-only workflow (compile → deploy to emulator → execute → debug → modify code).

The system consists of two primary components:

1. **IDE**

    * Source code editing
    * Project management
    * Build integration using the standard Daisy Seed toolchain
    * Emulator management
    * Debugging interface

2. **Daisy Seed Emulator**

    * Executes Daisy Seed applications on a desktop computer
    * Provides emulated Daisy hardware APIs
    * Simulates audio input/output
    * Simulates physical controls such as potentiometers, buttons, and switches
    * Supports interactive testing and debugging

The emulator is intended to execute Daisy applications as native desktop programs through a compatibility layer that implements the Daisy APIs, 
rather than performing cycle-accurate STM32 hardware emulation. The goal is rapid development, easy debugging, and high developer productivity 
while preserving behavior that is relevant to audio effect development.

Runtime: Visual Studio.
Audience: developers.
Phase: not started yet.

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
| File                             | Purpose                                        | Status  |
|----------------------------------|------------------------------------------------|---------|
| docs/00_north-star.md            | Core idea, target UX, MVP definition of done   | empty   |
| docs/01_input-ideas.md           | Raw collected information                      | empty   |
| docs/02_assumptions-and-risks.md | What we're betting on, where we could be wrong | empty   |
| docs/03_requirements.md          | Clear, coherent, complete requirements         | empty   |
| docs/04_architecture.md          | Tech decisions, system design, API contracts   | empty   |
| docs/05_dev-plan.md              | Sprint plan, tasks, DoD                        | empty   |

## Interaction model
Claude drives. The user responds.
- Ask focused questions to extract information
- After each answer, update the relevant document silently, then continue
- Periodically summarize what has been captured and what remains open
- Never present a full document draft unprompted — build it incrementally