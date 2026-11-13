# 01 — Input Ideas (v25)

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

## First public preview — findings from the fresh-profile test (2026-11-11)

Source: fresh-install test of the `darwin-arm64` package in a clean VS Code profile; tracked in `docs/release_plan.md`.

- **Workspace trust.** In Restricted Mode (an untrusted folder, which is every first-time user's first state) the Controls Editor and Wiring Editor activity-bar icons are missing, with no explanation. They appear once the folder is trusted. `package.json` declares no `capabilities.untrustedWorkspaces`, and the README does not mention trusting the folder. Request: declare workspace-trust support explicitly and add a "trust the folder" line to the README quick start.
- **Missing CMake.** With `cmake` not on `PATH`, **Run Daisy Effect** shows only "Build failed. Nothing was deployed." with a **Show Problems** button that opens an empty list. The real cause (`spawn cmake ENOENT`) is dropped. Expected: a clear "CMake not found" message with an install hint (and the cause written to the build output channel). `cmake` is also spawned by plain name from `PATH` only, whereas `dfu-util` and the ARM toolchain fall back to known install paths.
- **Run button and palette commands missing on a freshly opened project (bug).** Observed (fresh profile, packaged `.vsix`, tremolo-filter open in the editor): the editor-title play button is not shown and "Daisy IDE: Run Daisy Effect" is absent from the Command Palette until something else activates the extension (e.g. opening the Controls Editor), after which both appear. Expected: opening a Daisy project is enough. Cause: `ds-ide.runEffect`/`debugEffect`/`stopEffect` have `enablement: ds-ide.isDaisyProject` (a disabled command is hidden from the palette) and the editor-title buttons are gated on `ds-ide.isDaisyProject && ds-ide.isEffectSource`; both context keys are set only inside `activate()`, and the manifest has no `activationEvents`, so VS Code only activates the extension on first use of one of its commands or views.

## First public preview — curate the shipped examples (2026-11-13)

Source: owner request while working through `docs/release_plan.md` (fresh-install findings: shipped examples are milestone-named, `m10-demo`/`m16b-demo` predate the `ds-ide:controls` convention, and a plain copy of an example that includes `daisysp.h` fails with `'daisysp.h' file not found`).

- **Curate `examples/`.** Everything under `examples/` ships in the `.vsix`. Replace the milestone-named demos (`m10-demo`, `m13-demo`, `m16-demo`, `m16b-demo`, `m17-demo`) with a small set of meaningfully named examples, each showing one extension capability and each with a README that says how to use it and what the user should learn: basic controls (pot, LED, button, encoder), MIDI control (virtual keyboard drives an oscillator, a Control Change message switches the waveform), OLED (show the selected waveform), SD card (log the user's actions on the controls). Owner's own ideas; feedback and alternatives welcome.
- **DaisySP for shipped examples.** Owner suggested one shared DaisySP copy with a symlink per example; agreed instead on a bundled-DaisySP fallback (see 02/03), because `vendor/DaisySP` already ships in the `.vsix` and a symlink breaks as soon as an example is copied out of the extension folder.

- **Bug: SD card files do not reach the project (found building `controls-sd-logger`, 2026-11-13).** Observed: the emulator's FatFs shim resolves the card as `sdcard/` relative to the emulator process's working directory, and `EmulatorManager.deploy` spawns `effect_emu` without a `cwd`, so it inherits VS Code's. The SD viewer in the Controls Editor reads `<workspace folder>/sdcard/`. Run with `/` as the working directory (a Dock-launched VS Code), no card is created and the effect's `f_mount` fails; run from another folder, the files land there and the viewer never sees them. Expected: the card is `<workspace folder>/sdcard/` whichever way VS Code was started. Also found: the shim has no `f_sync`, so lines written by an effect stay buffered until the file is closed (real FatFs has `f_sync`).

- **Bug: the SD card viewer's preview goes stale (found in the M86 manual test, 2026-11-13).** Observed: with `controls-sd-logger` running, the Controls Editor's SD Card section opened `actions.txt` before any control was moved, while the file held one line. As the file grew to 233 B and 20 lines, the list showed the new size but the expanded preview still showed `1 session start`; the file opened in the editor showed the real content. Pressing nothing refreshes the viewer while the effect runs, and even the Refresh button keeps the cached preview. Expected: the viewer follows the card while the effect runs, an expanded file shows its current content, and a long file scrolls inside the viewer.

## First public preview — README polish (2026-11-13)

Source: owner request while working through `docs/release_plan.md` ("let's do the README polish").

- **README polish.** The README is the Marketplace page and the first thing a visitor to the repo reads. It still describes an early version (pots and buttons only; the old Build → Deploy → Start Audio flow; install from a `.vsix` only; no MIDI, OLED, SD card, encoder, toggle, RGB LED or input generators; no examples; no known issues; developer-only sections mixed in). Bring it up to date for the first public preview: a preview notice, what it is, prerequisites, quick start, features, known issues and limits, where to send feedback. Screenshots: keep the existing three and list the ones still to take (the owner takes them).

## First public preview — licensing (2026-11-13)

Source: owner request while working through `docs/release_plan.md` (how to fix the images access issue led to reviewing the licence).

- **Relicense the project.** Change the licence to one that allows everything for non-commercial use, with commercial use needing an agreement with the owner. After discussion the owner chose the line "only the IDE itself is restricted": anyone may use Daisy IDE for anything, including developing and selling their own effects, but selling, bundling, hosting or otherwise competing with the IDE itself needs a commercial agreement. Licence chosen: **PolyForm Shield 1.0.0**. Contact route for commercial agreements: the GitHub issues page (with a dedicated issue template), kept in the README rather than in the licence text.
- **Finding that prompted the work.** The repo's `LICENSE` file is GPL-3.0 (from the initial commit) while `package.json` and `LICENSES.md` say MIT; and one outside contribution exists (PR #1, test-only, Windows test fixes), which GitHub's terms license under the repository's licence, GPL-3.0.

## First public preview — remaining release work (2026-11-14)

Source: `docs/release_plan.md`, the items still open after M85 to M88, grouped by the owner's request to "move forward with the intake of the remaining tasks needed for the release".

- **First-run polish, part two.** Missing-prerequisite checks that give a clear, actionable message instead of a silent or cryptic failure (C++ compiler / Xcode Command Line Tools, `lldb-dap`, Arm toolchain, `dfu-util`); a `Makefile` pre-check for Build for Hardware, which today fails with "No targets specified and no makefile found"; Deploy to Emulator right after opening a window failing with "Build before deploying" although a build exists; `engines.vscode` claiming `^1.85.0` when only 1.140 has been exercised (and the native MIDI addon is built for that Electron).
- **Marketplace readiness.** Review the package metadata (display name, description, categories, keywords, icon, gallery banner, `preview` flag); write issue templates; a pre-publish check that every URL in the packaged README resolves anonymously; a checklist for making the repository public; tidy the repository before it is public.
- **The release itself.** Version `0.25.0` with `"preview": true` (owner decision, 2026-11-14: odd minor for a Marketplace pre-release); changelog; the full verification on the release commit including the e2e and emulator suites and a clean-profile walk-through; tag and push; guided publish (publisher account, token, `vsce publish --pre-release`, verify, Open VSX decision, announce).
- **Decisions taken in this intake.** Keep both command sets (the legacy step-by-step commands and Run, Debug, Stop Daisy Effect), documented in the README: no code change. The "missing DaisySP" UX item is superseded by FR-EXM-1 (the bundled fallback removes the case it was for) and is not scheduled.
