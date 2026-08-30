# 02 — Assumptions & Risks (v21)

> **All prior versions complete** — full bet/risk history in their respective archives.
> **v20 complete** — all v20 bets held; risks resolved or managed.
> Archived: [`docs/v20/02_assumptions-and-risks.md`](v20/02_assumptions-and-risks.md).

*v21 bets and risks to be defined during planning.*

---

## v21 Risks

> ⚠️ ASSUMPTION (revealed false by the M62 bug intake, 2026-08-30): it was assumed that adding
> a new emulator-emitted IPC message type reliably meant updating both ends of the pipeline
> (emulator emission + webview consumer) *and* the `NARROWERS` schema whitelist in
> `src/ipc/narrow.ts` (FR-IPC-2's validation boundary). In practice, the MIDI monitor feature
> (FR-DEV-18, M47/v14) added the first two but never the third, and nothing caught the gap —
> the message is simply dropped at runtime with a console warning, no build or test failure.
> **Risk:** the same class of bug can recur for any future IPC message type. No test currently
> asserts that every `type` value emitted by the emulator (grep `ipc_server.cpp`/shim sources
> for `\"type\":\"...\"`) has a corresponding `NARROWERS` entry. Consider adding such a
> cross-check as a follow-up if this recurs a second time.

> ⚠️ ASSUMPTION (FR-TEST-1, manual test tracker, 2026-08-30): a hand-edited static HTML page
> with no JS-driven persistence and no required change-history is sufficient for tracking
> manual test status. **Risk:** since status edits aren't enforced or reviewed by tooling, a
> stale `success` status from a prior run could go unnoticed if a test isn't actually re-run
> after a relevant change — this tracker relies entirely on developer discipline, same as any
> manual checklist. Accepted for now per explicit user decision; revisit only if this proves
> insufficient in practice.

> ⚠️ ASSUMPTION (FR-TEST-2, functional/e2e test layer, 2026-08-30): `@vscode/test-electron`
> gives real extension-host integration coverage (activation, `vscode.commands`, real IPC to a
> real spawned emulator process) but cannot drive DOM content inside webview iframes — that
> needs the heavier `vscode-extension-tester` (WebDriverIO), deliberately deferred to a future
> milestone (see scope decision below). **Risk:** roughly half the manual-tracker's 16 cases
> (anything requiring visual/DOM assertions inside a webview — pot dragging, scope/spectrum
> rendering, OLED framebuffer, wiring-editor pin-conflict highlighting) stay manual-only until
> that follow-up milestone happens; this milestone alone does not reduce the manual tracker's
> size as much as it might look like from the outside.
> There is currently no CI pipeline in this repo (no `.github/workflows/`) — `npm test` (vitest)
> and the new e2e layer both run locally only. Headless-Electron CI concerns (xvfb on Linux,
> etc.) are out of scope until a CI pipeline is actually introduced.
