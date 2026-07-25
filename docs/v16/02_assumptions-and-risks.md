# 02 — Assumptions & Risks (v16)

> **All prior versions complete** — full bet/risk history in their respective archives.
> **v15 complete** — all v15 bets held; risks resolved or managed.
> Archived: [`docs/v15/02_assumptions-and-risks.md`](v15/02_assumptions-and-risks.md).

## v16 risks

> ⚠️ ASSUMPTION (gap, not previously identified): M47/FR-DEV-18's "known limitation" for the host
> MIDI bridge's native addon (`docs/v14/02_assumptions-and-risks.md`) only flagged platform/arch
> mismatch — the prebuilt `.node` binary only working on whatever OS/arch ran `npm install`. It
> did not anticipate that the *same* machine/arch can also break: `midi`'s addon uses NAN, which
> is not ABI-stable across Node.js versions, so any VS Code update that bumps its bundled
> Electron/Node.js `NODE_MODULE_VERSION` silently breaks the addon until it's rebuilt — even with
> no extension update at all. `host-bridge.ts`'s existing try/catch degrades this to a console
> warning rather than a crash (the same mitigation that covered the arch-mismatch case), but the
> bridge itself stays unavailable until a rebuild happens. Tracked as M51 (FR-DEV-19).
