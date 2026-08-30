# 03 — Requirements (v21)

> **v20 complete** — all v20 requirements implemented; ACs green.
> Archived: [`docs/v20/03_requirements.md`](v20/03_requirements.md).

*v21 requirements not yet fully defined; the following was backported from v14 after a bug
intake found it violated (see `docs/archived-doc-access-log.md`, 2026-08-30).*

---

## v21 Requirements

**FR-DEV-18 — MIDI I/O surface.** An on-screen keyboard and message monitor, plus a host MIDI
bridge on macOS.

> ⚠️ ASSUMPTION: this requirement was implemented (M47, v14) but has a known gap — the IPC
> schema-validation boundary added later (FR-IPC-2, `src/ipc/narrow.ts`) never had `midiRx`/
> `midiTx` narrowers added to it, so the message monitor never receives any MIDI events. See
> the M62 bug-fix task in the v21 milestone registry below.

**FR-TEST-1 — Manual test tracker.** A single standalone HTML page, hand-edited (no build
step, no JS-driven persistence), at `src/test/manual/manual-tests.html`, listing manual test
cases to run after each implementation — specifically covering use cases that are hard to
validate with unit tests (e.g. real audio I/O, hardware build/flash, webview rendering,
wiring/pin conflict UX). Each entry records: title, short description, steps to perform,
expected result, and a status of `pending` | `success` | `fail`. Ships pre-populated with an
initial set of real test cases surveying ds-ide's existing hard-to-unit-test areas, not just an
empty template. Status edits are hand-made directly in the file and are not required to carry
a change-history — a plain static page is intentionally sufficient.

**FR-TEST-2 — Functional/e2e test layer (foundation).** Add `@vscode/test-electron`-based
integration tests that run against a real VS Code extension host — real activation, real
`vscode.commands` dispatch, real IPC round-trips to a real spawned emulator process — as a
layer distinct from vitest's mocked-`vscode`-module unit tests. Scope for this requirement is
the foundation layer only: cases that don't require driving DOM content inside a webview
iframe (extension activation, command registration, build-for-emulator/build-for-hardware
command execution, IPC message round-trips, DFU-flash command flow with a mocked toolchain).
Cases that do require webview-DOM interaction (on-screen pot dragging, scope/spectrum canvas
assertions, wiring-editor pin-conflict highlighting, OLED framebuffer rendering) are explicitly
out of scope — they need the heavier `vscode-extension-tester` (WebDriverIO-based, can drive
into webview iframes) and are deferred to a future milestone.
