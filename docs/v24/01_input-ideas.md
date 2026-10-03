# 01 — Input Ideas (v24)

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

## Reachability (intake 2026-10-01, source: `design_plan.md` §7 row 1 + P1-3)

- **Reopen commands** — palette commands to show/focus Scope, OLED, MIDI, Controls Editor and Wiring Editor (`design_plan.md` P0-2). Closing the Scope tab today costs a full rebuild + relaunch to get it back.
- **First-run onboarding** — `viewsWelcome` on the Controls/Wiring views (gated on `ds-ide.isDaisyProject`) plus a "Get started with Daisy Seed" walkthrough (P1-4).
- **README/manifest lint** — README still says "Open Wiring Editor" (removed in M21); add a check that command names in docs exist in `package.json` (P2-3).
- **Auto-save layout** — Controls Editor layout saved on drag-end (debounced) instead of only via the "💾 layout" button (P1-3).

## Editor polish (intake 2026-10-01, source: user request)

- **Wiring legend** — the Wiring Editor shows no key for its pin colours (`design_plan.md` P1-6).
- **Remove the play/stop marker** from the Controls Editor header.
- **Layout helpers in the Controls header** — an *align to grid* button, plus other relevant helpers (`design_plan.md` P2-2): auto-arrange and reset positions were chosen.

## Scope toolbar popovers (intake 2026-10-03, source: user request — mockup `docs/mockups/v22-scope-instrument_alt1.html`)

- **Space-saving popovers** — integrate the space-saving popover solution (M75, 0.24.2): the Scope toolbar's Gain, Scale and Trigger (edge + source) segmented groups, and the spectrum bar's frequency-axis and level-mode groups, become one chip each showing only the current value, with a popover for choosing. Goal: use the available width better and make the current settings readable at a glance.


## Expanded Input types (intake 2026-10-03, source: user request — mockup `docs/mockups/v23b-effect-testing-layered.html`)

- **Expand the "input" type** — the Scope's Input select (today Sine / Live (mic) / WAV) grows as in the layered effect-testing mockup: a "Generators" group (Sine, Noise, Log sweep, Impulse, Step, Silence, Two-tone) separate from the "External" group (Live input, WAV file…), with a per-generator parameter row (`docs/raw/test_framework/effect-testing-features.md` §3.1, §5.1; `design_plan.md` §6.B-1).
