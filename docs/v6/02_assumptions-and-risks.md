# 02 — Assumptions & Risks (v6)

> **All prior versions complete** — full bet/risk history in their respective archives.
>
> **v4 complete** — all v4 bets (A17–A20) held; risks R21–R25 resolved or managed.
> Archived: [`docs/v4/02_assumptions-and-risks.md`](v4/02_assumptions-and-risks.md).
>
> **v5 complete** — all v5 bets (A21) held.
> Archived: [`docs/v5/02_assumptions-and-risks.md`](v5/02_assumptions-and-risks.md).

## A22 — GPIO pin namespace (M25 / GPIO-ALIAS)

> ⚠️ ASSUMPTION (FALSIFIED): The shim assumed `pin.pin` alone uniquely identifies a GPIO slot. This was false: libDaisy analogue pins A6–A11 have `pin.pin = 0..5`, aliasing digital pins D0–D5. The fix (FR-QS-9 / AC-48) is tracked in M25.

*Additional v6 bets and risks to be defined during planning.*
