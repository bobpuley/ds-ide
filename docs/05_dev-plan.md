# 05 — Development Plan (v4)

> **v1 complete** — M0–M7 released (0.1.0–0.1.7), all ACs green.
> Archived: [`docs/v1/`](v1/).
>
> **v2 complete** — M8–M15 released (0.2.0–0.2.9), all ACs green.
> Archived: [`docs/v2/`](v2/).
>
> **v3 complete** — M16–M18 released (0.3.0–0.3.3), all ACs green.
> Archived: [`docs/v3/`](v3/).

Sprint/milestone plan for **ds-ide v4**. Built on
[03_requirements.md](03_requirements.md) and [04_architecture.md](04_architecture.md).
Each milestone is a demonstrable vertical slice closing ≥ 1 AC.

Sprint-close protocol (unchanged): automated tests pass → human test feedback → merge →
inspect tags → propose semver → update CHANGELOG.md → annotated tag → push.

---

## 0. Milestone Registry

### v1 (0.1.0–0.1.7) — archived in [`docs/v1/`](v1/)

M0 Foundations · M1 Headless runtime · M2 Extension run loop + scope · M3 Controllers (pots) ·
M4 Diagnostics · M5 Debug (breakpoints) · M6 v1 polish · M7 Block-form callback.
Full registry in [`docs/v1/05_dev-plan.md`](v1/05_dev-plan.md).

### v2 (0.2.0–0.2.9) — archived in [`docs/v2/`](v2/)

M8 Real-time audio I/O · M9 WAV file input · M10 Virtual buttons/GPIO/LEDs · M10b Visual
controller editor · M11 Full debug · M12 Hardware build & flash · M13 Spectrum & FFT ·
M14 Session recording · M15 Scope UI refresh.
Full registry in [`docs/v2/05_dev-plan.md`](v2/05_dev-plan.md).

### v3 (0.3.0–0.3.3) — archived in `docs/v3/`

| Milestone                               | File                                                | Version   | Status          |
|-----------------------------------------|-----------------------------------------------------|-----------|-----------------|
| M16 — v3 polish & bug fixes             | [docs/milestones/v3/M16.md](milestones/v3/M16.md)   | 0.3.0     | **released**    |
| M16b — Speaker output in simulated mode | [docs/milestones/v3/M16b.md](milestones/v3/M16b.md) | 0.3.1     | **released**    |
| M17 — Controls Editor v3 (two-mode)     | [docs/milestones/v3/M17.md](milestones/v3/M17.md)   | 0.3.2     | **released**    |
| M18 — Wiring Editor                     | [docs/milestones/v3/M18.md](milestones/v3/M18.md)   | 0.3.3     | **released**    |

### v4 (0.4.x) — active planning

| Milestone                                    | File                                               | Version  | Status          |
|----------------------------------------------|----------------------------------------------------|----------|-----------------|
| M19 — UX polish & command improvements       | [docs/milestones/v4/M19.md](milestones/v4/M19.md)  | 0.4.0    | **released**    |
| M20 — Controls Editor single-mode handle UX  | [docs/milestones/v4/M20.md](milestones/v4/M20.md)  | 0.4.1    | **released**    |
| M21 — VS Code Run command integration        | [docs/milestones/v4/M21.md](milestones/v4/M21.md)  | 0.4.2    | **released**    |
| M22 — Secondary sidebar panels               | [docs/milestones/v4/M22.md](milestones/v4/M22.md)  | 0.4.3    | **planned**     |

### v5 (0.5.x) — planning

| Milestone                                    | File                                               | Version  | Status          |
|----------------------------------------------|----------------------------------------------------|----------|-----------------|
| M23 — Effect Project Wizard                  | [docs/milestones/v5/M23.md](milestones/v5/M23.md)  | 0.5.0    | **planned**     |
| M24 — Init block code generation             | [docs/milestones/v5/M24.md](milestones/v5/M24.md)  | 0.5.1    | **planned**     |

---

## 1. Approach

Same walking-skeleton-first principle as v1/v2/v3:
- M19 is purely additive UX fixes and new commands — zero architecture risk.
- M20 replaces the D18 two-mode panel with D19 (single-mode handle UX); C2-only change, no new components.
- M21 adds `DebugConfigurationProvider` (C1-only, additive) — no IPC or emulator changes.
- M22 extracts Controls Editor from C2 into C11 and converts Wiring Editor to `WebviewView` —
  structural C1/C2 change; must preserve Scope and Spectrum.
- M23 adds the effect project wizard (C1-only, new command + template strings) — no architecture change.
- M24 extends C9 parser and controls-writer for init block generation — requires A21 validation before T24-3.

---

## 2. Dependency graph

```
v2 (0.2.9) ──► M16 polish ──► M17 Controls v3 ──► M18 Wiring Editor ──► M19 UX polish ──► M20 CE handle UX
               (CSS/JS)        (C9 + two-mode)      (C10, C++ writer)     (commands,          (D19, knob
                                                                            scope, WE SVG)       visuals)
                                                                                                     │
                                                                                          ┌──────────┘
                                                                                          ▼
                                                                                    M21 Run cmds ──► M22 Sidebar panels
                                                                                    (DebugProvider)   (C11, C2 split)
```

**v4 critical path:** M21 has no blockers (additive, C1 only). M22 depends on M21 being
complete (to avoid rebasing C1 structural changes). M22 T22-1 (Controls Editor extraction)
must land before T22-2 (Wiring Editor conversion) to reduce merge risk.

**v5 critical path:** M23 (wizard) has no blockers — C1-only, additive. M24 (init block)
depends on M22 being shipped (Wiring Editor must be stable in C11 before extending its write
behavior). M24 T24-3 should verify ADC grouping assumption (A21) before writing init code.

---

## 3. AC coverage map

| AC        | Closed in   | Description                                                                                       |
|-----------|-------------|---------------------------------------------------------------------------------------------------|
| ~~AC-18~~ | ~~M17~~     | *Retired — superseded by AC-24 (D18 → D19)*                                                       |
| AC-22     | M17         | Controls Editor fallback: no convention block → diagnostic banner + yaml-only mode                |
| AC-19     | M18         | Wiring Editor: click pin → add device → C++ declaration written                                   |
| AC-23     | M18         | Wiring Editor: click assigned pin → Remove → pin unassigned; annotation deleted                   |
| AC-20     | M16         | Spectrum labels: no overlap at default size                                                       |
| AC-21     | M16         | Scope panel border visible, no content clipping                                                   |
| AC-24     | M20         | Controls Editor: handle drag rearranges (always); body interaction gated on emulator state        |
| AC-25     | M20         | Controls Editor: pot renders as rotary knob, L&F matches Wiring Editor                            |
| AC-26     | M19         | Build & Deploy to Emulator: sequential command; blocks deploy on build failure                    |
| AC-27     | M19         | Scope header: Start/Stop Audio toolbar buttons reflect emulator state                             |
| AC-28     | M19         | Recording buttons: "()" and "[]" labels                                                           |
| AC-29     | M19         | Wiring Editor: ID labels legible, no overlap with control icon or pin circle                      |
| AC-30     | M19         | Wiring Editor: micro USB port visible on Daisy Seed SVG                                           |
| AC-31     | M19 (T19-6) | xruns counter: visible only in header status line; removed from Emulator section body *(FR-SC-2)* |
| AC-32     | M21         | F5 Start Debugging: stop → build → deploy → attach lldb; build failure blocks deploy *(FR-CM-3)* |
| AC-33     | M21         | Ctrl+F5 Start Without Debugging: stop → build → deploy; no lldb attached *(FR-CM-4)* |
| AC-34     | M22         | Controls Editor: persistent view in right secondary sidebar; state restored on sidebar show *(FR-CE-8)* |
| AC-35     | M22         | Wiring Editor: persistent view in right secondary sidebar; `Open Wiring Editor` reveals/focuses it *(FR-WE-10)* |
| AC-36     | M23         | Effect Project Wizard: scaffolds `.cpp`/`CMakeLists.txt`/`controllers.yaml`/`README.md`; folder opens in VS Code *(FR-WZ-1)* |
| AC-37     | M24         | Init block generation: Wiring Editor writes init calls alongside declarations; remove deletes init line *(FR-CG-1)* |

---

## 4. Definition of Done (per milestone)

Per-milestone goals, tasks, and DoD live in the milestone files linked from the registry (§0).
Each milestone closes when:

1. Code + automated tests for the milestone's tasks pass.
2. The milestone's mapped AC(s) demonstrably pass (§3).
3. No regression to prior milestones' ACs (AC-1…AC-17, AC-19…AC-23).
4. Human test feedback collected (project rule 7).
5. If green: merge → inspect tags → propose semver → CHANGELOG.md → annotated tag → push.

---

## 5. Risk notes

### v3 risks (all resolved)

- **R19 (convention non-compliance):** Validated in M17 (T17-3). ✅
- **R20 (code generation style):** Documented in M18. ✅
- **Effect source discovery:** Validated in M18 (T18-4). ✅

### v4 risks

- **R21 (AC-18 retirement):** AC-18 must be explicitly retired and AC-24 written before M20 work begins. Leaving AC-18 "green" against dead code would mask a broken redesign.
- **R22 (knob visual complexity):** Prototype with CSS first; if insufficient, evaluate SVG-per-knob. Canvas renderer is last resort. (02_assumptions-and-risks §5)
- **R23 (C2 split regression):** Extracting Controls Editor from C2 may regress Scope/Spectrum rendering. M22 T22-1 must include a full regression pass of AC-20, AC-21, AC-27, AC-28, AC-31.
- **R24 (`WebviewView` lifecycle):** Context may be lost when sidebar is hidden. Mitigated by `retainContextWhenHidden: true` + re-hydration on `onDidChangeVisibility`. Test with sidebar toggling during a running emulator session.
- **R25 (ADC grouping in init block):** The `hardware.adc.Init(cfgs[], n)` aggregate call groups all pot configs. If channel order matters or multiple ADC buses are needed, init generation becomes non-trivial. Validate A21 before T24-3; design the grouping logic first.
- **M20 pot interaction model blocker:** ✅ resolved — vertical drag (2026-06-20). T20-2 is now unblocked.
