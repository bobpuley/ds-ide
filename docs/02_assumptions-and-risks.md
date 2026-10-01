# 02 — Assumptions & Risks (v24)

> **All prior versions complete** — full bet/risk history in their respective archives.
> **v23 complete** — all v23 bets held; risks resolved or managed.
> Archived: [`docs/v23/02_assumptions-and-risks.md`](v23/02_assumptions-and-risks.md).

## Reachability — M73 (intake 2026-10-01)

- **Bet:** the five show/focus commands are enough to recover any closed surface; no panel-open-state tracking (`panelState`, "Open" vs "Focus" label) is needed in this milestone. It stays deferred with `design_plan.md` §5.3.
- **Decision:** *Show Scope* with no emulator running opens the Scope in its idle state (existing onboarding hint) and fills when the next run starts. It never triggers a build.
- **Risk — walkthrough rot:** walkthrough steps name commands and views; a rename would silently break them. Mitigated by FR-RCH-4, whose lint also checks the walkthrough's command links.
- **Risk — silent loss on auto-save:** removing the explicit save removes the user's chance to discard a layout. Mitigated by the existing `controllers.yaml` being a plain, version-controlled file.
> ⚠️ ASSUMPTION: `contributes.walkthroughs` is shown by VS Code on the Welcome page after install without extra activation code; to be confirmed on a clean profile during the manual test.
