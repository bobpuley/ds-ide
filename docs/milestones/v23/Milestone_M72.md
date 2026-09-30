# M72 — Scope Instrument — Emulator Capture

**Version:** 0.23.0
**Status:** in progress
**Source:** feature intake session, 2026-09-30 (01_input-ideas.md; design_plan.md P0-4; follow-up to M70–M71)

## Goal

The scope stream is decimated, so fine time bases lose detail and a webview trigger can miss a
transient between snapshots. After this milestone the emulator keeps a full-rate capture ring,
triggers without adding work to the real-time callback, and returns a triggered window on request,
so single-shot is reliable and fine time bases show full-rate detail. The webview requests a capture only
for 1× Single and for low-resolution time bases; the live scope stays on the decimated stream.

## Sprint Tasks

### [x] feat: full-rate capture ring with trigger scan (FR-SCI-14a)

**Affected files:** `emulator/runtime/scope_capture.h`, `tests/scope-capture/test_scope_capture.cpp`, `tests/scope-capture/run_tests.sh`

**DoD:**
- pure header-only `ScopeCapture`: 3 × 16384-frame pre-allocated rings, `arm` / `cancel` / `push`, window of 4096 frames with the trigger at frame 1024
- rising / falling on In or Out L at a level; window returned only once complete; `clear()` on config change
- standalone C++ tests cover rising, falling, no crossing, window completion across several blocks, cancel and clear

---

### [x] feat: drain-thread integration and IPC request/reply (FR-SCI-14b)

**Affected files:** `emulator/runtime/audio_engine.cpp`, `emulator/runtime/ipc_server.cpp`, `emulator/runtime/emulator_state.h`, `tests/runtime/test_scope_capture.py`, `tests/runtime/build_and_test.sh`

**DoD:**
- `scopeCapture` arm / cancel parsed in `dispatch()` into a mutex-guarded slot; the drain thread feeds the ring and emits one `scope_capture` per armed request
- RT callback unchanged; ring cleared with scope/fft on mode or config change
- runtime test: a 440 Hz sine yields a full-rate window triggered at the requested level; cancel yields none

---

### [x] feat: host narrowing and forwarding of scope_capture (FR-SCI-14c)

**Affected files:** `src/ipc/narrow.ts`, `src/emulator/manager.ts`, `src/webview/messages.ts`, `src/test/unit/ipc/narrow.test.ts`

**DoD:**
- `scope_capture` narrower forwards `in`, `out`, `out_r`, `rate`, `trigger`; malformed messages are dropped
- the manager forwards it to the Scope webview; the webview's `scopeCapture` request reaches the emulator
- unit tests cover a valid message and each malformed field

---

### [ ] feat: webview single-shot and fine time base use emulator capture (FR-SCI-14d)

**Affected files:** `src/webview/scope/scope-capture-source.ts`, `src/webview/scope-webview.ts`, `src/webview/scope-panel.ts`, `src/test/unit/webview/scope-capture-source.test.ts`, `tests/human-driven/showcase.js`

**DoD:**
- 1× Single sends a capture request and freezes on the returned window at its trigger point; the tooltip no longer says best-effort
- an edge trigger at a low-resolution time base draws full-rate windows, throttled to ~5 requests/s
- unit tests cover when to request, throttling, and choosing window vs decimated ring
