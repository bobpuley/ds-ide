# M80 — Windows Audio Backend & Measurement Gate

**Version:** 0.25.0-win.4
**Status:** in progress
**Source:** intake session, 2026-10-04 (`multiplatform_plan.md`; 01_input-ideas.md). Branch `feat/m80-windows-audio-backend` is created from `feat/windows-support` and merged back into `feat/windows-support` at close (never `main`) — FR-WIN-GIT-1

## Goal

Windows has no real-time audio backend, and whether RtAudio is good enough for effect development is unknown. After this milestone an RtAudio-based backend implements `AudioDevice` on Windows (output-only, then duplex), buffer size and latency are reported as measured, and a recorded measurement gate says whether RtAudio is sufficient or a native WASAPI milestone must be added.

## Sprint Tasks

### [x] feat: RtAudio output-only backend for Windows (FR-WIN-AUD-5)

Output-only is the mode used for simulated audio and needs no microphone stream.

**Affected files:** `emulator/runtime/audio_device_rtaudio.cpp`, `emulator/runtime/audio_device_factory.cpp`, `emulator/CMakeLists.txt`, `vendor/RtAudio/**`

**DoD:**
- an RtAudio backend (WASAPI API; ASIO selectable) implements `start_output_only` with stereo-interleaved `ProcessFn`, `stop`, `drainXruns` and a measured `lastLatencyMs`
- RtAudio is vendored or fetched at a pinned version and builds under clang/MinGW
- audio is audible on Windows from a sample effect, and failure to open a device falls back to the silent software loop as on macOS
- the shared contract test passes for this backend, and the existing macOS suites (TypeScript unit tests, emulator C++ test runners, `tests/build-flags`, runtime/functional tests) pass unchanged (FR-WIN-GIT-2)

---

### [ ] feat: RtAudio duplex backend for Windows (FR-WIN-AUD-5)

Duplex needs input and output that may be on different devices with independent clocks.

**Affected files:** `emulator/runtime/audio_device_rtaudio.cpp`, `tests/audio-engine/test_realtime_path.cpp`

**DoD:**
- `start()` opens input and output via RtAudio, adapting mono or multichannel hardware to the stereo-interleaved contract inside the backend
- `queriedInputSampleRate()`, `sample_rate_mismatch` and `realtime_unavailable` behave as on macOS; `drainRenderErrors()` is mapped or documented as always zero
- live input reaches the effect and its output reaches the speakers on Windows
- the existing macOS suites (TypeScript unit tests, emulator C++ test runners, `tests/build-flags`, runtime/functional tests) pass unchanged (FR-WIN-GIT-2)

---

### [ ] feat: report actual buffer size, rate and latency (FR-WIN-AUD-6)

A backend may open at a different buffer size than requested (WASAPI shared has a coarser minimum period); the `realtime_unavailable` message blames only the macOS microphone permission.

**Affected files:** `emulator/runtime/audio_device.h`, `emulator/runtime/audio_engine.cpp`, `src/webview/scope-webview.ts`, `src/ipc/narrow.ts`, `src/test/unit/webview/scope-panel.test.ts`

**DoD:**
- backends report actual buffer size and latency (RtAudio `getStreamLatency()`); a requested-vs-actual buffer mismatch raises an event surfaced in the Scope like `sample_rate_mismatch`
- the `realtime_unavailable` text is platform-neutral or carries a reason
- existing `xrun`/`latency`/`audioMode`/`audioDevice` message shapes are unchanged
- the existing macOS suites (TypeScript unit tests, emulator C++ test runners, `tests/build-flags`, runtime/functional tests) pass unchanged (FR-WIN-GIT-2)

---

### [ ] chore: Windows audio measurement gate (FR-WIN-AUD-7)

The 10 ms / 15 ms Windows figures are assumptions; the decision on a native WASAPI backend needs measurements.

**Affected files:** `docs/measurements/windows-audio.md`, `tests/audio-measurement/**`

**DoD:**
- a measurement harness records effective buffer size, latency, jitter and xruns for WASAPI shared, WASAPI exclusive and ASIO on Windows against the macOS baseline, at 64/128/256-frame requests
- results and a written conclusion (RtAudio sufficient / native WASAPI milestone needed) are committed; if needed, a new milestone is added to the registry through intake
