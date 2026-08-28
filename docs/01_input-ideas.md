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

## Bugs received

- **Extension Development Host prints a Node `[DEP0169] DeprecationWarning: url.parse()` warning at ds-ide startup** (human-driven test finding, M60 sprint-close, 2026-08-28). Observed: launching the extension from VS Code (F5 / Extension Development Host) prints `(node:PID) [DEP0169] DeprecationWarning: url.parse() behavior is not standardized...` to the console. Not reproduced by grepping ds-ide's own source or the runtime deps M60 touches (`file-uri-to-path`, `bindings`, `midi`) for `url.parse` — likely originates from VS Code's own Electron/Node internals or another extension sharing the same host process, not ds-ide's own code, but unconfirmed. User believes it predates this sprint (v19 or earlier) rather than being introduced by M60; not investigated further or triaged to a root cause yet.
