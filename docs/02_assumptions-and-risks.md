> **v27 complete** — archived to `docs/v27/` on 2026-11-23. This file now seeds v28 planning.

# 02 — Assumptions & Risks (v28)

> **All prior versions complete** — full bet/risk history in their respective archives.
> **v23 complete** — all v23 bets held; risks resolved or managed.
> Archived: [`docs/v23/02_assumptions-and-risks.md`](v23/02_assumptions-and-risks.md).
>
> **v24 complete** — all v24 bets held; risks resolved or managed.
> Archived: [`docs/v24/02_assumptions-and-risks.md`](v24/02_assumptions-and-risks.md).
>
> **v25 complete** — all v25 bets held; risks resolved or managed.
> Archived: [`docs/v25/02_assumptions-and-risks.md`](v25/02_assumptions-and-risks.md).
>
> **v26 complete** — all v26 bets held; risks resolved or managed.
> Archived: [`docs/v26/02_assumptions-and-risks.md`](v26/02_assumptions-and-risks.md).
>
> **v27 complete** — all v27 bets held; risks resolved or managed.
> Archived: [`docs/v27/02_assumptions-and-risks.md`](v27/02_assumptions-and-risks.md).

## Review fixes — M93–M95 (intake 2026-11-23)

Source: HIGH findings of the 2026-11-21 code reviews (`docs/06_*_review.md`).

> **Assumption disproved (review 2026-11-21):** "LED and MIDI output have a single producer, the effect's `while(1)` thread" (the basis of the FR-EMU-9 fix). Valid Daisy effects call `Led::Update`, `SetLed` and `SendMessage` from the audio callback as well, so these queues see two producers. Replaced by FR-EMU-13: LEDs as latest-state atomics, MIDI as a multi-producer stream.

> **Assumption disproved (review 2026-11-21):** "passing the device's full frame count to the effect is correct for emulation" (comment in `audio_engine.cpp`). On hardware the callback always gets exactly `SetAudioBlockSize()` frames, and effects depend on it for timing and buffer sizes. Replaced by FR-EMU-12: re-block to the configured size; the large device buffer stays.

> ⚠️ ASSUMPTION: the HIGH findings are reproducible as described; each fix starts with a failing test that reproduces the finding, and a finding that cannot be reproduced is reported back to the owner rather than fixed blind.

> ⚠️ ASSUMPTION: TSAN runs reliably on the macOS (Apple Silicon) native test build in CI; if it does not, the M95 stress tests run locally and the CI job runs them without TSAN.

> **Risk — the re-blocking adapter changes timing every effect sees.** Effects that worked by accident with large blocks may behave differently after FR-EMU-12. Mitigation: the bundled examples are run manually in the emulator at block size 48 before M94 closes; CHANGELOG states the change.
