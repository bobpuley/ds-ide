# 01 — Input Ideas (v10)

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

## v10 Ideas (2026-06-29)

- **Scope audio settings always visible** — The "Audio Settings" collapsible footer section in the Daisy Scope panel should no longer be collapsible; the section should always be fully expanded (no collapse toggle, no arrow, always visible).
- **Controls Editor and Wiring Editor as independent tool windows** — The two editors should no longer be stacked in the shared sidebar container as `WebviewView` panels. Each should live in its own independent tool window so the user can freely position them in the VS Code layout (move, split, float, dock to bottom, etc.).
- **Dedicated icons for Controls Editor and Wiring Editor** — Now that the two editors are independent windows, each should have a distinct, meaningful icon that visually identifies it (e.g. shown in the tab bar / panel title).

## v10 Revision Ideas (2026-06-30)

- **Activity Bar split: Controls Editor and Wiring Editor as separate Activity Bar views** — Replace the single DS-IDE Activity Bar icon (which in M34 became a welcome view with two buttons opening editor-area `WebviewPanel` tabs) with two dedicated Activity Bar icons: one for the Controls Editor (knob icon) and one for the Wiring Editor (DIP chip icon). Clicking each icon shows the corresponding editor directly in the Primary Sidebar as a `WebviewView`, not as a tab in the editor area. Each editor lives in its own `viewsContainers.activitybar` entry with its own icon.
