# 02 — Assumptions & Risks (v4)

> **All prior versions complete** — full bet/risk history in their respective archives.
>
> **v1 complete** — all v1 bets (A1–A8) held. Archived: [`docs/v1/`](v1/02_assumptions-and-risks.md).
>
> **v2 complete** — all v2 bets (A9–A14) held; all risks (R12–R18) resolved or managed.
> Archived: [`docs/v2/`](v2/02_assumptions-and-risks.md).
>
> **v3 complete** — all v3 bets (A15–A16) held; risks R19–R20 resolved.
> Archived: [`docs/v3/02_assumptions-and-risks.md`](v3/02_assumptions-and-risks.md).

What ds-ide **v4 is betting on**, and where those bets could be wrong.

Legend — **Impact if wrong**: 🔴 high · 🟠 medium · 🟡 low.

---

## 1. Carried-forward bets (still hold in v4)

All v1–v3 bets remain valid. See respective archives for full detail. Key ones:

| ID | Bet (summary) | Source |
|----|---------------|--------|
| A1 | Daisy effects are host-portable C++ | v1, confirmed |
| A2 | Host libDaisy shim has bounded surface | v1+v2, extended to Switch/GPIO |
| A4 | VS Code extension model is sufficient | v1+v2+v3, confirmed |
| A15 | Effect code follows a parseable `// ds-ide:controls` convention | v3, confirmed in M17 |
| A16 | Writing declaration lines into the controls block is safe | v3, confirmed in M18 |

---

## 2. v4 bets

| ID | We are betting that… | Why we believe it | Impact if wrong |
|----|----------------------|-------------------|-----------------|
| **A17** | **Single-mode handle UX is learnable without an explicit mode label** — developers will discover that dragging the handle rearranges and interacting with the body sends live data, without a tutorial. | Common drag-handle patterns (Notion, Figma blocks) establish this mental model. The handle icon itself signals "move me". | 🟡 If discoverability is poor, add a tooltip or one-time onboarding hint. Does not change the architecture. |
| **A18** | **Controls are always visible; handle drag is always active; body interaction is gated on emulator state** — in the single-mode Controls Editor, dragging a control's handle to rearrange is available at all times (emulator stopped or running). Interacting with the control body (pot slider, button, LED) is disabled (grayed-out) when the emulator is not running. | Developer confirmed this split explicitly. Consistent with standard UI affordance: layout editing is independent of runtime state. | 🟡 If grayed-out body state is visually ambiguous, add a tooltip or status indicator explaining why interaction is unavailable. |

---

## 3. v4 risks

| ID | Risk | Likelihood | Impact | Mitigation |
|----|------|-----------|--------|------------|
| **R21** | **Controls Editor single-mode redesign breaks AC-18** — replacing the two-mode panel (D18) means the existing AC-18 acceptance criteria (tests Design mode / Run mode explicitly) must be rewritten. If skipped, the old AC remains green against dead code. | Medium | 🟠 | Explicitly retire AC-18 and write new AC-24 for the handle-based UX as the first v4 task. |
| **R22** | **Knob visual improvement requires a custom WebGL/Canvas renderer** — if the target look (realistic hardware knob) cannot be achieved with CSS alone, a canvas-based renderer adds significant complexity. | Low–Med | 🟠 | Prototype with CSS first (e.g. conic-gradient + rotation transform). If visual fidelity is insufficient, evaluate a lightweight SVG-per-knob approach before canvas. |

---

## 4. Open items

*(none — A18 confirmed by developer 2026-06-20)*
