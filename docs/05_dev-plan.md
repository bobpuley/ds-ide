# 05 — Development Plan (v15)

> **v1 complete** — M0–M7 released (0.1.0–0.1.7), all ACs green.
> Archived: [`docs/v1/`](v1/).
>
> **v2 complete** — M8–M15 released (0.2.0–0.2.9), all ACs green.
> Archived: [`docs/v2/`](v2/).
>
> **v3 complete** — M16–M18 released (0.3.0–0.3.3), all ACs green.
> Archived: [`docs/v3/`](v3/).
>
> **v4 complete** — M19–M22 released (0.4.0–0.4.3), all ACs green.
> Archived: [`docs/v4/`](v4/).
>
> **v5 complete** — M23–M24 released (0.5.0–0.5.1), all ACs green.
> Archived: [`docs/v5/`](v5/).
>
> **v6 complete** — M25 released (0.6.0), all ACs green.
> Archived: [`docs/v6/`](v6/).
>
> **v7 complete** — M26–M27 released (0.7.0–0.8.0), all ACs green.
> Archived: [`docs/v7/`](v7/).
>
> **v8 complete** — M28–M30 released (0.8.2–0.8.4), all ACs green.
> Archived: [`docs/v8/`](v8/).
>
> **v9 complete** — M31–M33 released (0.9.0–0.9.2), all ACs green.
> Archived: [`docs/v9/`](v9/).
>
> **v10 complete** — M34–M35 released (0.10.0–0.11.0), all ACs green.
> Archived: [`docs/v10/`](v10/).
>
> **v11 complete** — M36–M37 released (0.12.0–0.12.1), all ACs green.
> Archived: [`docs/v11/`](v11/).
>
> **v12 complete** — M38–M40 released (0.13.0–0.13.2), all ACs green.
> Archived: [`docs/v12/`](v12/).
>
> **v13 complete** — M41–M42 released (0.13.3–0.13.4), all ACs green.
> Archived: [`docs/v13/`](v13/).
>
> **v14 complete** — M43–M47 released (0.14.0–0.14.4), all ACs green.
> Archived: [`docs/v14/`](v14/).

v15 milestone planning is underway — see the registry below.

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

M16 v3 polish & bug fixes · M16b Speaker output in simulated mode · M17 Controls Editor v3
(two-mode) · M18 Wiring Editor.
Full registry in [`docs/v3/05_dev-plan.md`](v3/05_dev-plan.md).

### v4 (0.4.0–0.4.3) — archived in `docs/v4/`

M19 UX polish & command improvements · M20 Controls Editor single-mode handle UX · M21 VS Code
Run command integration · M22 Secondary sidebar panels.
Full registry in [`docs/v4/05_dev-plan.md`](v4/05_dev-plan.md).

### v5 (0.5.0–0.5.1) — archived in `docs/v5/`

M23 Effect Project Wizard · M24 Init block code generation.
Full registry in [`docs/v5/05_dev-plan.md`](v5/05_dev-plan.md).

### v6 (0.6.0) — archived in `docs/v6/`

M25 Emulator Runtime Safety & Code Quality — RT-thread heap/mutex/scope fixes, malloc null-check,
WAV div-by-zero guard, IPC reliability hardening, session TOCTOU fix, GPIO alias correction,
sanitizer CMake options, and low-severity quality improvements (AC-38–AC-54).
Full registry in [`docs/v6/05_dev-plan.md`](v6/05_dev-plan.md).

### v7 (0.7.0–0.8.0) — archived in `docs/v7/`

M26 View State Initialization & Pinout Accuracy · M27 Controls Editor UI Polish & View Exclusivity.
Full registry in [`docs/v7/05_dev-plan.md`](v7/05_dev-plan.md).

### v8 (0.8.2–0.8.4) — archived in `docs/v8/`

M28 Webview Security Hardening · M29 Extension Runtime Reliability · M30 Extension Quality Polish.
Full registry in [`docs/v8/05_dev-plan.md`](v8/05_dev-plan.md).

### v9 (0.9.0–0.9.2) — archived in `docs/v9/`

M31 Emulator RT-thread Safety · M32 Extension & Emulator Correctness · M33 Quality Polish.
Full registry in [`docs/v9/05_dev-plan.md`](v9/05_dev-plan.md).

### v10 (0.10.0–0.11.0) — archived in `docs/v10/`

M34 UI Polish: Independent Editors, Always-Visible Audio Settings, Panel Icons · M35 Activity Bar Split: Controls and Wiring as Independent Sidebar Views.
Full registry in [`docs/v10/05_dev-plan.md`](v10/05_dev-plan.md).

### v11 (0.12.0–0.12.1) — archived in `docs/v11/`

M36 Emulator RT & Memory Safety Critical Fixes · M37 Extension/IPC Critical Reliability & Packaging.
Full registry in [`docs/v11/05_dev-plan.md`](v11/05_dev-plan.md).

### v12 (0.13.0–0.13.2) — archived in `docs/v12/`

M38 Emulator Correctness & Robustness · M39 IPC & Data Validation Hardening · M40 Extension UX & Workspace Safety.
Full registry in [`docs/v12/05_dev-plan.md`](v12/05_dev-plan.md).

### v13 (0.13.3–0.13.4) — archived in `docs/v13/`

M41 Emulator Code Quality & Hygiene · M42 Extension/Tooling Polish.
Full registry in [`docs/v13/05_dev-plan.md`](v13/05_dev-plan.md).

### v14 (0.14.0–0.14.4) — archived in `docs/v14/`

M43 Device Registry & Protocol Foundation · M44 Cheap Trio — Toggle, RGB LED, Encoder ·
M45 MicroSD & Bus-Peripheral UI · M46 OLED Display · M47 MIDI — TRS & USB.
Full registry in [`docs/v14/05_dev-plan.md`](v14/05_dev-plan.md).

### v15 (0.15.0–…) — planned

| ID   | Name          | Status                        | Version   | File                                              |
|------|---------------|--------------------------------|-----------|----------------------------------------------------|
| M48  | Controls Editor Fix & I/O Monitor UIs | **planned** | 0.15.0 | [Milestone_M48.md](milestones/v15/Milestone_M48.md) |
| M49  | Controls Editor as Preview Surface (OLED Embedding) | **planned** | 0.15.1 | [Milestone_M49.md](milestones/v15/Milestone_M49.md) |

Source: 2026-07-24 intake session — bug report + 3 feature requests, split into two milestones
(M48: concrete additive UI work; M49: the controls-editor reframing/OLED-embedding, kept separate
since it changes the panel's default view and warranted its own design pass).
