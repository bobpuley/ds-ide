> **v22 complete** — archived to `docs/v22/` on 2026-09-30. This file now seeds v23 planning.

# 04 — Architecture (v23)
> **v22 complete** — full v22 architecture in
> [`docs/v22/04_architecture.md`](v22/04_architecture.md).

## Scope as an instrument (intake 2026-09-30, M70–M72)

Requirements: `FR-SCI-*`. Layout reference: `docs/mockups/v22-scope-instrument.html`.

**Confirmed layout (2026-09-30, `docs/mockups/v22-scope-instrument.html`):** the spectrum stays
below the scope and always visible; the meters are a 132 px right-hand column (not an overlay);
export is CSV only (WAV deferred to a future null-test feature); the event history lives in the
Scope panel for now (it may move to a run-state view, `design_plan.md` P1-5).

**Stance:** M70–M71 leave the emulator's real-time path alone. The only emulator edit is one
additive field in the scope JSON (`step`); everything else is webview code, split into pure
modules that unit-test without a DOM.

**IPC change (FR-SCI-2).** `build_scope_json()` (`emulator/runtime/audio_engine.cpp`) adds
`"step"`; `narrow.ts`'s `scope` narrower forwards `out_r` and `step` as optional fields, so an
older emulator still narrows. `ScopeMsg` in `src/webview/messages.ts` gains the two fields.

**Capture ring (FR-SCI-3).** `src/webview/scope-capture.ts` (new, pure): appends each snapshot
to a fixed-length ring per channel, tracks the effective sample rate, and is cleared on restart
or sample-rate / block-size change. Consecutive snapshots are assumed contiguous (see
`02_assumptions-and-risks.md`).

**Pure modules (new, `src/webview/scope/`).**

| Module | Responsibility | FR |
|---|---|---|
| `scope-capture.ts` | ring buffer, effective rate, clear-on-config | FR-SCI-3 |
| `scope-view.ts` | time base → sample window, gain / auto-gain, linear / dBFS mapping | FR-SCI-4, 5 |
| `scope-trigger.ts` | find the first crossing (free / rise / fall) in a window | FR-SCI-9, 10 |
| `scope-meters.ts` | peak, RMS, peak-hold, latched clip, headroom | FR-SCI-8 |
| `scope-spectrum-scale.ts` | Lin / Log frequency mapping, relative / absolute dB | FR-SCI-11 |
| `scope-export.ts` | CSV text for the visible window | FR-SCI-12 |
| `scope-events.ts` | bounded event log (200 entries) | FR-SCI-13 |

`scope-webview.ts` stays the DOM / canvas layer and calls these; `scope-panel.ts` adds the
controls bar markup. Canvas colours keep coming from `readThemeColor()`, with two new tokens
(`--ds-trace-outr`, `--ds-warn`) added to `themeCss` and `ScopeColors`; the theme guard test
(FR-THM-6) stays green.

**Performance.** Redraws stay on `raf-coalesce.ts`; the spectrum redraws at a lower cadence than
the scope; points per pixel column are capped. Meters and auto-gain read the most recent 2048
samples, not the whole ring.

**Snapshot / export.** PNG: composite the two canvases into an offscreen canvas and post the
bytes to the extension, which shows a save dialog and writes the file (VS Code's `env.clipboard`
is text-only, so there is no clipboard-image path). CSV: webview builds the text and posts it;
the host shows a save dialog.

**M72 — emulator capture (FR-SCI-14, decided 2026-09-30).** The drain thread in
`run_audio_engine()` already receives every full-rate block through `ScopeBlockQueue`; it also
feeds a new pure class `ScopeCapture` (`emulator/runtime/scope_capture.h`, header-only, unit-tested
standalone): three float rings of 16384 frames, `arm(request)` / `cancel()`, and
`push(in, out, frames)`, which returns a window once the trigger has fired and the post-trigger
samples have arrived (default window 4096 frames, trigger at frame 1024). The RT callback, the
SPSC queue and its contract are untouched. The ring is cleared with `scope`/`fft` on a mode or
config-generation change.

*IPC.* Request (host → emulator): `{"type":"scopeCapture","action":"arm","source":"in"|"l",
"edge":"rise"|"fall","level":<-1..1>}` or `{"action":"cancel"}`. `dispatch()` stores the request
in a mutex-guarded slot that the drain thread polls (non-RT; never on the audio thread). Reply:
`{"type":"scope_capture","in":[…],"out":[…],"out_r":[…],"rate":<Hz>,"trigger":<index>}`, sent once
per armed request; the emulator disarms after replying. The window is a fixed 4096 frames and is sent
through `drain_send()` (the drain thread's direct socket path), so it is not bound by the SPSC
queue's `MAX_MSG`. `narrow.ts` gains a `scope_capture` narrower; `ScopeMsg`-style
`ScopeCaptureMsg` goes to the webview. Emulator and extension ship together, so no old-emulator
fallback is provided.

*Webview.* A pure `scope-capture-source.ts` decides when to request (1× Single armed; or an edge
trigger with a low-resolution time base, throttled to ~5 requests/s and re-armed after each
reply) and when to draw a full-rate window instead of the decimated ring. `scope-webview.ts`
posts the request through the host and draws the reply with the existing view / trigger modules.

