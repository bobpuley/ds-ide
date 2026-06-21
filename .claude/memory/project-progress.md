---
name: project-progress
description: Version shipping history and current planning phase for ds-ide (v1–v6 complete, v7 planning)
metadata:
  type: project
---

# Project Progress Report

**v1 shipped** (0.1.0–0.1.7, M0–M7, all ACs green): native simulation; VS Code extension; CMake emulator build; sine-input audio engine; virtual potentiometers; waveform scope; breakpoint debugging. Archived docs: `docs/v1/`. The bundled `daisy-seed-knowledge/` corpus is the API reference; indexed as a graphify knowledge graph — query with `/graphify query "…"` (see `graphify-out/`).
**v2 shipped** (0.2.0–0.2.9, M8–M15, all ACs green): live host audio I/O; WAV file input; virtual buttons/GPIO/LEDs; visual controller editor; full debug (step/variables/call-stack); in-IDE hardware build + DFU flash; spectrum/FFT view; session recording; scope UI refresh. Archived docs: `docs/v2/`.
**v3 shipped** (0.3.0–0.3.3, M16–M18, all ACs green): Controls Editor v3 (two-mode, code inference); Wiring Editor (SVG pinout, C++ gen); spectrum/scope polish. Archived docs: `docs/v3/`.
**v4 shipped** (0.4.0–0.4.3, M19–M22, all ACs green): Controls Editor single-mode handle UX; Wiring Editor polish; command cleanup; VS Code Run integration (F5/Ctrl+F5); secondary sidebar panels. Archived docs: `docs/v4/`.
**v5 shipped** (0.5.0–0.5.1, M23–M24, all ACs green): Effect Project Wizard; init block code generation. Archived docs: `docs/v5/`.
**v6 shipped** (0.6.0, M25, all ACs green): RT-thread heap/mutex/scope safety fixes, malloc null-check, WAV div-by-zero guard, IPC reliability hardening, session recorder TOCTOU fix, GPIO pin alias correction, sanitizer CMake options (ASan/UBSan/TSan), low-severity quality improvements (AC-38–AC-54). Archived docs: `docs/v6/`.
**v7 planning**: see `docs/01_input-ideas.md`–`docs/05_dev-plan.md`.
