# Archived Doc Access Log

Track every instance where an agent consulted `docs/v1/` or `docs/raw/v1/`. Open entries are reviewed at the start of each new session and either closed as exceptional or backported to the appropriate root doc.

## Format

| Date | What was needed | Archived file consulted | Should have been in | Status |
|------|----------------|------------------------|---------------------|--------|
| YYYY-MM-DD | brief description | docs/v1/... | docs/0X_... | open / resolved: \<outcome\> |

## Log

| 2026-06-21 | Existing FR-CE-* and FR-WE-* IDs for Controls Editor and Wiring Editor bug triage (v7 first intake after version reset) | `docs/v3/03_requirements.md`, `docs/v4/03_requirements.md` | `docs/03_requirements.md` | resolved: backported to docs/03_requirements.md (FR-CE-9, FR-WE-11, FR-WE-12 added) |
| 2026-08-30 | Original wording of the MIDI I/O surface requirement, for a v21 bug intake against the MIDI monitor panel (dropped `midiRx`/`midiTx` IPC messages) — v21's `03_requirements.md` is empty since v21 planning had not started | `docs/v14/03_requirements.md` (FR-DEV-18) | `docs/03_requirements.md` | resolved: backported to docs/03_requirements.md (FR-DEV-18 re-added, noted as violated) |
| 2026-08-31 | Rationale for `src/midi/host-bridge.ts`'s macOS-only gate, for a user question during a Windows-portability survey — current `docs/02_assumptions-and-risks.md` is an empty v22 seed | `docs/v14/02_assumptions-and-risks.md` (macOS-first MIDI bridging bet), `docs/v16/02_assumptions-and-risks.md` (native addon ABI-stability gap, M51/FR-DEV-19) | `docs/02_assumptions-and-risks.md` | resolved: exceptional — per-version assumptions docs are intentionally archived on version reset; this was reading historical rationale, not filling a gap in current planning |
