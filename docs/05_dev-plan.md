# 05 — Development Plan (v2)

> **v1 complete.** M0–M7 shipped as ds-ide 0.1.0–0.1.7. All ACs (AC-1…AC-8) green.
> v1 milestone files are in `docs/milestones/v1/M0.md`…`M7.md` (read-only history).
> Archived plan: `docs/v1/05_dev-plan.md`.

Sprint/milestone plan for **ds-ide v2** (target: 0.2.x). Built on
[03_requirements.md](03_requirements.md) and [04_architecture.md](04_architecture.md).
Each milestone is a demonstrable vertical slice closing ≥ 1 AC.

Same sprint-close protocol: automated tests pass → human test feedback → merge →
inspect tags → propose semver → update CHANGELOG.md → annotated tag → push.

---

## 0. v2 Milestone Registry

| Milestone                          | File                                                 | Target version | Status          |
|------------------------------------|------------------------------------------------------|----------------|-----------------|
| M8 — Real-time audio I/O           | [docs/milestones/v2/M8.md](milestones/v2/M8.md)      | 0.2.0          | **released**    |
| M9 — WAV file input                | [docs/milestones/v2/M9.md](milestones/v2/M9.md)      | 0.2.1          | **released**    |
| M10 — Virtual buttons, GPIO & LEDs | [docs/milestones/v2/M10.md](milestones/v2/M10.md)    | 0.2.2          | **released**    |
| M10b — Visual controller editor    | [docs/milestones/v2/M10b.md](milestones/v2/M10b.md)  | 0.2.3          | **released**    |
| M11 — Full debug                   | [docs/milestones/v2/M11.md](milestones/v2/M11.md)    | 0.2.4          | **released**    |
| M12 — Hardware build & flash       | [docs/milestones/v2/M12.md](milestones/v2/M12.md)    | 0.2.5          | **in progress** |
| M13 — Spectrum & FFT               | [docs/milestones/v2/M13.md](milestones/v2/M13.md)    | 0.2.6          | **released**    |
| M14 — Session recording            | [docs/milestones/v2/M14.md](milestones/v2/M14.md)    | 0.2.7          | **released**    |

> M8 is confirmed highest-priority. Milestone ordering M8 → M9 → M10 → M10b → M11 → M12 → M13 → M14
> is confirmed. ✅ M10 scope reviewed and **locked** (2026-06-18) — see the locked-decisions section
> in [milestones/v2/M10.md](milestones/v2/M10.md); ready to implement.

---

## 1. Approach

- Same walking-skeleton-first principle as v1: land the hardest architectural change (real-
  time audio clock, M8) before adding features that depend on it.
- **M8 is the critical v2 gate:** it changes the engine's clock model (04 §2). Everything
  else in v2 layers on top without rearchitecting.
- Feature milestones (M9–M14) are relatively independent once M8 is stable.

---

## 2. Dependency graph & critical path

```
v1 (0.1.7, stable) ──► M8 real-time audio ──┬──► M9 WAV input
                                              ├──► M10 buttons / GPIO / LEDs ──► M10b visual editor
                                              ├──► M11 full debug (needs M8 mute-on-breakpoint)
                                              ├──► M12 hardware build (independent)
                                              ├──► M13 spectrum (needs M8 real-time stream)
                                              └──► M14 session recording (needs M8 pipeline)
```

**Critical path:** M8. All subsequent milestones can progress in parallel once M8 is stable,
but M11 (mute-on-breakpoint) and M13/M14 (audio pipeline) have soft dependencies on it.
M10b (visual editor) depends on M10 (yaml schema and controller panel must exist first).

---

## 3. AC coverage map

| AC | Closed in | AC | Closed in |
|----|-----------|----|----|
| AC-9 live audio in + out | M8 | AC-13 hardware build + flash | M12 |
| AC-10 WAV file input | M9 | AC-14 spectrum FFT spike | M13 |
| AC-11 virtual button + LED | M10 | AC-15 visual editor round-trip | M10b |
| AC-12 step/variables/call stack | M11 | AC-16 session record + replay | M14 |

---

## 4. Definition of Done (per milestone)

Per-milestone goals, tasks, and DoD live in the milestone files linked from the registry (§0):
`docs/milestones/v2/M8.md`…`M14.md`. Each milestone closes when:

1. Code + automated tests for the milestone's tasks pass.
2. The milestone's mapped AC(s) demonstrably pass (§3).
3. No regression to prior milestones' ACs.
4. Human test feedback collected (project rule 7).
5. If green: merge → inspect tags → propose semver → CHANGELOG.md → annotated tag → push.

---

## 5. Risk-driven sequencing notes

- **R12/R13 (real-time audio):** M8 is the proof that the clock model change works without
  xruns. Validate early on the development machine before building M9–M14 on top.
- **R15 (breakpoint + live audio):** mute-on-breakpoint is a critical M11 task; design it
  in M8 as a stub (IPC `audioMode` switch) so M11 just wires it.
- **R14 (debounce timing):** ✅ resolved in the M10 review — the `Switch` shim samples the atomic
  button state at each `Debounce()` call (no debounce thread); edge detection follows the effect's
  own call rate (04 §4). Validate against `Button` (1 kHz `loop()`) during M10 implementation.
- **R16/R17 (hardware toolchain):** M12 is last because it's most machine-dependent and
  doesn't block any other v2 feature.

---

## 6. Open items for v2 planning

| Item | Resolve by |
|------|-----------|
| ~~Host audio API decision~~ | ✅ CoreAudio-native for v2; cross-platform deferred to v3+ |
| ARM toolchain bundle vs detect | Before M12 design |
| FFT library selection | Before M13 design |
| Session recording format | Before M14 design |
| ~~Phasing within v2~~ | ✅ Confirmed: M8→M9→M10→M10b→M11→M12→M13→M14 |
