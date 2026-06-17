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

**v2 in progress** (target 0.2.x, M8+): live host audio I/O; virtual buttons/GPIO; full debug (step/variables/call-stack); in-IDE hardware build + DFU flash; spectrum view. See `docs/01_input-ideas.md`–`docs/05_dev-plan.md`.

Runtime: VS Code (Visual Studio Code). Primary OS: macOS / Apple Silicon.
Audience: developers.
Phase: v1 complete; v2 requirements + architecture drafted (docs 01–05), implementation not yet started (M8 pending).

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
`docs/v1/` and `docs/raw/v1/` are read-only archives. All current project knowledge should be in `docs/00_`–`docs/05_`.

- **Do not read archived docs** unless the root docs genuinely lack the information needed.
- **If you do read an archived doc**, append an entry to `docs/archived-doc-access-log.md` immediately: date, what was needed, which file was consulted, which root doc should have had it, status = open.
- **At the start of every new session**, check `docs/archived-doc-access-log.md` for open entries before doing anything else. For each open entry: if it was exceptional (the root docs are fine), mark resolved: exceptional. If info was missing, backport it to the correct root doc and mark resolved: backported to \<file\>.

## Document map
| File                             | Purpose                                        | Status                                         |
|----------------------------------|------------------------------------------------|------------------------------------------------|
| docs/00_north-star.md            | Core idea, target UX, MVP definition of done   | drafted (v1 basis; still valid for v2)         |
| docs/01_input-ideas.md           | v2 feature ideas (deferred from v1 + new)      | v2 draft; 4 open conflicts                     |
| docs/02_assumptions-and-risks.md | v2 bets and risks; v1 bets confirmed           | v2 draft; A9–A14 new; R12–R18 new             |
| docs/03_requirements.md          | v2 requirements (FR/NFR/CR/AC)                 | v2 draft; 5 open items                         |
| docs/04_architecture.md          | v2 tech decisions, component extensions        | v2 draft; host audio API TBD                   |
| docs/05_dev-plan.md              | v2 sprint plan M8–M14                          | v2 draft; M8 highest priority                  |
| docs/v1/                         | v1 archived docs (01–05, read-only)            | complete; do not edit                          |
| docs/raw/v1/                     | v1 raw contributions (read-only)               | complete; do not edit                          |

## Interaction model
Claude drives. The user responds.
- Ask focused questions to extract information
- After each answer, update the relevant document silently, then continue
- Periodically summarize what has been captured and what remains open
- Never present a full document draft unprompted — build it incrementally