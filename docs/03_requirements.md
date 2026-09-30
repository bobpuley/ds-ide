> **v22 complete** — archived to `docs/v22/` on 2026-09-30. This file now seeds v23 planning.

# 03 — Requirements (v23)
> **v22 complete** — all v22 requirements implemented; ACs green.
> Archived: [`docs/v22/03_requirements.md`](v22/03_requirements.md).

## Scope as an instrument — `FR-SCI-*` (intake 2026-09-30)

Source: `01_input-ideas.md`, 2026-09-30; `design_plan.md` P0-4, §6.B-8, §6.B-10. Milestones:
**M70** (display), **M71** (analysis), **M72** (emulator-side capture, planned). Layout
reference: `docs/mockups/v22-scope-instrument.html`, confirmed as the first task of M70.

**Decisions recorded 2026-09-30:** two-step delivery — M70–M71 are webview-only on the existing
scope stream (plus passing `out_r` and `step` through); emulator full-rate capture and a true
single-shot are a separate later milestone (M72). Work is split display (M70) / analysis (M71).

**FR-SCI-1 — Layout confirmed by mockup.** The instrument layout (controls bar, scope with axes,
spectrum, meters column, event history) is evaluated in the standalone mockup before any code
changes, and the user's decisions on its open questions are written back to `04_architecture.md`.
- AC: the user has evaluated the mockup and the confirmed layout is recorded in 04.

**FR-SCI-2 — Right channel and decimation reach the webview.** The `scope` IPC message carries
`out_r` (already emitted by the emulator) and a new `step` (decimation factor). The `scope`
narrower passes both through; older emulators without `step` fall back to a derived value.
- AC: a `scope` message with `out_r` and `step` narrows to a message carrying both; one without
  `out_r` or `step` still narrows (both optional).
- AC: the right channel reaches the Scope webview's capture.

**FR-SCI-3 — Capture ring.** The webview accumulates consecutive scope snapshots into a
contiguous ring long enough for the largest time base (≥ 100 ms of signal), independent of block
size. The ring is cleared on emulator restart or sample-rate / block-size change.
- AC: at a 4-frame block, 10 ms/div × 10 divisions still fills the plot after enough snapshots.
- AC: a config change clears the ring (no stale-rate samples drawn).

**FR-SCI-4 — Labelled axes and time base.** The scope shows a time axis in ms and an amplitude
axis labelled with values, with a time-base selector (0.5 / 1 / 2 / 5 / 10 ms per division).
The effective sample rate (`sampleRate / step`) is shown, and a time base with fewer than 20
points per division is flagged.
- AC: tick labels match the selected ms/div and the amplitude gain.
- AC: at 12 kHz effective rate, 0.5 ms/div is flagged as low-resolution.

**FR-SCI-5 — Gain and amplitude scale.** A gain control (×1, ×2, ×4, Auto) and a linear /
dBFS amplitude scale. Auto picks the gain that fits the visible peak (capped at ×64, never below ×1). Traces are clipped to the plot.
- AC: a −40 dBFS sine is visible at Auto gain; at ×1 it is not clipped or distorted.
- AC: in dBFS mode the amplitude axis is labelled in dB.

**FR-SCI-6 — Stereo display.** The scope draws In, Out L and Out R. The three traces differ by
line style as well as colour (solid / dashed / dotted); the legend toggles each trace. Colours
come from theme tokens (FR-THM-2), with a new Out R token.
- AC: each trace can be hidden and shown from the legend.
- AC: the three traces are distinguishable in all four theme kinds and in greyscale.

**FR-SCI-7 — Freeze and cursor.** A Freeze / Resume control (and Space) holds the display;
a FROZEN badge is shown. Hovering the scope shows a cursor with the time and each visible
channel's value, on live and frozen data.
- AC: while frozen, new scope messages do not change the plot but the capture ring keeps
  collecting (Resume shows current data).
- AC: the cursor read-out matches the sample under the pointer.

**FR-SCI-8 — Meters.** Per channel (In, Out L, Out R): peak and RMS in dBFS, a peak-hold marker,
and a latching CLIP indicator (true when any sample reaches full scale) that stays until cleared by clicking it or "Reset peaks". A headroom value (distance of the worst peak from 0 dBFS) is shown.
- AC: a full-scale sample latches CLIP for that channel only; clicking it clears it.
- AC: meter values match the capture's peak and RMS.

**FR-SCI-9 — Trigger.** Free-run, rising or falling edge, on In or Out L, with a level set by
dragging a marker on the amplitude axis. The plot starts at the first crossing in the capture;
when none exists it shows a "no trigger" state and keeps the last triggered frame's axes.
- AC: a periodic input stays stationary between frames in rising / falling mode.
- AC: moving the marker above the signal peak shows "no trigger".

**FR-SCI-10 — Single-shot (best effort).** "1× Single" arms the trigger, freezes the display on
the first triggered capture, and is labelled best-effort (it can miss a transient between
snapshots).
- AC: arming then triggering freezes the display at the trigger point; arming again resumes.

**FR-SCI-11 — Spectrum scaling.** The spectrum has a Lin / Log frequency axis and a Relative /
Absolute dBFS amplitude mode, with labelled Hz and dB axes. Absolute mode does not renormalise
to the running peak.
- AC: in Log mode a 200 Hz corner is not squeezed into the first 1% of the axis.
- AC: halving the input level lowers the absolute-mode trace by 6 dB (it does not rescale).

**FR-SCI-12 — Snapshot and export.** A snapshot button saves a PNG of the scope and spectrum to a file
(save dialog); an export button saves the visible samples (all visible channels, current time
base) as CSV.
- AC: the PNG contains the scope and spectrum as drawn; the CSV has a header row, one row per
  sample, and the time in ms.

**FR-SCI-13 — Event history.** The transient events strip becomes a timestamped, click-to-expand
log of `CLIP`, `DENORMAL` and xrun events, with the latest event shown in the strip.
- AC: an event is visible in the log after the strip moves on.
- AC: the log holds at least the last 200 events and drops the oldest.

**FR-SCI-14 — Emulator-side capture (M72, planned).** The emulator keeps a full-rate ring,
triggers in C++ without adding work to the real-time callback, and returns a triggered window on
request, so single-shot catches transients and fine time bases show full-rate detail.
- AC: to be defined when M72 is planned.

