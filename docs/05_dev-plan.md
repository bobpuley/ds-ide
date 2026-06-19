# 05 — Development Plan (v3)

> **v1 complete** — M0–M7 released (0.1.0–0.1.7), all ACs green.
> Archived: [`docs/v1/`](v1/).
>
> **v2 complete** — M8–M15 released (0.2.0–0.2.9), all ACs green.
> Archived: [`docs/v2/`](v2/).

Sprint/milestone plan for **ds-ide v3**. Built on
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

### v3 (0.3.x) — active planning

| Milestone                           | File                                              | Version  | Status           |
|-------------------------------------|---------------------------------------------------|----------|------------------|
| M16 — v3 polish & bug fixes         | [docs/milestones/v3/M16.md](milestones/v3/M16.md) | 0.3.0    | **in progress**  |
| M17 — Controls Editor v3 (two-mode) | [docs/milestones/v3/M17.md](milestones/v3/M17.md) | 0.3.1    | **planned**      |
| M18 — Wiring Editor                 | [docs/milestones/v3/M18.md](milestones/v3/M18.md) | 0.3.2    | **planned**      |

---

## 1. Approach

Same walking-skeleton-first principle as v1/v2:
- M16 is purely additive UI fixes — zero risk, validates the codebase is healthy post-v2.
- M17 introduces C9 (convention parser), the shared foundation that M18 depends on.
- M18 builds C10 (Wiring Editor) on top of C9.

---

## 2. Dependency graph

```
v2 (0.2.9, stable) ──► M16 bugs & polish ──► M17 Controls Editor v3 ──► M18 Wiring Editor
                         (C2 CSS/JS only)        (C9 convention parser        (C10 panel,
                                                  + C2 two-mode panel)         C++ writer)
```

**Critical path:** C9 (T17-1). Both M17 and M18 depend on it; M18 additionally depends on
the `controlsConfig` message contract being stable from M17.

---

## 3. AC coverage map

| AC | Closed in | Description |
|----|-----------|-------------|
| AC-18 | M17 | Controls Editor: code convention → two-mode interactive panel |
| AC-22 | M17 | Controls Editor fallback: no convention block → diagnostic banner + yaml-only mode |
| AC-19 | M18 | Wiring Editor: click pin → add device → C++ declaration written |
| AC-23 | M18 | Wiring Editor: click assigned pin → Remove → pin unassigned; annotation deleted |
| AC-20 | M16 | Spectrum labels: no overlap at default size |
| AC-21 | M16 | Scope panel border visible, no content clipping |

---

## 4. Definition of Done (per milestone)

Per-milestone goals, tasks, and DoD live in the milestone files linked from the registry (§0).
Each milestone closes when:

1. Code + automated tests for the milestone's tasks pass.
2. The milestone's mapped AC(s) demonstrably pass (§3).
3. No regression to prior milestones' ACs (AC-1…AC-17).
4. Human test feedback collected (project rule 7).
5. If green: merge → inspect tags → propose semver → CHANGELOG.md → annotated tag → push.

---

## 5. Risk notes

- **R19 (convention non-compliance):** M17 must validate the fallback path (missingBlock = true)
  as part of T17-3 — the Controls Editor must behave correctly when no convention block is present.
- **R20 (code generation style):** M18 must document the generated type names in the extension
  README/wiki alongside the implementation.
- **Effect source discovery:** M18 T18-4 must validate the auto-detection heuristic against at
  least two real project structures before shipping.
