# 02 — Assumptions & Risks (v20)

> **All prior versions complete** — full bet/risk history in their respective archives.
> **v19 complete** — all v19 bets held; risks resolved or managed.
> Archived: [`docs/v19/02_assumptions-and-risks.md`](v19/02_assumptions-and-risks.md).

*v20 bets and risks to be defined during planning.*

---

> ⚠️ ASSUMPTION: a DaisySP copy bundled with the ds-ide extension and vendored into new projects at creation time (bundled-DaisySP idea, 2026-08-27) stays reasonably current without an explicit maintenance process. In reality the vendored version is pinned to whatever was current when the extension itself was last updated — with no cadence defined for bumping it, projects scaffolded far apart in time (or against an old, unmaintained extension install) could end up on a stale DaisySP indefinitely, with no signal to the user that a newer version exists.

> ⚠️ RISK: console warnings/errors observed in the Extension Development Host during human-driven testing can be mistaken for a ds-ide defect even when they originate entirely outside ds-ide's own code (VS Code/Electron internals, a built-in extension sharing the same Extension Host process). Confirmed with a real case, 2026-08-28: a Node `[DEP0169] url.parse()` deprecation warning surfaced during M60 human-driven testing, was initially reported as a security-flavored bug (the warning's own text mentions "security implications"), and cost a genuine multi-round investigation (checking `src/`, runtime deps, Extension Host activation-order logs) before being confirmed as pre-ds-ide-activation Extension Host bootstrap noise, unrelated to this project. No mitigation implemented — noted here so a future session hitting the *same* warning can check this file (and the resolved entry in `01_input-ideas.md`) before re-investigating from scratch; a genuinely new/different console warning would still need its own investigation.

> ⚠️ ASSUMPTION: a flat 75%-used warning threshold (M61, FR-HW-5, memory-budget alerting) is applied uniformly across all linker-reported memory regions despite them spanning very different sizes (e.g. `RAM_D2_DMA` at 32 KB vs. `QSPIFLASH` at ~7936 KB). A single small allocation can cross 75% on a tiny region in one build, producing a warning disproportionate to actual overflow risk on that region specifically, while the same absolute growth on a large region like `QSPIFLASH` stays far below threshold. No per-region threshold tuning implemented for M61 — if the flat threshold proves noisy in practice (e.g. frequent spurious warnings on `RAM_D2_DMA` or `DTCMRAM`), revisit with per-region thresholds informed by real usage.
