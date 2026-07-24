# 01 — Input Ideas (v15)

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

---

## v15 intake log

- **Bug — Controls Editor layout not persisted across panel switch.** Steps: open Controls
  Editor → rearrange controls → save layout → switch to Wiring Editor → switch back to Controls
  Editor. Expected: controls stay positioned per the last save. Actual: controls reset to default
  positions. (2026-07-24)
- **Feature — SD card virtual filesystem surfaced to the user.** The SD card's simulated storage
  should be mirrored into a project-relative folder (e.g. `./virtual-sd-fs/<sdid>/`) or an
  equivalent structured mapping, so generated SD content is trivially browsable on disk. The
  Controls Editor should show the SD card's root content list (text-file preview as a nice-to-have).
  (2026-07-24)
- **Feature — OLED monitor folded into the Controls Editor as its default view.** Currently the
  OLED monitor is a separate webview. Proposal: make it the default embedded view within the
  Controls Editor (with a "show in separate view" option for detailed inspection), and reframe the
  Controls Editor's purpose more broadly — from "layout editor" to a general real-world preview
  surface, which in future would also host pedal/board/rack layouts. (2026-07-24)
- **Feature — Fuller MIDI I/O surface.** The virtual keyboard covers note testing, but a MIDI
  controller can also send Program Change (and other) messages, so a simple UI to send specific
  MIDI messages is needed. The Seed can also emit MIDI output, which should be shown in a
  real-time output message list. All of this should live in one unified MIDI monitor webview.
  (2026-07-24)

*v15 milestones: see the Milestone Registry in `05_dev-plan.md`.*
