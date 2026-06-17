# 05 — Development Plan

Sprint/milestone plan for **ds-ide v1**, built on the requirements
([03](03_requirements.md)) and architecture ([04](04_architecture.md)). Each milestone is a
**demonstrable vertical slice** and closes against specific acceptance criteria (AC-1…AC-7 for v1.0,
AC-8 for the v1.1 fast-follow; 03 §8). Components are C1…C6 (04 §2).

---

## 0. Milestone Registry

| Milestone                       | File                                      | Status               |
|---------------------------------|-------------------------------------------|----------------------|
| M0 — Foundations                | [docs/milestones/M0.md](milestones/M0.md) | **released** (0.1.0) |
| M1 — Headless emulator runtime  | [docs/milestones/M1.md](milestones/M1.md) | **released** (0.1.1) |
| M2 — Extension run loop + scope | [docs/milestones/M2.md](milestones/M2.md) | planned              |
| M3 — Controllers (pots)         | [docs/milestones/M3.md](milestones/M3.md) | planned              |
| M4 — Diagnostics & robustness   | [docs/milestones/M4.md](milestones/M4.md) | planned              |
| M5 — Debug (breakpoints)        | [docs/milestones/M5.md](milestones/M5.md) | planned              |
| M6 — v1 polish & release        | [docs/milestones/M6.md](milestones/M6.md) | planned              |
| M7 — Block-form callback (v1.1) | [docs/milestones/M7.md](milestones/M7.md) | planned              |

---

## 1. Approach

- **Walking skeleton first, then thicken.** Get a trivial effect running headless end-to-end
  (build → run → scope data) before adding UI, controllers, and debug.
- **Each milestone ships something runnable** and maps to ≥1 AC, so progress is verifiable.
- **Sprint-close protocol (per project rules):** when a milestone's automated tests pass → collect
  human test feedback → if green, merge → inspect tags → propose next semver → update CHANGELOG.md
  → annotated tag → push. Work happens on a branch per milestone, not on `main`.

---

## 2. Dependency graph & critical path

```
M0 scaffold + shim headers ──┐
                             ▼
             C3 CMake build ─┴─► C5 shim ─► C4 runtime ─► (M1 headless)
                                                 │
                               C1 extension ◄────┘
                                     │
                      ┌──────────────┼───────────────┐
                      ▼              ▼                ▼
             C2 scope (M2)   C2 controllers (M3)   C6 debug (M5)
```

**Critical path:** C3 → C5 → C4 (the runtime is nothing without the shim and a build). C1/C2/C6
layer on top. **No effect porting needed** (R9 downgraded): the official
`daisy-seed-knowledge/examples` (`bypass`, `inout`, `Knob`, `Osc`) are already bare-libDaisy +
pots-only and serve as the v1 test corpus.

---

## 3. AC coverage map

| AC                     | Closed in  | AC                              | Closed in  |
|------------------------|------------|---------------------------------|------------|
| AC-1 build/deploy/run  | M2         | AC-5 NaN/clip flagged           | M4         |
| AC-2 pot → output      | M3         | AC-6 hardware build intact      | M4         |
| AC-4 breakpoint/freeze | M5         | AC-7 <30 s loop                 | M4         |
| AC-8 block-form (v1.1) | M7         | *(AC-3 removed — pots-only v1)* | —          |

---

## 4. Definition of Done (per milestone)

1. Code + automated tests for the milestone's tasks pass.
2. The milestone's mapped AC(s) demonstrably pass.
3. No regression to prior milestones' ACs.
4. Human test feedback collected (project rule 7).
5. If green: merge → inspect tags → propose semver → CHANGELOG.md → annotated tag → push.

---

## 5. Risk-driven sequencing notes

- **R9 (porting)** removed from the critical path — official examples are the v1 corpus, so no port
  blocks M0–M5. **R11 (callback shape)** — the shim declares both `StartAudio` overloads from M0, but
  they ship **phased** (04 §4.1): interleaving validated in **M1** (`bypass`, `Osc`); the
  non-interleaving/block overload + marshalling validated in **M7/v1.1** (`inout`). The 44/28 split
  across the bundled examples means interleaved-first unblocks the larger set for the least effort.
- **R5 (freeze-time/debug)** isolated to M5; the architecture makes it nearly free (04 §6), but it's
  scheduled late so a surprise there can't block the core loop (M1–M4).
- **R1/R4 (fidelity)** never "solved" — surfaced as the NFR-7 caveat (M4 T4.5).
- **Soft-pacing assumption (04 §10)** validated early in M1 (`Osc` pitch / a tremolo-style LFO must
  look natural on the scope).

---

## 6. Open items rolled forward

| From    | Item                                                                     | Resolve by                                                     |
|---------|--------------------------------------------------------------------------|----------------------------------------------------------------|
| 04 §10  | Soft-pace vs free-run; socket type; lldb packaging                       | Implementation-time (M1/M5)                                    |
| 04 §4.1 | Non-interleaved/block callback overload; one-canonical-buffer assumption | Scheduled at **M7/v1.1**; confirm buffer-view assumption there |
| 02 §4   | Live host audio input (v2 priority)                                      | Post-v1 roadmap                                                |
