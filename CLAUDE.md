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
    * Simulates audio I/O: v1 = sine-generator in, scope out; v2 adds live host audio input + speaker output
    * Simulates physical controls — potentiometers (v1, shipped); buttons/GPIO (v2, planned)
    * Supports interactive testing and breakpoint debugging; v2 adds full stepping/variables

The emulator executes Daisy applications as native desktop programs through a compatibility layer that implements the Daisy APIs, rather than performing cycle-accurate STM32 hardware emulation. The goal is rapid development, easy debugging, and high developer productivity while preserving behavior that is relevant to audio-effect development.

**v1 shipped** (0.1.0–0.1.7, M0–M7, all ACs green): native simulation; VS Code extension; CMake emulator build; sine-input audio engine; virtual potentiometers; waveform scope; breakpoint debugging. Archived docs: `docs/v1/`. The bundled `daisy-seed-knowledge/` corpus is the API reference; indexed as a graphify knowledge graph — query with `/graphify query "…"` (see `graphify-out/`).

**v2 shipped** (0.2.0–0.2.9, M8–M15, all ACs green): live host audio I/O; WAV file input; virtual buttons/GPIO/LEDs; visual controller editor; full debug (step/variables/call-stack); in-IDE hardware build + DFU flash; spectrum/FFT view; session recording; scope UI refresh. Archived docs: `docs/v2/`.

**v3 shipped** (0.3.0–0.3.3, M16–M18, all ACs green): Controls Editor v3 (two-mode, code inference); Wiring Editor (SVG pinout, C++ gen); spectrum/scope polish. Archived docs: `docs/v3/`.

**v4 shipped** (0.4.0–0.4.3, M19–M22, all ACs green): Controls Editor single-mode handle UX; Wiring Editor polish; command cleanup; VS Code Run integration (F5/Ctrl+F5); secondary sidebar panels. Archived docs: `docs/v4/`.

**v5 shipped** (0.5.0–0.5.1, M23–M24, all ACs green): Effect Project Wizard; init block code generation. Archived docs: `docs/v5/`.

**v6 planning**: see `docs/01_input-ideas.md`–`docs/05_dev-plan.md`.

Runtime: VS Code (Visual Studio Code). Primary OS: macOS / Apple Silicon.
Audience: developers.
Phase: v1–v5 complete; v6 planning (docs 01–05 are now v6 seeds).

## Daisy API knowledge — query graphify first
The `daisy-seed-knowledge/` corpus (libDaisy docs + DaisyExamples) is indexed as a knowledge graph in `graphify-out/`. **Before answering any question about Daisy/libDaisy APIs, hardware behavior, or example patterns — and before reading raw files under `daisy-seed-knowledge/` — run `graphify query "<question>"` (Bash) first.** It returns a budgeted answer and does not load the graph into context.

- **Use it when:** you need libDaisy API semantics (audio callback, ADC/`AdcChannelConfig`, GPIO, SAI/SPI, `System`), how an official example does something, or which header/class to use.
- **Don't use it for:** this project's own source under `src/` (read those files directly — they are NOT in the graph), or general C++/CMake/VS Code questions.
- Refresh after the corpus changes: `graphify ./daisy-seed-knowledge/ --update`.

## Working rules
1. Never make implicit assumptions — ask when something is ambiguous or incomplete
2. One question at a time — never bundle more than 2 questions in a single turn
3. Simplicity first, complexity only when strictly justified
4. These are living documents — update earlier docs when later ones reveal conflicts
5. Mark uncertain content with `> ⚠️ ASSUMPTION:` blockquotes
6. When a document is updated, state explicitly what changed and why
7. Sprint-close protocol: after all sprint tasks pass automated tests, collect human-driven test feedback before merging. 
   If green: merge → inspect existing tags → propose next semver tag → update CHANGELOG.md + commit → create annotated tag → push commit and tag.

## Archived docs protocol
`docs/v1/`, `docs/v2/`, `docs/v3/`, `docs/v4/`, `docs/v5/` and `docs/raw/v1/` are read-only archives. All current project knowledge should be in `docs/00_`–`docs/05_`.

- **Do not read archived docs** unless the root docs genuinely lack the information needed.
- **If you do read an archived doc**, append an entry to `docs/archived-doc-access-log.md` immediately: date, what was needed, which file was consulted, which root doc should have had it, status = open.
- **At the start of every new session**, check `docs/archived-doc-access-log.md` for open entries before doing anything else. For each open entry: if it was exceptional (the root docs are fine), mark resolved: exceptional. If info was missing, backport it to the correct root doc and mark resolved: backported to \<file\>.

## Document map
| File                             | Purpose                                        | Status                                         |
|----------------------------------|------------------------------------------------|------------------------------------------------|
| docs/00_north-star.md            | Core idea, target UX, MVP definition of done   | drafted (v1 basis; still valid for v6)         |
| docs/01_input-ideas.md           | v6 planning seed                               | v6 seed; not yet started                       |
| docs/02_assumptions-and-risks.md | v6 bets and risks                              | v6 seed; not yet started                       |
| docs/03_requirements.md          | v6 requirements                                | v6 seed; not yet started                       |
| docs/04_architecture.md          | v6 architecture                                | v6 seed; not yet started                       |
| docs/05_dev-plan.md              | v6 sprint plan                                 | v6 seed; no milestones yet                     |
| docs/milestones/v6/              | v6 milestone files (none yet)                  | placeholder                                    |
| docs/v1/                         | v1 archived docs (01–05, read-only)            | complete; do not edit                          |
| docs/v2/                         | v2 archived docs (01–05, read-only)            | complete; do not edit                          |
| docs/v3/                         | v3 archived docs (01–05, read-only)            | complete; do not edit                          |
| docs/v4/                         | v4 archived docs (01–05, read-only)            | complete; do not edit                          |
| docs/v5/                         | v5 archived docs (01–05, read-only)            | complete; do not edit                          |
| docs/raw/v1/                     | v1 raw contributions (read-only)               | complete; do not edit                          |

## Interaction model
Claude drives. The user responds.
- Ask focused questions to extract information
- After each answer, update the relevant document silently, then continue
- Periodically summarize what has been captured and what remains open
- Never present a full document draft unprompted — build it incrementally