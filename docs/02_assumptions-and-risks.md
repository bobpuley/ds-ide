> **v22 complete** — archived to `docs/v22/` on 2026-09-30. This file now seeds v23 planning.

# 02 — Assumptions & Risks (v23)
> **All prior versions complete** — full bet/risk history in their respective archives.
> **v22 complete** — all v22 bets held; risks resolved or managed.
> Archived: [`docs/v22/02_assumptions-and-risks.md`](v22/02_assumptions-and-risks.md).

## Scope as an instrument (intake 2026-09-30, M70–M72)

### Bets

- **B1 — Most of the instrument needs no emulator change.** Axes, gain, dBFS scale, freeze,
  cursor, meters, stereo, trigger and spectrum scaling are all computed from the samples the
  webview already receives, so M70–M71 ship without touching the real-time audio path. Only
  accurate zoom and a true single-shot (M72) need emulator-side capture.

### Assumptions

> ⚠️ ASSUMPTION: Consecutive `scope` messages are contiguous in time. The drain thread
> accumulates every popped block into the next snapshot and resets on emit, so absent a dropped
> block (SPSC overflow, config-generation discard) the webview can stitch snapshots into one
> longer capture. There is no timestamp on the message to prove it; a discontinuity shows as a
> small glitch at the seam.

> ⚠️ ASSUMPTION: The scope stream is uniformly decimated by `step = 4 × max(1, frames / 256)`
> (`ScopeState::accumulate`), so the effective sample rate is `sampleRate / step`. The webview
> cannot derive `step` reliably from `blockSize` alone, so the `scope` message gains a `step`
> field (FR-SCI-2).

> ⚠️ ASSUMPTION: One snapshot spans `33 × frames` frames. At a 4-frame block that is about
> 2.75 ms (33 points), too short for a 2 ms/div × 10 division view. The webview capture ring
> (FR-SCI-3) accumulates several snapshots so the usable window does not depend on block size.

> ⚠️ ASSUMPTION: CSV is enough for sample export in this version. WAV export (useful for the
> future null test, `design_plan.md` §6.B-3) is deferred.

> ⚠️ ASSUMPTION: The event history stays inside the Scope panel for now. It overlaps the
> run-state view proposed in `design_plan.md` P1-5 and may move there later.

### Risks

- **R1 — A webview trigger can miss transients (M71).** A trigger evaluated on snapshots only
  sees what a snapshot contains; a click falling between two snapshots after a dropped block is
  lost, and single-shot is best-effort. Mitigation: label single-shot as best-effort in the UI
  until M72 adds emulator-side capture; M72 is the planned fix.
- **R2 — Decimation limits fine time bases.** At the default 48 kHz and 256-frame blocks the
  effective rate is 12 kHz, so a 0.5 ms/div view shows about 6 points per division and cannot
  show content above 6 kHz. Mitigation: show the effective rate next to the time base and hide
  or flag time bases that have fewer than ~20 points per division; M72 restores full rate.
- **R3 — Redraw cost.** A longer ring, three traces, auto-gain and the spectrum on one frame
  budget can make the panel sluggish. Mitigation: keep the existing `raf-coalesce.ts` path, run
  the spectrum at a lower cadence than the scope, and cap points drawn per pixel column.
- **R4 — Scope message size.** Adding `out_r` to the wire format already fits: the emulator
  already serialises it and sizes `SCOPE_SAMPLES_MAX` for three channels. Adding `step` is one
  number. No `MAX_MSG` change needed.

