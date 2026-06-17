# 05 — Development Plan

Sprint/milestone plan for **ds-ide v1**, built on the requirements
([03](03_requirements.md)) and architecture ([04](04_architecture.md)). Each milestone is a
**demonstrable vertical slice** and closes against specific acceptance criteria (AC-1…AC-7 for v1.0,
AC-8 for the v1.1 fast-follow; 03 §8). Components are C1…C6 (04 §2).

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

## 3. Milestones

### M0 — Foundations *(enabler)*
**Goal:** scaffolding in place; shim interface pinned to the real libDaisy API.
- T0.1 — VS Code extension scaffold (TS project, activation, command stubs). *(C1)*
- T0.2 — Pin the **shim API headers** from the canonical libDaisy surface (02 §3.1), validated to
  compile against the official examples (`bypass`, `inout`, `Knob`, `Osc`). *(C5 interface, FR-SH)*
- T0.3 — Stand up the `daisy-seed-knowledge/examples` as the v1 test corpus; pick `bypass` (smallest
  end-to-end) and `Osc` (ADC, **interleaved**) as M1/M2 targets. `inout` (block-form) is the M7/v1.1
  target (04 §4.1). *(no porting needed — R9 downgraded)*
- **DoD:** shim headers compile against the chosen examples; extension loads in VS Code.
  *(No AC yet — enabling work.)*

### M1 — Headless emulator runtime *(critical path)*
**Goal:** a built effect runs in the runtime and produces output, no UI.
- T1.1 — **CMake host build** (C3): compile effect + shim + DaisySP + runtime `main()` → executable;
  `-O0 -g`. *(FR-BU-1/4/6)*
- T1.2 — **Shim** (C5): `DaisySeed` init, `AudioHandle`/`StartAudio`, `AdcHandle.GetFloat` (atomic
  pot state), `System`/log + unsupported-peripheral stubs. *(FR-SH-1..6)*
- T1.3 — **Runtime** (C4): simulated clock, sine generator, block loop with **interleaved**
  marshalling (v1.0; block-form deferred to M7, 04 §4.1), NaN/Inf/denormal/clip scan.
  *(FR-RU-2 [interleaved part]/3/4, FR-AU-1)*
- T1.4 — **IPC server** (JSON/socket): `config`, `transport`, `sine`, `pot`, `scope`, `status`,
  `event`. *(04 §5)*
- **DoD:** `bypass` builds & runs headless (out==in over IPC `scope`); `Osc` with a hardcoded pot
  value shows the oscillator pitch tracking it. Determinism check (NFR-6) passes. *(Both interleaved;
  block-form `inout` lands at M7.)*

### M2 — Extension run loop + scope
**Goal:** build → deploy → run → see waveforms, from inside VS Code.
- T2.1 — Extension build command invokes CMake; launches/stops the runtime; IPC client. *(C1,
  FR-DE-1, FR-RU-1)*
- T2.2 — **Scope webview** (C2): draw input vs output from `scope` frames. *(FR-AU-3)*
- T2.3 — Transport Start/Stop wired UI→IPC. *(FR-RU-1)*
- **DoD → AC-1** (build/deploy/run) and the scope shows sine in/out live.

### M3 — Controllers (pots)
**Goal:** turn on-screen pots, hear/see the effect respond.
- T3.1 — `controllers.yaml` parse + validate (duplicate channel/range/missing). *(FR-CT-1/5)*
- T3.2 — Pot sliders in webview → IPC `pot` → shim `GetFloat`. *(FR-CT-2/3, NFR-3 ≤50ms)*
- T3.3 — Pot-state persistence + `potSnapshot` replay on launch. *(FR-CT-4, FR-DE-2, FR-CF)*
- **DoD → AC-2** (move pot → output changes on scope), demonstrated with `Osc` (interleaved;
  block-form `inout` re-runs this check at M7/v1.1). Ship its `controllers.yaml` (1 pot; richer
  multi-pot configs when user effects are ported later).

### M4 — Diagnostics & robustness
**Goal:** fast, safe inner loop.
- T4.1 — Parse compiler output → diagnostics with file:line. *(FR-ED-3)*
- T4.2 — Non-host-portable detection → actionable message. *(FR-BU-5)*
- T4.3 — Surface NaN/Inf/denormal/clip indicators in UI. *(FR-RU-4)*
- T4.4 — Redeploy without restart, preserve pot positions; verify isolation (runtime crash ≠ ds-ide
  crash). *(FR-DE-2, NFR-8)*
- T4.5 — Visible fidelity caveat (no bit-exactness / no CPU-RAM-budget validation). *(NFR-7)*
- **DoD → AC-5** (NaN/clip flagged), **AC-7** (<30 s loop), **AC-6** (hardware build untouched —
  confirm `.ds-ide/` isolation).

### M5 — Debug (breakpoints)
**Goal:** stop time on a breakpoint inside the audio callback.
- T5.1 — lldb-dap integration + thin ds-ide debug adapter; Run vs Debug launch modes. *(C6,
  FR-DB-2/6)*
- T5.2 — Gutter breakpoints add/remove; pause-on-hit + current-line; support breakpoints in
  `AudioCallback`. *(FR-DB-1/3)*
- T5.3 — Continue / Stop; confirm simulated time frozen while paused. *(FR-DB-4/5)*
- **DoD → AC-4** (breakpoint in callback hit; line shown; time frozen; continue/stop).

### M6 — v1 polish & release
**Goal:** ship a coherent MVP.
- T6.1 — Sine frequency/amplitude controls. *(FR-AU-2)*
- T6.2 — Runtime status display (sample rate, block size, xrun n/a). *(FR-RU-5)*
- T6.3 — Usability pass: run an effect without a manual. *(NFR-9)*
- T6.4 — License tracking for bundled bits. *(NFR-10)*
- T6.5 — Full AC sweep (AC-1..AC-7) + human test feedback.
- **DoD:** all v1 ACs pass; sprint-close protocol → CHANGELOG + annotated tag. *(Ships v1.0 —
  interleaved-only; completes every AC. FR-RU-2/FR-SH-2 reach full "both forms" at M7.)*

### M7 — Block-form callback *(fast-follow, v1.1)*
**Goal:** run the 28 non-interleaved/block examples, completing FR-RU-2 / FR-SH-2 (04 §4.1).
- T7.1 — **Shim** (C5): add the `StartAudio(AudioCallback)` non-interleaved overload alongside the
  interleaved one. *(FR-SH-2, block part)*
- T7.2 — **Runtime** (C4): expose the canonical internal buffer as a `const float* const*` /
  `float* const*` view (additive adapter; no change to sine gen, scope tap, clock, or NaN/clip scan —
  validates the 04 §4.1 one-canonical-buffer assumption). *(FR-RU-2, block part)*
- T7.3 — Validate against `inout` (block-form) and a spot-check of the broader block set (e.g.
  `chorus`, `string`, `zoscillator`); re-run AC-2 ADC mapping on `inout`.
- **DoD → AC-8** (`inout` builds & runs; out volume tracks the pot on the scope; second overload +
  block marshalling proven); no regression to the interleaved corpus (`bypass`/`Osc`). Sprint-close
  → CHANGELOG + v1.1 annotated tag.

---

## 4. AC coverage map

| AC | Closed in | AC | Closed in |
|----|-----------|----|-----------|
| AC-1 build/deploy/run | M2 | AC-5 NaN/clip flagged | M4 |
| AC-2 pot → output | M3 | AC-6 hardware build intact | M4 |
| AC-4 breakpoint/freeze | M5 | AC-7 <30 s loop | M4 |
| AC-8 block-form (v1.1) | M7 | *(AC-3 removed — pots-only v1)* | — |

---

## 5. Definition of Done (per milestone)

1. Code + automated tests for the milestone's tasks pass.
2. The milestone's mapped AC(s) demonstrably pass.
3. No regression to prior milestones' ACs.
4. Human test feedback collected (project rule 7).
5. If green: merge → inspect tags → propose semver → CHANGELOG.md → annotated tag → push.

---

## 6. Risk-driven sequencing notes

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

## 7. Open items rolled forward

| From | Item | Resolve by |
|------|------|-----------|
| 04 §10 | Soft-pace vs free-run; socket type; lldb packaging | Implementation-time (M1/M5) |
| 04 §4.1 | Non-interleaved/block callback overload; one-canonical-buffer assumption | Scheduled at **M7/v1.1**; confirm buffer-view assumption there |
| 02 §4 | Live host audio input (v2 priority) | Post-v1 roadmap |
