# 05 — Development Plan (v25)

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
>
> **v15 complete** — M48–M50 released (0.15.0–0.15.2), all ACs green.
> Archived: [`docs/v15/`](v15/).
>
> **v16 complete** — M51 released (0.16.0), all ACs green.
> Archived: [`docs/v16/`](v16/).
>
> **v17 complete** — M52 released (0.17.0), all ACs green.
> Archived: [`docs/v17/`](v17/).
>
> **v18 complete** — M53–M57 released (0.17.1–0.17.5), all ACs green.
> Archived: [`docs/v18/`](v18/).
>
> **v19 complete** — M58–M59 released (0.17.6–0.17.7), all ACs green.
> Archived: [`docs/v19/`](v19/).
>
> **v20 complete** — M60–M61 released (0.18.0–0.18.1), all ACs green.
> Archived: [`docs/v20/`](v20/).
>
> **v21 complete** — M62–M64 released (0.19.0–0.19.2), all ACs green.
> Archived: [`docs/v21/`](v21/).
>
> **v22 complete** — M65–M69 released (0.20.0–0.20.4), all ACs green.
> Archived: [`docs/v22/`](v22/).
>
> **v23 complete** — M70–M72 released (0.21.0–0.23.0), all ACs green.
> Archived: [`docs/v23/`](v23/).
>
> **v24 complete** — M73–M76 released (0.24.0–0.24.3), all ACs green.
> Archived: [`docs/v24/`](v24/).

*v25 milestones not yet planned.*

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

### v15 (0.15.0–0.15.2) — archived in `docs/v15/`

M48 Controls Editor Fix & I/O Monitor UIs · M49 Controls Editor as Preview Surface (OLED Embedding) ·
M50 Persist Editor Positions for Encoder, Toggle, and RGB LED.
Full registry in [`docs/v15/05_dev-plan.md`](v15/05_dev-plan.md).

### v16 (0.16.0) — archived in `docs/v16/`

M51 Host MIDI Bridge Native-Addon ABI Fix.
Full registry in [`docs/v16/05_dev-plan.md`](v16/05_dev-plan.md).

### v17 (0.17.0) — archived in `docs/v17/`

M52 MIDI Program Change Typed Support.
Full registry in [`docs/v17/05_dev-plan.md`](v17/05_dev-plan.md).

### v18 (0.17.1–0.17.5) — archived in `docs/v18/`

M53 Multi-Root Debug-Attach Fix · M54 Emulator RT & Concurrency Safety · M55 Extension Critical Fixes ·
M56 Extension Reliability & Validation Hardening · M57 Extension API, Type & Maintainability Polish.
Full registry in [`docs/v18/05_dev-plan.md`](v18/05_dev-plan.md).

### v19 (0.17.6–0.17.7) — archived in `docs/v19/`

M58 Debug-Attach Detach Noise Fix · M59 Stale Build-Cache Self-Heal.
Full registry in [`docs/v19/05_dev-plan.md`](v19/05_dev-plan.md).

### v20 (0.18.0–0.18.1) — archived in `docs/v20/`

M60 Wizard-Time DaisySP Provisioning · M61 Hardware Memory-Budget Alerting.
Full registry in [`docs/v20/05_dev-plan.md`](v20/05_dev-plan.md).

### v21 (0.19.0–0.19.2) — archived in `docs/v21/`

M62 MIDI Monitor IPC Schema Fix · M63 Manual Test Tracker · M64 Functional/E2E Test Layer (Foundation).
Full registry in [`docs/v21/05_dev-plan.md`](v21/05_dev-plan.md).

### v22 (0.20.0–0.20.4) — archived in `docs/v22/`

M65 Unified Device Model (Foundation) · M66 Unified Device Model (Drag & Drop) · M67 Stateful Transport on Native Surfaces · M68 Extension Views Follow the IDE Theme · M69 Controls Editor Devices in the Wiring-Palette Style.
Full registry in [`docs/v22/05_dev-plan.md`](v22/05_dev-plan.md).

### v23 (0.21.0–0.23.0) — archived in `docs/v23/`

M70 Scope Instrument — Display · M71 Scope Instrument — Analysis · M72 Scope Instrument — Emulator Capture.
Full registry in [`docs/v23/05_dev-plan.md`](v23/05_dev-plan.md).

### v24 (0.24.0–0.24.3) — archived in `docs/v24/`

M73 Reachability · M74 Editor Polish · M75 Scope Toolbar Popovers · M76 Input Generators.
Full registry in [`docs/v24/05_dev-plan.md`](v24/05_dev-plan.md).

### v25 (0.25.0-win.1–0.25.0-win.8) — planned

| ID  | Name                                                | Status      | Version        | File                                                |
|-----|-----------------------------------------------------|-------------|----------------|-----------------------------------------------------|
| M77 | Windows Build Foundations                           | **planned** | 0.25.0-win.1   | [Milestone_M77.md](milestones/v25/Milestone_M77.md) |
| M78 | IPC Transport & Process Lifecycle                   | **planned** | 0.25.0-win.2   | [Milestone_M78.md](milestones/v25/Milestone_M78.md) |
| M79 | Audio Backend Abstraction                           | **planned** | 0.25.0-win.3   | [Milestone_M79.md](milestones/v25/Milestone_M79.md) |
| M80 | Windows Audio Backend & Measurement Gate            | **planned** | 0.25.0-win.4   | [Milestone_M80.md](milestones/v25/Milestone_M80.md) |
| M81 | Windows Toolchain, Debug & Flash Discovery          | **planned** | 0.25.0-win.5   | [Milestone_M81.md](milestones/v25/Milestone_M81.md) |
| M82 | Managed Windows Toolchain Download                  | **planned** | 0.25.0-win.6   | [Milestone_M82.md](milestones/v25/Milestone_M82.md) |
| M83 | Cross-Platform MIDI Bridge & Per-Platform VSIX      | **planned** | 0.25.0-win.7   | [Milestone_M83.md](milestones/v25/Milestone_M83.md) |
| M84 | Windows Verification & Merge Readiness              | **planned** | 0.25.0-win.8   | [Milestone_M84.md](milestones/v25/Milestone_M84.md) |

Source: `multiplatform_plan.md`; intake session, 2026-10-04.

**Git workflow (applies to every v25 milestone — FR-WIN-GIT-1..3):** nothing is merged into `main` automatically. The base branch is `feat/windows-support` (already on `origin`). For each milestone, create a branch from `feat/windows-support` (`feat/m<N>-<slug>`); at milestone close, merge that branch into `feat/windows-support` (not `main`), update `CHANGELOG.md`, tag the pre-release `0.25.0-win.<N>` and push the branch and tag. `feat/windows-support` is merged into `main` only after M84, with explicit user approval. The existing macOS suites must be green at every close (FR-WIN-GIT-2).

**Priority/sequence (from `multiplatform_plan.md`):** M77 → M78 → M79 → M80 → M81 → M82 → M83 → M84. The Windows compiler, packaging model and toolchain-delivery decisions are already taken (see `02_assumptions-and-risks.md`). A native WASAPI milestone is **not** planned; it is added only if the M80 measurement gate (FR-WIN-AUD-7) shows RtAudio is insufficient.
