# 01 — Input Ideas (v20)

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

## Ideas received

- **Bundle DaisySP with the extension and auto-provision it into new projects** (feature idea, 2026-08-27, raised during evaluation of the manual-symlink DaisySP workaround). Today, effects that need DaisySP (`#include "daisysp.h"`) require the user to manually create a symlink into the project pointing at a DaisySP checkout elsewhere on disk — and the Effect Project Wizard's own generated template (`create-effect-project.ts`) already hardcodes that include, so nearly every new project hits this immediately with no provisioning story at all. Two provisioning options were discussed (bundle a pinned copy with the extension vs. download-on-demand into a `~/.ds-ide` cache); design discussion concluded parity with the project's eventual hardware build matters more than offline/simplicity — `detectDaisySP()` (`src/commands/build.ts`) already correctly prefers a project-local DaisySP (including one reached via symlink) when one exists, so the real gap is narrower than first framed: provisioning is only needed as a *fallback* for projects with no DaisySP anywhere yet. Decided scope for this idea: wizard-time only (not build-time lazy detection — that's explicitly deferred to a later idea), fallback source is a DaisySP copy bundled with the extension, **copied** (not symlinked) into the new project at creation time. Symlinking to `<extensionPath>/DaisySP` was ruled out — `extensionPath` is not stable across ds-ide upgrades/reinstalls (same class of bug `FR-PKG-2`/M59 just fixed for the CMake build cache), so a symlink would silently break or repoint after an extension update.

- **Daisy Seed memory-budget tooling** (feature idea, 2026-08-28, raised as a 4-part analysis question: can effect size be estimated from the emulator and/or hardware build; can the user be alerted when an effect exceeds available memory; can the Makefile be auto-updated to escalate the memory "layout" (`APP_TYPE`) if the user agrees; what else is useful here). Revisits a gap named as early as v1 planning (`docs/v1/02_assumptions-and-risks.md` R1: native sim verifies correctness, not the Seed's real-time CPU/RAM budget; the v1-era mitigation was "hardware flash is the periodic reality check," i.e. deliberately left untooled) and still asserted as a non-negotiable in `docs/00_north-star.md` ("Honest fidelity... 'Runs in ds-ide' ≠ 'fits on hardware'"). Grounding found during the analysis: the **emulator build cannot give a meaningful size estimate** — it's a host-native recompile (different compiler/ISA/stdlib, no linker memory regions) with no reliable correlation to STM32 firmware footprint, so any "fits on hardware" claim must come from a real hardware build, never the emulator. The **hardware build path already exists** (`buildForHardware()` in `src/commands/hardware-build.ts`, shipped v2/M8–M15) and already streams the real arm-none-eabi linker's post-link memory-region table (`FLASH:`/`SRAM:`/`QSPIFLASH:`/`SDRAM:`/etc.) on every successful build — today that output is only regexed for `error|warning|note` compiler diagnostics (`build-diagnostics.ts`) and the region table itself is discarded unparsed, so surfacing it is additive parsing work, not new data collection. **Scoping resolved via `/doc-creator-driver:intake` + `grill-me`, 2026-08-29** — split into three parts:
  1. **In scope now, → M61** (see `03_requirements.md` FR-HW-5, `04_architecture.md`, `docs/milestones/v20/Milestone_M61.md`): parse the region table on every hardware build; on a build that fails from a linker region overflow, surface it clearly instead of today's generic "make exited with code N" (the overflow line's format isn't caught by `build-diagnostics.ts`'s `file:line:col` regex, so it's currently silently lost); on a successful build, print the full table and warn if any region is ≥75% used; new `ds-ide.hardwareVariant` setting (`'base' | '65mb-sdram'`, resource-scoped, default `'base'`) resolves sub-problem (a) above, prompted at Effect Project Wizard time and written into the new project's `.vscode/settings.json`, with existing/imported projects defaulting to `'base'` and settable manually; a hard error (regardless of %-used) if `hardwareVariant='base'` and the SDRAM region shows any usage, since the linker sizes that region generically and doesn't know the physical board lacks the chip.
  2. **Deferred — future idea (APP_TYPE auto-escalation group):** `APP_TYPE` auto-escalation with a confirm-with-diff Makefile-write flow (sub-problem b), bootloader-state detection via `program-boot` as a prerequisite check (sub-problem c), and DFU flash-address rework in `dfu-flash.ts` since `APP_TYPE` changes the flash target address and today's `flashToHardware()` hardcodes it (sub-problem d) — grouped with the Effect Project Wizard pre-set idea (ask up front whether a new effect is delay/reverb/looper-class vs. filter/oscillator-class and pre-set `APP_TYPE`/variant accordingly) since all four share the same Makefile/APP_TYPE surface. Not yet given a milestone or full design pass.
  3. **Deferred — separate future idea:** a persistent per-region budget sidebar panel (styled like Scope/Controls/Wiring) as a nicer alternative to the M61 output-channel/notification delivery; build-to-build region-usage regression tracking (diff against the last successful hardware build); an SDRAM correctness lint (`DSY_SDRAM_BSS` declarations with non-trivial constructors or pre-`Init()` buffer use); real-time-callback stack-usage estimation (`-fstack-usage`/`.su` parsing), flagged as a harder problem since stack overflow in the audio callback is invisible to both the emulator and the region table. Not yet given a milestone or full design pass.

## Bugs received

- **Extension Development Host prints a Node `[DEP0169] DeprecationWarning: url.parse()` warning at ds-ide startup** (human-driven test finding, M60 sprint-close, 2026-08-28; formally intaked as a bug report, 2026-08-28). Observed: launching the extension from VS Code (F5 / Extension Development Host) prints `(node:PID) [DEP0169] DeprecationWarning: url.parse() behavior is not standardized...` to the console. **Status: resolved — confirmed external to ds-ide, no code fix.** Investigation: `url.parse`/`require('url')` does not appear anywhere in ds-ide's own `src/`, nor in its one runtime dependency `midi` or midi's transitive deps (`bindings`, `file-uri-to-path`) — the only three packages ds-ide's own code exercises at runtime. Extension Host logs captured during the M60 human-driven test session show the warning firing immediately after VS Code's built-in `git`/`github`/`github-authentication`/`emmet` extensions eager-activate (`activationEvent: '*'`/`onLanguage`), and *before* `daisy-ide.ds-ide` itself ever activates (`ds-ide` only activates later, on-demand, via `onCommand:ds-ide.createNewEffectProject`) — i.e. the warning is emitted during generic Extension Host bootstrap, before any ds-ide code has run. Conclusion: this is Node/Electron or built-in-VS Code-extension noise, sharing the same Extension Host process ds-ide also runs in, not a ds-ide defect. No milestone, requirement, or release was created for this — there is nothing in ds-ide's own code to change.
