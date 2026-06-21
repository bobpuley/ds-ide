# 01 — Input Ideas (v7)

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
> **v6 complete** — archived to `docs/v6/` on 2026-06-21. This file now seeds v7 planning.

## View Editor State Initialization & Pinout Accuracy Bugs (`view-problems.md`, 2026-06-21)

- **Bug 1 — Controls Editor: no state on project open.** Observed: opening a project with a valid `controllers.yaml` shows no controls in the Controls Editor until after the first deployment to the emulator. Expected: the editor should parse the `ds-ide:controls` block + `controllers.yaml` at project open time; should also refresh on C++ source or `controllers.yaml` file save.
- **Bug 2 — Wiring Editor: no state on project open.** Observed: opening a project whose C++ source already contains a `ds-ide:controls` block shows no wired pins in the Wiring Editor — the view appears empty as if nothing is wired. Expected: the Wiring Editor should parse the block at project open time; should also refresh on C++ source file save.
- **Bug 3 — Daisy Seed SVG pinout is wrong.** Observed: left side from USB shows D1/D0/D2/D3 (wrong order); right side shows 3V3/VIN/BOOT/GND (wrong labels and order). Expected: left side from USB = D0/D1/D2/D3; right side from USB = GND/VIN/3V3/D30, per the authoritative `Seed_pinout.csv`.

## Controls Editor Runtime UI Redesign (2026-06-21)

- **Feature — Controls Editor runtime card compact redesign.** In convention (runtime) mode, each control card wastes space with a visible kind badge ("Pot", "Button", "LED") and pin number in the header, a redundant text label inside the button body, and a text label next to the LED dot. The card body content is also left-aligned. Desired: remove kind and pin from the header and expose them only via `title` tooltip; truncate control IDs > 15 chars with `…` and show the full ID in a tooltip; center-align body content inside each card; render the button as a compact square pad with a raised box-shadow affordance (no text label in the button body); remove the text label from the LED body (dot only). Goal: minimum space usage while preserving usability.

## Wiring Editor / Controls Editor View Exclusivity (2026-06-21)

- **Feature — Wiring Editor and Controls Editor panels shall be mutually exclusive.** Opening one panel should automatically collapse the other. Rationale: both panels share the secondary sidebar slot and are used in distinct workflow phases; having both open simultaneously wastes space without adding value.
