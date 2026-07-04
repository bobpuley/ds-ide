# 02 — Assumptions & Risks (v12)

> **All prior versions complete** — full bet/risk history in their respective archives.
> **v11 complete** — all v11 bets held; risks resolved or managed.
> Archived: [`docs/v11/02_assumptions-and-risks.md`](v11/02_assumptions-and-risks.md).

## v12–v13 Bets & Risks

Derived from the 2026-07-02 code review findings (see `01_input-ideas.md`). Items marked `> ⚠️ ASSUMPTION:` flag assumptions held in prior versions but revealed as incorrect by this review.

---

### False assumptions revealed by the review

> ⚠️ ASSUMPTION (now invalidated): A same-user local UNIX-socket IPC channel between two processes we control does not need input validation, since both ends are "our own code."

**Revealed by:** MEDIUM findings across both C++ and TS reviews — hand-rolled `json_get` substring key matching, unescaped output injection, and unvalidated IPC JSON spread wholesale into webview `postMessage` calls that reach an `innerHTML` sink.
**Correction:** Treat the IPC boundary as untrusted in both directions: a version-skewed emulator build mid-refactor, a malformed line, or an unexpected field shape must degrade gracefully, not corrupt state or crash the receiver.
**Resolution:** M38 (v12, emulator JSON), M39 (v12, IPC schema validation + webview field whitelisting).

---

### Risks carried into v12–v13

**Risk: RT-safety regression on future shim/engine additions**
Any new shim function or engine code path that touches the RT thread could reintroduce a blocking, allocating, or relaxed-atomic pattern if the fixes in M36 aren't documented as the required template (this is the same class of risk flagged in v9 for `emit_led_change`, now recurring for the replay and recorder paths).
**Mitigation:** Document the SPSC-queue-only / acquire-release pattern in `emulator/runtime/README.md` or inline on the fixed functions; keep TSAN/ASAN CI coverage exercising both recording and replay workloads.

**Risk: IPC schema validation (M39) is a cross-cutting refactor touching every webview message handler**
Extending `narrow.ts` and switching from `...msg` spreads to whitelisted fields touches `ipc-client.ts`, `scope-panel.ts`, `controls-editor-panel.ts`, and all three webview scripts simultaneously — the largest coordinated TS change in this batch, with real risk of missing a field a webview silently depended on.
**Mitigation:** Land M39's schema/narrowing change together with removing `@ts-nocheck` from the webviews (same milestone) so the compiler catches any field a webview still needs but the new whitelist omitted.
