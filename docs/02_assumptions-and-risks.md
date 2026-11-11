# 02 — Assumptions & Risks (v25)

> **All prior versions complete** — full bet/risk history in their respective archives.
> **v23 complete** — all v23 bets held; risks resolved or managed.
> Archived: [`docs/v23/02_assumptions-and-risks.md`](v23/02_assumptions-and-risks.md).
>
> **v24 complete** — all v24 bets held; risks resolved or managed.
> Archived: [`docs/v24/02_assumptions-and-risks.md`](v24/02_assumptions-and-risks.md).

## First public preview (workspace trust, missing CMake)

> ⚠️ ASSUMPTION: declaring `capabilities.untrustedWorkspaces: { supported: false }` makes VS Code show the standard "this extension requires a trusted folder" prompt and disable the extension cleanly in Restricted Mode. Observed in the fresh-profile test without any declaration: the activity-bar icons were missing but the "Focus Controls Editor" command still ran, so the exact behaviour of each declaration value (`false` vs `limited`) is not yet verified — verify in a clean profile after the change.

> ⚠️ ASSUMPTION: falling back to known install locations for `cmake` (`/opt/homebrew/bin`, `/usr/local/bin`) is safe — it can only select a CMake the user already installed, and `PATH` still wins. Risk: it may pick a different CMake than the user's shell would; low, accepted.

> ⚠️ ASSUMPTION: every `cmake` failure to *start* (ENOENT) means CMake is not installed or not reachable; failures after it started are build errors and stay on the existing diagnostics path.

*Other v25 bets and risks to be defined during planning.*
