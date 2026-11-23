> **v26 complete** — archived to `docs/v26/` on 2026-11-14. This file now seeds v27 planning.

# 01 — Input Ideas (v27)

> **v1 complete** — ds-ide 0.1.0–0.1.7 (M0–M7), all ACs green. Full v1 ideas archived in
> [`docs/v1/01_input-ideas.md`](v1/01_input-ideas.md).
>
> **v2 complete** — ds-ide 0.2.0–0.2.9 (M8–M15), all ACs green. Full v2 ideas archived in
> [`docs/v2/01_input-ideas.md`](v2/01_input-ideas.md).
>
> **v3 complete** — ds-ide 0.3.0–0.3.3 (M16–M18), all ACs green. Full v3 ideas archived in
> [`docs/v3/01_input-ideas.md`](v3/01_input-ideas.md).
>
> **v4 complete** — ds-ide 0.4.0–0.4.3 (M19–M22), all ACs green. Full v4 ideas archived in
> [`docs/v4/01_input-ideas.md`](v4/01_input-ideas.md).
>
> **v5 complete** — ds-ide 0.5.0–0.5.1 (M23–M24), all ACs green. Full v5 ideas archived in
> [`docs/v5/01_input-ideas.md`](v5/01_input-ideas.md).
>
> **v6 complete** — archived to `docs/v6/` on 2026-06-21. Full v6 ideas archived in
> [`docs/v6/01_input-ideas.md`](v6/01_input-ideas.md).
>
> **v7 complete** — archived to `docs/v7/` on 2026-06-21. Full v7 ideas archived in
> [`docs/v7/01_input-ideas.md`](v7/01_input-ideas.md).
>
> **v8 complete** — archived to `docs/v8/` on 2026-06-22. Full v8 ideas archived in
> [`docs/v8/01_input-ideas.md`](v8/01_input-ideas.md).
>
> **v9 complete** — archived to `docs/v9/` on 2026-06-29. Full v9 ideas archived in
> [`docs/v9/01_input-ideas.md`](v9/01_input-ideas.md).
>
> **v10 complete** — archived to `docs/v10/` on 2026-06-30. Full v10 ideas archived in
> [`docs/v10/01_input-ideas.md`](v10/01_input-ideas.md).
>
> **v11 complete** — archived to `docs/v11/` on 2026-07-04. Full v11 ideas archived in
> [`docs/v11/01_input-ideas.md`](v11/01_input-ideas.md).
>
> **v12 complete** — archived to `docs/v12/` on 2026-07-05. Full v12 ideas archived in
> [`docs/v12/01_input-ideas.md`](v12/01_input-ideas.md).
>
> **v13 complete** — archived to `docs/v13/` on 2026-07-05. Full v13 ideas archived in
> [`docs/v13/01_input-ideas.md`](v13/01_input-ideas.md).
>
> **v14 complete** — archived to `docs/v14/` on 2026-07-22. Full v14 ideas archived in
> [`docs/v14/01_input-ideas.md`](v14/01_input-ideas.md).
>
> **v15 complete** — archived to `docs/v15/` on 2026-07-25. Full v15 ideas archived in
> [`docs/v15/01_input-ideas.md`](v15/01_input-ideas.md).
>
> **v16 complete** — archived to `docs/v16/` on 2026-07-25. Full v16 ideas archived in
> [`docs/v16/01_input-ideas.md`](v16/01_input-ideas.md).
>
> **v17 complete** — archived to `docs/v17/` on 2026-08-23. Full v17 ideas archived in
> [`docs/v17/01_input-ideas.md`](v17/01_input-ideas.md).
>
> **v18 complete** — archived to `docs/v18/` on 2026-08-25. Full v18 ideas archived in
> [`docs/v18/01_input-ideas.md`](v18/01_input-ideas.md).
>
> **v19 complete** — archived to `docs/v19/` on 2026-08-27. Full v19 ideas archived in
> [`docs/v19/01_input-ideas.md`](v19/01_input-ideas.md).
>
> **v20 complete** — archived to `docs/v20/` on 2026-08-30. Full v20 ideas archived in
> [`docs/v20/01_input-ideas.md`](v20/01_input-ideas.md).
>
> **v21 complete** — archived to `docs/v21/` on 2026-08-30. Full v21 ideas archived in
> [`docs/v21/01_input-ideas.md`](v21/01_input-ideas.md).
>
> **v22 complete** — archived to `docs/v22/` on 2026-09-30. Full v22 ideas archived in
> [`docs/v22/01_input-ideas.md`](v22/01_input-ideas.md).
>
> **v23 complete** — archived to `docs/v23/` on 2026-09-30. Full v23 ideas archived in
> [`docs/v23/01_input-ideas.md`](v23/01_input-ideas.md).
>
> **v24 complete** — archived to `docs/v24/` on 2026-10-03. Full v24 ideas archived in
> [`docs/v24/01_input-ideas.md`](v24/01_input-ideas.md).
>
> **v26 complete** — ds-ide 0.24.4–0.25.0 (M85–M91), the first public preview, all ACs green. Full v26 ideas archived in
> [`docs/v26/01_input-ideas.md`](v26/01_input-ideas.md).

## Ideas

- **Windows support (macOS + Windows)** — make ds-ide (extension + emulator) run on Windows in
  addition to macOS. Full survey, verified findings, decisions and priority order are in
  `multiplatform_plan.md` (repo root, committed on `feat/windows-support`, `72be7f7`). Decisions
  taken so far: clang/MinGW as the Windows compiler; platform-specific VSIX; Windows toolchain
  delivered by download-on-first-use (Option C); common `AudioDevice` interface with CoreAudio kept
  on macOS and RtAudio first on Windows (native WASAPI only if the measurement gate fails); IPC
  moves to TCP loopback with an explicit IPC `shutdown` message.
- **Git workflow for this work** — nothing is merged automatically into `main`. The base branch
  for all Windows work is `feat/windows-support` (already on `origin`). Each milestone gets its
  own branch created from `feat/windows-support`, and at milestone close that branch is merged
  into `feat/windows-support`. The merge of `feat/windows-support` into `main` happens only at
  the very end, once the whole Windows support is completed and tested (no regressions on macOS).

## v27 ideas

- **AI-agent guideline file (feature, 2026-11-15):** let's add to the extension an exclusive AI oriented file (txt, md, or whatever is best) that explains the conventions to follow in order to develop, or adapt an already written, effect so it is compatible with the IDE. Most devs are now using claude/copilot/openai/deepseek/etc, so a guideline specifically designed for the agent would be useful.
- **Bug (M92 manual test, 2026-11-17):** after a coding agent changes the effect source of a new project (or of an existing non-Daisy-IDE project) to follow the Daisy IDE conventions, the Controls and Wiring editors do not refresh, so it looks as if the guide did not work. Expected: the editors show the controls the agent declared without reloading the window.
