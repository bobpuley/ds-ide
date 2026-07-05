# 02 — Assumptions & Risks (v13)

> **All prior versions complete** — full bet/risk history in their respective archives.
> **v12 complete** — all v12 bets held; risks resolved or managed.
> Archived: [`docs/v12/02_assumptions-and-risks.md`](v12/02_assumptions-and-risks.md).

## v13 Bets & Risks

Derived from the 2026-07-02 code review findings (see `01_input-ideas.md`). Items marked `> ⚠️ ASSUMPTION:` flag assumptions held in prior versions but revealed as incorrect by this review.

---

### Risks carried into v13

**Risk: RT-safety regression on future shim/engine additions**
Any new shim function or engine code path that touches the RT thread could reintroduce a blocking, allocating, or relaxed-atomic pattern if the fixes in M36 aren't documented as the required template (this is the same class of risk flagged in v9 for `emit_led_change`, now recurring for the replay and recorder paths).
**Mitigation:** Document the SPSC-queue-only / acquire-release pattern in `emulator/runtime/README.md` or inline on the fixed functions; keep TSAN/ASAN CI coverage exercising both recording and replay workloads.
